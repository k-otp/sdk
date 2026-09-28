# Getting started

K-OTP issues 6-digit one-time passwords over SMS or KakaoTalk AlimTalk and
verifies them. This repository ships these packages:

| Package | Where | Key | Operations |
| --- | --- | --- | --- |
| [`@k-otp/sdk-core`](../packages/sdk-core) | Browser, SSR, edge, server | `pk_` (browser) or `sk_` (server) | `issue`, `verify` |
| [`@k-otp/sdk-server`](../packages/sdk-server) | Node.js, Bun, Deno, Workers | `sk_` only | everything in `/v1` |
| [`@k-otp/sdk-react`](../packages/sdk-react) | React 18/19 (client components) | `pk_` | `issue`, `verify`, flow |
| [`@k-otp/sdk-vue`](../packages/sdk-vue) | Vue >= 3.3 | `pk_` | `issue`, `verify`, flow |
| [`@k-otp/sdk-svelte`](../packages/sdk-svelte) | Svelte 4/5 | `pk_` | `issue`, `verify`, flow |

The adapters depend on `@k-otp/sdk-core` as a regular dependency pinned to
the exact same version (all packages are released in lockstep, so one
install brings the matching core and there is no peer range to get wrong)
and re-export its common helpers and types. The framework itself is a peer
dependency, so installing one adapter never pulls in another framework.

Framework guides: [React](./react.md), [Vue](./vue.md), [Svelte](./svelte.md).
UX rules for the "send code / enter code" screen:
[issue -> verify UX](./issue-verify-ux.md). Runnable apps: [examples](../examples).

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
| `timeoutMs` | `10000` (10 s, per request) |
| `fetch` | `globalThis.fetch` |

Runtime requirements: Node.js >= 20.19 (the CommonJS builds `require()` the
ESM-only oRPC packages, which needs `require(esm)` support), Bun, Deno, modern
browsers and edge runtimes. `@k-otp/sdk-server` only accepts `sk_` keys.

The OpenAPI document the SDK is generated from is vendored at
[`spec/openapi.json`](../spec/openapi.json) (API version shown in
`OPENAPI_VERSION` from `@k-otp/sdk-core/contract`).
