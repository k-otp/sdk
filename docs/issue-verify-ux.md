# Issue -> verify UX

How to build the "send code / enter code" screen so that it is pleasant,
safe to retry and never double-sends an SMS. The adapters' flow helpers
(`useOtpFlow` in React and Vue, `createFlow()` / `createOtpFlowStore` in
Svelte, and `createOtpFlow` from `@k-otp/sdk-core/headless` or
`KOtp.createOtpFlow` for plain JavaScript) implement every rule below; with
the bare `issue`/`verify` calls or `@k-otp/sdk-server` you apply them
yourself.

## The states

```
idle --send--> sending --ok--> code sent --verify--> verifying --verified--> done
                  |                ^   |                  |
                  |  (retryable)   |   +--resend (after cooldown)
                  +--> error ------+   +--verified:false (reasonCode) --> code sent / need new code
```

| Flow state | UI |
| --- | --- |
| `canSend` false, `issueState.isLoading` | "Sending..." (disable the button) |
| `issueId` set | Show the code input |
| `cooldownRemainingMs > 0` | "Resend in 27s" (disabled) |
| `idempotencyKey` set (after an ambiguous error) | "Retry" (same attempt) |
| `reasonCode === "MISMATCH"` | "Wrong code, N attempts left" (`attemptsRemaining`) |
| `reasonCode` in `EXPIRED`, `MAX_ATTEMPTS`, `REPLACED`, `NOT_FOUND` | "Request a new code" (`canVerify` is false) |
| `verified` | Done. Server-trusted flows must confirm on the backend. |

## Idempotency keys: one per send attempt

`issue` sends a real message and reserves credit, so every call carries an
idempotency key.

1. **New attempt, new key.** Create a key when the user asks for a code
   (first send, or a deliberate resend after a successful send).
2. **Persist it before calling `issue`** (component state is enough in a
   single-page flow; a session/DB row on servers; `sessionStorage` if the
   attempt must survive a reload: the flow exposes it as `idempotencyKey`).
3. **Ambiguous failure, same key.** After `TIMEOUT`, `NETWORK_ERROR`,
   `SERVICE_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`, `TOO_MANY_REQUESTS` or
   `ABORTED`, the message may already be on its way. Retrying the same
   input with the **same key** is always safe: the API replays the original
   result (or answers 503 while the first attempt is still being resolved)
   and never sends or charges twice. A new key could deliver a second SMS.
4. **Definitive failure or success, drop the key.** After `BAD_REQUEST`,
   `UNAUTHORIZED`, `PAYMENT_REQUIRED`, `FORBIDDEN`, `CONFLICT` or a
   success, the next send is a new attempt with a new key.
5. **Changed input, new key.** Reusing a key with a different payload (e.g.
   the user corrected the phone number) is rejected with `409 CONFLICT`. The
   flow helpers compare the input and mint a new key automatically.

Issuing again for the same phone number and purpose replaces the previous
code: `verify` on the old `issueId` then returns `reasonCode: "REPLACED"`.

## Resend and cooldown

- Start a **local cooldown** after each successful send
  (`resendCooldownMs`, default 30 s in the flow helpers; `0` disables it). It prevents accidental double taps
  and abuse, and matches what users expect from SMS codes.
- A **server cooldown** wins when it is longer: on `429 TOO_MANY_REQUESTS`
  (and on 503 with `Retry-After`), `error.retryAfterMs` tells you how long to
  wait. The flow helpers start a cooldown of `retryAfterMs` automatically.
- The API rate-limits `issue` and `verify` separately, so a 429 on `verify`
  starts a **verify cooldown** instead (`verifyCooldownRemainingMs`,
  `verifyCooldownUntil`): `canVerify` stays `false` and `verify` resolves
  with `{ skipped: "cooldown" }` until it ends. Sending a new code is not
  blocked by it.
- Show the remaining time (`cooldownRemainingMs`, which ticks about once a
  second while the UI is subscribed) and keep the button disabled until it
  reaches zero. Calls made anyway resolve with `{ skipped: "cooldown" }`.
- `reset()` clears the flow but keeps both cooldowns, since server-side rate
  limits do not reset either.

## 402 Payment required

`PAYMENT_REQUIRED` means **your** K-OTP credit is exhausted
(`error.data.code`: `INSUFFICIENT_CREDIT` or `OVERDRAFT_LIMIT_EXCEEDED`).
From API 1.4.0 that credit is the organization wallet shared by all of its
apps, so another app's traffic can exhaust it too.
It is not the end user's fault:

- show a generic "sending is temporarily unavailable" message,
- alert yourself (log `error.requestId`, page the on-call, auto top-up),
- do not retry automatically; after topping up, a new send works (the flow
  already dropped the key).

## 429 Too many requests

- Honor `error.retryAfterMs` (the error body's `data.retryAfterMs`, else
  `Retry-After`); fall back to a sensible default (e.g. 30 s) only when it
  is missing.
- Keep the same idempotency key for the retry of the same attempt. Rejected
  requests do not count against the limit or use up a verification attempt.
- Tell the user when they can try again instead of a generic error: show
  `cooldownRemainingMs` next to the send button and
  `verifyCooldownRemainingMs` next to the verify button.
- `error.data.limit` (`perKey`, `perIp`, `perPhone`) and `error.data.policy`
  (`key` or `platform`) tell you which limit applied; log them. See
  [errors and retries](./errors-and-retries.md#rate-limits-429).

## Other errors

| Code | Suggested UX |
| --- | --- |
| `FORBIDDEN` | Configuration problem: a `pk_` key used from an origin that is not in its `allowedOrigins`, or a missing scope. Log it; show a generic error. |
| `UNAUTHORIZED` | Wrong/revoked key. Log it; show a generic error. |
| `BAD_REQUEST` | Validate phone numbers before sending; show "check the number". |
| `CONFLICT` | A bug: the same key was used for a different payload. |
| `TIMEOUT`, `NETWORK_ERROR`, 5xx | "We could not confirm the code was sent" + Retry (same key). |
| `ABORTED` | The user navigated away or you cancelled; usually nothing to show. |

## Verification

- A wrong code is a normal result: `verified: false` with `reasonCode`.
  Each wrong code consumes an attempt; show `attemptsRemaining`.
- `verify` is safe to retry after an ambiguous error; if the first attempt
  succeeded you get `reasonCode: "ALREADY_VERIFIED"`, which you can treat as
  success when the outcome of the first attempt was unknown.
- Use `autocomplete="one-time-code"` and `inputmode="numeric"` on the code
  input so mobile keyboards can autofill SMS codes.
- **Trust:** a browser-direct `verify` only tells the browser that the code
  matched. If your backend grants access based on it, verify on the backend
  (see [`examples/node-server`](../examples/node-server)) or confirm with
  `getStatus({ issueId })` and an `sk_` key.

## Framework wiring

- React: [`docs/react.md`](./react.md)
- Vue: [`docs/vue.md`](./vue.md)
- Svelte: [`docs/svelte.md`](./svelte.md)
- Plain JavaScript / CDN: `createOtpFlow` from `@k-otp/sdk-core/headless`
  (`KOtp.createOtpFlow` in the script bundle), see
  [`examples/vanilla-cdn`](../examples/vanilla-cdn).
