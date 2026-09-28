# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

Official JavaScript/TypeScript SDKs for the [K-OTP](https://api.k-otp.dev)
Korean OTP API: issue and verify one-time passwords delivered by SMS or
KakaoTalk AlimTalk.

| Package | Use it for |
| --- | --- |
| [`@k-otp/sdk-core`](./packages/sdk-core) | `issue` / `verify` from browsers (`pk_` key), SSR and edge. Framework-agnostic, also available as a `<script>` bundle (`window.KOtp`). |
| [`@k-otp/sdk-server`](./packages/sdk-server) | Every public `/v1` operation (status, history, ledger, balance, templates) from Node.js, Bun, Deno or Workers with an `sk_` key. |
| [`@k-otp/sdk-react`](./packages/sdk-react) | React 18/19 hooks: `OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow` (resend cooldown + idempotency keys). |
| [`@k-otp/sdk-vue`](./packages/sdk-vue) | Vue 3 plugin and composables: `createOtpPlugin`, `useOtp`, `useOtpFlow`. |
| [`@k-otp/sdk-svelte`](./packages/sdk-svelte) | Svelte 4/5 stores: `createOtpStores`, flow store, `use:otpForm`. |

The adapters are thin layers over `sdk-core` (under 1 kB gzip each) with
identical semantics and the same normalized `OtpApiError`. Each depends on the
exact same `sdk-core` version (lockstep releases) and takes its framework as a
peer dependency.

## Quick start

```bash
npm install @k-otp/sdk-server   # backend
npm install @k-otp/sdk-core     # browser / SSR, framework-agnostic
npm install @k-otp/sdk-react    # or @k-otp/sdk-vue, @k-otp/sdk-svelte
```

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk-server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

const idempotencyKey = createIdempotencyKey("signup"); // persist & reuse on retries
const { issueId } = await otp.issue({ phoneNumber: "01012345678", purpose: "signup", idempotencyKey });

const { verified, reasonCode } = await otp.verify({ issueId, code: "123456" });
```

React (the Vue and Svelte adapters mirror this API):

```tsx
import { OtpProvider, useOtpFlow } from "@k-otp/sdk-react";

<OtpProvider options={{ apiKey: "pk_live_..." }}>{/* exact Origin allowlist */}</OtpProvider>;

const otp = useOtpFlow({ resendCooldownMs: 30_000 });
await otp.send({ phoneNumber, purpose: "signup" }); // key managed + reused on ambiguous retries
await otp.verify(code);                              // otp.verified, otp.reasonCode, otp.error
```

Static site:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." }); // exact Origin allowlist
</script>
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [Issue -> verify UX (cooldown, resend, retries, 402/429)](./docs/issue-verify-ux.md)
- Framework guides: [React](./docs/react.md), [Vue](./docs/vue.md), [Svelte](./docs/svelte.md)
- [Examples](./examples) (vanilla/CDN, React, Vue, Svelte, Node server)
- [Errors, retries and idempotency](./docs/errors-and-retries.md)
- [Security: key types and the Origin allowlist](./docs/security.md)
- Troubleshooting: `NETWORK_ERROR` in the browser but the same key works with
  curl? The page origin is missing from the `pk_` key's `allowedOrigins`
  (exact scheme + host + port); see
  [errors and retries](./docs/errors-and-retries.md#network_error-in-the-browser-but-the-same-call-works-with-curl).
- [Releasing](./docs/releasing.md)
- API reference: [`sdk-core`](./packages/sdk-core/README.md), [`sdk-server`](./packages/sdk-server/README.md), [`sdk-react`](./packages/sdk-react/README.md), [`sdk-vue`](./packages/sdk-vue/README.md), [`sdk-svelte`](./packages/sdk-svelte/README.md)

## How the SDK stays in sync with the API

The public OpenAPI document is vendored at [`spec/openapi.json`](./spec/openapi.json).
TypeScript types are generated from it (`bun run gen:types`), the oRPC contract
in `packages/sdk-core/src/contract.ts` mirrors its operations, and a drift test
fails CI when either disagrees with the spec. Refresh the spec with
`bun run sync:openapi`.

## Development

```bash
bun install
bun run check   # typecheck, lint, test, build, pack check, dist smoke, size, examples
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 1990Company
