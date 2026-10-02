# Getting started

K-OTP issues 6-digit one-time passwords over SMS or KakaoTalk AlimTalk and
verifies them. Everything ships in one package, `@k-otp/sdk`
(`npm install @k-otp/sdk`), with one subpath per use:

| Import | Where | Key | Operations |
| --- | --- | --- | --- |
| [`@k-otp/sdk`](../packages/sdk/README.md) | Browser, SSR, edge, server | `pk_` (browser) or `sk_` (server) | `issue`, `verify` |
| [`@k-otp/sdk/server`](./reference/server.md) | Node.js, Bun, Deno, Workers | `sk_` only | everything in `/v1` |
| [`@k-otp/sdk/react`](./reference/react.md) | React 18/19 (client components) | `pk_` | `issue`, `verify`, flow |
| [`@k-otp/sdk/vue`](./reference/vue.md) | Vue >= 3.3 | `pk_` | `issue`, `verify`, flow |
| [`@k-otp/sdk/svelte`](./reference/svelte.md) | Svelte 4/5 | `pk_` | `issue`, `verify`, flow |

The framework subpaths re-export the common core helpers and types (the same
objects as `@k-otp/sdk` within one module format, from one shared copy of the
core; `instanceof OtpApiError` also matches across the ESM and CommonJS
builds). React, Vue and
Svelte are optional peer dependencies of `@k-otp/sdk`: your app provides the
one it uses, and importing `@k-otp/sdk/react` never loads Vue, Svelte or the
server client. `@k-otp/sdk/server` is never bundled for browsers (it resolves
to a throwing stub under the `browser` export condition).

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
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk/server";

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
import { createIdempotencyKey, createOtpClient } from "@k-otp/sdk";

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
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js"
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

`GET /v1/templates` (`@k-otp/sdk/server`: `listTemplates()`) lists the whitelisted
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
browsers and edge runtimes. `@k-otp/sdk/server` only accepts `sk_` keys.

The OpenAPI document the SDK is generated from is vendored at
[`spec/openapi.json`](../spec/openapi.json) (API version shown in
`OPENAPI_VERSION` from `@k-otp/sdk/contract`).
