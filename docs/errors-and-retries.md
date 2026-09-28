# Errors, retries and idempotency

## Error shape

All SDK methods reject with `OtpApiError`:

| Field | Meaning |
| --- | --- |
| `code` | Normalized code (table below). |
| `status` | HTTP status, or `0` when no HTTP response was received (timeout, network, abort). |
| `message` | Server message, or a descriptive client message. |
| `requestId` | `x-request-id`, `request-id` or `cf-ray` response header, when readable. Include it in support requests. |
| `data` | Error payload. For 402: `{ code: "INSUFFICIENT_CREDIT" \| "OVERDRAFT_LIMIT_EXCEEDED" }`. |
| `retryAfterMs` | From a `Retry-After` header (seconds or HTTP date) or `data.retryAfterMs` / `data.retryAfter`, when present. |
| `retryable` | `true` for the codes marked below. |
| `cause` | The underlying error (e.g. the fetch `TypeError`). |

| Code | HTTP | Retryable | Typical cause |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | no | Invalid input, missing/invalid idempotency key (also raised client-side before any request), header/body key mismatch. |
| `UNAUTHORIZED` | 401 | no | Missing, malformed, revoked or unknown key. |
| `PAYMENT_REQUIRED` | 402 | no | Not enough credit (`data.code`). Top up, then issue again. |
| `FORBIDDEN` | 403 | no | Missing scope, `pk_` key on a server-only operation, or `Origin` not in the key's allowlist. |
| `NOT_FOUND` | 404 | no | Unknown issue/template for this app. |
| `CONFLICT` | 409 | no | Idempotency key reused with a different payload, or the replayed issue was since replaced. |
| `TOO_MANY_REQUESTS` | 429 | yes | Rate limited; honor `retryAfterMs`. |
| `INTERNAL_SERVER_ERROR` | 500, other 5xx | yes | Unexpected server error. |
| `SERVICE_UNAVAILABLE` | 502, 503, 504 | yes | Dependency or gateway unavailable, or an earlier attempt with the same idempotency key is still being resolved. |
| `TIMEOUT` | 0 (or 408) | yes | No response within `timeoutMs`. |
| `NETWORK_ERROR` | 0 | yes | DNS/TLS/connection failure, CORS rejection in browsers. |
| `ABORTED` | 0 | no | Your `AbortSignal` fired. |
| `UNKNOWN` | any | no | Anything else (unexpected status, malformed success body). |

Configuration mistakes (missing `apiKey`, a key without the `sk_` prefix in
`sdk-server`, an `sk_` key in a browser, no `fetch`) throw `TypeError` instead.

## Idempotency for `issue`

`issue` sends a real SMS/AlimTalk message and reserves credit, so it must be
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
SMS and debit twice. Retrying with the same key is always safe:

- same key + same payload -> the original response (or `503` while the first
  attempt is still being resolved; keep retrying with backoff),
- same key + different payload -> `409 CONFLICT` (a bug in your code: the key
  must identify exactly one request).

The SDK sends the key as both the `Idempotency-Key` header and the body
`idempotencyKey` field; the API requires them to match.

## Retry recipe

The SDK does not retry automatically, so you stay in control of user-visible
side effects. A reasonable policy:

```ts
import { isOtpApiError } from "@k-otp/sdk-core";

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
