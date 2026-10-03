# Errors, retries and idempotency

## Error shape

All SDK methods reject with `OtpApiError`:

| Field | Meaning |
| --- | --- |
| `code` | Normalized code (table below). |
| `status` | HTTP status, or `0` when no HTTP response was received (timeout, network, abort). |
| `message` | Server message, or a descriptive client message. |
| `requestId` | `X-Request-Id` response header (sent on every API response, exposed to allowed browser origins), else `request-id` / `cf-ray`. Include it in support requests. |
| `data` | Error payload. For 402: `{ code: "INSUFFICIENT_CREDIT" \| "OVERDRAFT_LIMIT_EXCEEDED" }`. For 429: `{ limit: "perKey" \| "perIp" \| "perPhone", policy: "key" \| "platform", retryAfterMs }` (`OtpRateLimitedData`). |
| `retryAfterMs` | Wait before retrying, in ms: the body's `data.retryAfterMs` (exact), else the `Retry-After` header (seconds or HTTP date), else `data.retryAfter` (seconds). Set on every 429 and on 503 when the server sends a wait. |
| `retryable` | `true` for the codes marked below. |
| `cause` | The underlying error (e.g. the fetch `TypeError`). |

| Code | HTTP | Retryable | Typical cause |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | no | Invalid input, missing/invalid idempotency key (also raised client-side before any request), header/body key mismatch. |
| `UNAUTHORIZED` | 401 | no | Missing, malformed, revoked or unknown key. |
| `PAYMENT_REQUIRED` | 402 | no | Not enough credit in your wallet (`data.code`; from API 1.4.0 the wallet is shared by every app of your organization). Top up, then issue again. |
| `FORBIDDEN` | 403 | no | Missing scope, `pk_` key on a server-only operation, or `Origin` not in the key's allowlist. |
| `NOT_FOUND` | 404 | no | Unknown issue/template for this app. |
| `CONFLICT` | 409 | no | Idempotency key reused with a different payload, or the replayed issue was since replaced. |
| `TOO_MANY_REQUESTS` | 429 | yes | A rate limit of the API key on `issue`/`verify` (see [rate limits](#rate-limits-429)); honor `retryAfterMs`. |
| `INTERNAL_SERVER_ERROR` | 500, other 5xx | yes | Unexpected server error. |
| `SERVICE_UNAVAILABLE` | 502, 503, 504 | yes | Dependency or gateway unavailable, or an earlier attempt with the same idempotency key is still being resolved. |
| `TIMEOUT` | 0 (or 408) | yes | No response within `timeoutMs`. |
| `NETWORK_ERROR` | 0 | yes | DNS/TLS/connection failure, or a CORS rejection in browsers, most often a `pk_` key used from an origin that is not in its `allowedOrigins` (see below). |
| `ABORTED` | 0 | no | Your `AbortSignal` fired. |
| `UNKNOWN` | any | no | Anything else (unexpected status, malformed success body). |

Configuration mistakes (missing `apiKey`, a key without the `sk_` prefix in
`@k-otp/sdk/server`, an `sk_` key in a browser, no `fetch`) throw `TypeError` instead.

## `NETWORK_ERROR` in the browser, but the same call works with curl

That is almost always the `pk_` key's Origin allowlist. For a browser
`Origin` not listed in `allowedOrigins`, the API sends no CORS headers, the
browser blocks the response and the SDK can only report `NETWORK_ERROR`
(`status: 0`, no `requestId`; in browsers the message includes a hint). Add
the page origin to the key exactly: scheme + host + port, no path, no
trailing slash (`http://localhost:5173` differs from `http://127.0.0.1:5173`
and from `https://localhost:5173`). Details:
[security](./security.md#troubleshooting-network_error-in-the-browser-but-it-works-with-curl).

## Idempotency for `issue`

`issue` sends a real message (AlimTalk, or SMS as the fallback) and reserves credit, so it must be
safe to retry. The SDK requires an `idempotencyKey` on every call:

1. Create one key per logical "send a code" action with
   `createIdempotencyKey()` (or your own unique id, 1-128 visible ASCII
   characters).
2. **Persist it before calling `issue`** (component state, session, database
   row) together with the pending action.
3. On any retry of that action, send **the same key**. The API replays the
   original result without sending or charging again.
4. Mint a new key only when the user deliberately asks for a new code. Issuing
   again for the same phone number and purpose replaces the previous code
   (`verify` on the old `issueId` then returns `reasonCode: "REPLACED"`).

Why this matters: after a `TIMEOUT`, `NETWORK_ERROR` or `503`, the SDK cannot
know whether the message was sent. Retrying with a new key can deliver a second
message and debit twice. Retrying with the same key is always safe:

- same key + same payload -> the original response (or `503` while the first
  attempt is still being resolved; keep retrying with backoff),
- same key + different payload -> `409 CONFLICT` (a bug in your code: the key
  must identify exactly one request).

The SDK sends the key as both the `Idempotency-Key` header and the body
`idempotencyKey` field; the API requires them to match.

For the user-facing side (buttons, cooldowns, messages) see
[issue -> verify UX](./issue-verify-ux.md). The adapters' flow helpers apply
these idempotency rules automatically.

## Retry recipe

The SDK does not retry automatically, so you stay in control of user-visible
side effects. A reasonable policy:

```ts
import { isOtpApiError } from "@k-otp/sdk";

async function issueWithRetry(otp, input, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await otp.issue(input); // same input.idempotencyKey every time
    } catch (error) {
      if (!isOtpApiError(error) || !error.retryable || attempt >= attempts) throw error;
      const backoff = error.retryAfterMs ?? Math.min(8000, 500 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, backoff + Math.random() * 250));
    }
  }
}
```

`verify` is naturally safe to retry: a successful verification is one-time, so
a retry after an ambiguous success resolves with `reasonCode:
"ALREADY_VERIFIED"`, which you can treat as success when the first attempt's
outcome was unknown. Note that each wrong code consumes an attempt.

## Rate limits (429)

Since API 1.3.1, `issue` and `verify` enforce the API key's rate-limit
policy. `pk_` keys also get a platform default for the rules they do not set,
and every key is capped at a platform ceiling. An exceeded rule rejects with
`TOO_MANY_REQUESTS` (429), a `Retry-After` header (whole seconds, rounded up)
and this error data:

```ts
import { isOtpApiError, type OtpRateLimitedData } from "@k-otp/sdk";

if (isOtpApiError(error) && error.code === "TOO_MANY_REQUESTS") {
  const data = error.data as OtpRateLimitedData | undefined;
  data?.limit;        // "perKey" (issue and verify), "perIp" / "perPhone" (issue only)
  data?.policy;       // "key" (your key's own policy) or "platform" (default or ceiling)
  error.retryAfterMs; // data.retryAfterMs (exact ms), else Retry-After
}
```

- Wait `error.retryAfterMs` before retrying (the recipe above does). Fall
  back to a default only when it is missing, e.g. a 429 from a proxy in
  front of the API.
- Rejected requests do not count against the limit, and a rejected `verify`
  does not use up a verification attempt. Retry `issue` with the same
  idempotency key.
- Repeated `policy: "key"` rejections on legitimate traffic mean the key's
  own limits are too tight; `policy: "platform"` means a platform default
  or ceiling applied.
- The flow helpers turn the wait into a cooldown: on `send` the resend
  cooldown (`cooldownRemainingMs`), on `verify` a separate verify cooldown
  (`verifyCooldownRemainingMs`, `canVerify: false`). See
  [issue -> verify UX](./issue-verify-ux.md).

## Verification results are not errors

`verify` resolves (HTTP 200) with `verified: false` and one of:

| `reasonCode` | Meaning | Suggested UX |
| --- | --- | --- |
| `MISMATCH` | Wrong code; one attempt consumed. | Show `attemptsRemaining`. |
| `MAX_ATTEMPTS` | No attempts left. | Offer a new code (new idempotency key). |
| `EXPIRED` | Code expired (default 3 minutes). | Offer a new code. |
| `REPLACED` | A newer code was issued for this phone + purpose. | Ask for the latest code. |
| `ALREADY_VERIFIED` | Already used successfully. | Treat as done if you were retrying. |
| `NOT_FOUND` | Unknown `issueId` for this app. | Restart the flow. |

## Timeouts and cancellation

- `timeoutMs` (default 10 s) applies per request; override per call with
  `{ timeoutMs }`.
- Pass `{ signal }` to cancel (for example when a component unmounts); the
  promise rejects with `ABORTED`.
