# Getting started

K-OTP issues 6-digit one-time passwords over SMS or KakaoTalk AlimTalk and
verifies them. This repository ships two packages:

| Package | Where | Key | Operations |
| --- | --- | --- | --- |
| [`@k-otp/sdk-core`](../packages/sdk-core) | Browser, SSR, edge, server | `pk_` (browser) or `sk_` (server) | `issue`, `verify` |
| [`@k-otp/sdk-server`](../packages/sdk-server) | Node.js, Bun, Deno, Workers | `sk_` only | everything in `/v1` |

Framework adapters (React, Vue, Svelte) are planned on top of `sdk-core`.

## 1. Get keys

- **Secret key (`sk_`)** for your backend. Never ship it to a browser or a
  mobile app.
- **Public key (`pk_`)** for browsers. It can only call `issue` and `verify`,
  and every request must come from an `Origin` that exactly matches one of the
  key's allowed origins (for example `https://www.example.com`; no wildcards,
  and `http://localhost:5173` must be listed explicitly for local development).

See [security](./security.md).

## 2. Choose a flow

**Server-driven (recommended).** Your backend calls `issue` with `sk_`, stores
the `issueId` with the pending action, and calls `verify` when the user submits
the code. You keep full control over rate limiting and which phone numbers can
receive codes.

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk-server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

// POST /signup/send-code
const idempotencyKey = pending.idempotencyKey ?? createIdempotencyKey("signup");
pending.idempotencyKey = idempotencyKey; // persist BEFORE calling issue
const { issueId } = await otp.issue({ phoneNumber, purpose: "signup", idempotencyKey });

// POST /signup/verify-code
const { verified, reasonCode } = await otp.verify({ issueId, code });
```

**Browser-direct.** A static site or SPA calls the API with a `pk_` key.

```ts
import { createIdempotencyKey, createOtpClient } from "@k-otp/sdk-core";

const otp = createOtpClient({ apiKey: "pk_live_..." });
const { issueId } = await otp.issue({
  phoneNumber,
  purpose: "login",
  idempotencyKey: createIdempotencyKey(),
});
```

Browser-direct verification only tells the *browser* that the code was right.
If your backend must trust the result, check it server-side (`getStatus` with
`sk_` shows `verificationStatus: "verified"`).

Without a bundler:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." });
</script>
```

## 3. Handle results and errors

- `verify` resolves with `verified: false` and a `reasonCode` for wrong,
  expired, replaced or exhausted codes; it does not throw.
- Everything else rejects with `OtpApiError`. Read
  [errors and retries](./errors-and-retries.md), especially the idempotency
  rules for `issue`.

## 4. Templates

`GET /v1/templates` (`sdk-server`: `listTemplates()`) lists the whitelisted
message templates. Pass `templateId` to `issue` to choose one and
`templateVariables` for its declared variables; the `code` variable is always
filled in by the server.

## Configuration reference

| Option | Default |
| --- | --- |
| `baseUrl` | `https://api.k-otp.dev/v1` |
| `timeoutMs` | `10000` |
| `fetch` | `globalThis.fetch` |

The OpenAPI document the SDK is generated from is vendored at
[`spec/openapi.json`](../spec/openapi.json) (API version shown in
`OPENAPI_VERSION` from `@k-otp/sdk-core/contract`).
