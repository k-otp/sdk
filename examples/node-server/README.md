# Node.js server example (`sk_` key)

A backend that exposes two endpoints for a server-driven OTP flow with
[`@k-otp/sdk-server`](../../packages/sdk-server). The browser only talks to
this server; the **`sk_` secret key never leaves it**.

| Endpoint | Body | Response |
| --- | --- | --- |
| `POST /api/otp/send` | `{ phoneNumber }` | `200 { expiresAt, attemptsRemaining }`, `400`, `429` (+ `Retry-After`), `503` |
| `POST /api/otp/verify` | `{ code }` | `200 { verified, reasonCode?, attemptsRemaining }`, `409` when nothing was sent |

`GET /` serves a tiny test page.

## Run

Requires Node.js >= 22.18 (runs the `.ts` files directly) or Bun.

```bash
bun install && bun run build          # from the repository root
cd examples/node-server
cp .env.example .env                  # optional
bun run start                         # http://localhost:3000
bun run smoke                         # scripted send/verify against the mock
```

Without `K_OTP_SECRET_KEY` the server uses a mock API (code `123456`).

## Why server-driven

- Your backend decides who may receive a code (session, CAPTCHA, per-user or
  per-IP limits) before spending credit.
- `verify` runs server-side, so the result can be trusted: mark the phone
  number verified in your session/database right there.
- The `sk_` key stays in server config (`.env`, a secret manager, Workers
  secrets). Never expose it through `NEXT_PUBLIC_*`, `VITE_*` or any
  client bundle. `@k-otp/sdk-server` refuses to run in a browser and only
  accepts keys starting with `sk_`.

`sk_` keys are not subject to an Origin allowlist. `pk_` public keys (used by
the browser examples) are: they only work from origins listed exactly
(scheme + host + port) in the key's `allowedOrigins`, and a server calling
with a `pk_` key and no matching `Origin` gets `403 FORBIDDEN`.

## What to look at (`src/app.ts`)

- The idempotency key is created per send attempt, stored in the session
  **before** calling `issue`, and reused when the same phone number is sent
  again after an ambiguous failure (timeout, network, 5xx, 429). After a
  success or a definitive error, the next send gets a new key.
- `PAYMENT_REQUIRED` (402, your K-OTP credit) is logged for you and shown to
  users as a generic "unavailable" error.
- `TOO_MANY_REQUESTS` is forwarded as `429` with `Retry-After` from
  `error.retryAfterMs`.
- `verify` returns `verified: false` + `reasonCode` for wrong/expired codes;
  that is a normal result, not an error.

See the [issue -> verify UX guide](../../docs/issue-verify-ux.md).
