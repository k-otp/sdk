# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

Official JavaScript/TypeScript SDK for the [K-OTP](https://api.k-otp.dev)
Korean OTP API: issue and verify one-time passwords delivered by SMS or
KakaoTalk AlimTalk. One npm package, [`@k-otp/sdk`](./packages/sdk), with a
subpath per use:

| Import | Use it for |
| --- | --- |
| [`@k-otp/sdk`](./packages/sdk/README.md) (= `@k-otp/sdk/core`) | `issue` / `verify` from browsers (`pk_` key), SSR and edge. Framework-agnostic. |
| [`@k-otp/sdk/server`](./docs/reference/server.md) | Every public `/v1` operation (status, history, ledger, balance, templates) from Node.js, Bun, Deno or Workers with an `sk_` key. Credit is one wallet per organization (API 1.4.0). Never bundled for browsers. |
| [`@k-otp/sdk/react`](./docs/reference/react.md) | React 18/19 hooks: `OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow` (resend cooldown + idempotency keys). |
| [`@k-otp/sdk/vue`](./docs/reference/vue.md) | Vue 3 plugin and composables: `createOtpPlugin`, `useOtp`, `useOtpFlow`. |
| [`@k-otp/sdk/svelte`](./docs/reference/svelte.md) | Svelte 4/5 stores: `createOtpStores`, flow store, `use:otpForm`. |
| [`@k-otp/sdk/ui/react`, `/ui/vue`, `/ui/svelte`](./docs/ui.md) | Headless UI components: a one-line `<OtpForm />` and composable parts (phone field, send/resend, segmented code input with SMS autofill, verify, countdown, messages), KO/EN. |
| [`@k-otp/sdk/ui/theme.css`](./docs/ui.md#theme) | The optional default theme for the UI components (light/dark, tokens). |
| [`@k-otp/sdk/ui`](./docs/reference/ui.md#k-otpsdkui) | The framework-agnostic UI model: phone canonicalization, code input, form state machine, messages, WebOTP. |
| [`@k-otp/sdk/headless`](./packages/sdk/README.md#headless-flow-k-otpsdkheadless) | The framework-agnostic issue -> verify flow the adapters are built on. |
| [`@k-otp/sdk/contract`](./packages/sdk/README.md#advanced-entry-points) | The oRPC contract and generated OpenAPI types. |
| [`@k-otp/sdk/k-otp.iife.min.js`](./packages/sdk/README.md#cdn--static-sites) | `<script>` bundle (`window.KOtp`) for static sites, via jsDelivr or unpkg. |

The framework subpaths are thin layers over the core (about 1 kB gzip each)
with identical semantics and the same normalized `OtpApiError`, from one
shared copy of the core per module format (`instanceof OtpApiError` also
matches across the ESM and CommonJS builds). React, Vue and Svelte are optional peer
dependencies: importing `@k-otp/sdk/react` never loads Vue, Svelte or the
server client.

## Quick start

```bash
npm install @k-otp/sdk
# plus your framework if you use an adapter: react, vue or svelte (optional peers)
```

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk/server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

const idempotencyKey = createIdempotencyKey("signup"); // persist & reuse on retries
const { issueId } = await otp.issue({ phoneNumber: "01012345678", purpose: "signup", idempotencyKey });

const { verified, reasonCode } = await otp.verify({ issueId, code: "123456" });
```

React (`@k-otp/sdk/vue` and `@k-otp/sdk/svelte` mirror this API):

```tsx
import { OtpProvider, useOtpFlow } from "@k-otp/sdk/react";

<OtpProvider options={{ apiKey: "pk_live_..." }}>{/* exact Origin allowlist */}</OtpProvider>;

const otp = useOtpFlow({ resendCooldownMs: 30_000 });
await otp.send({ phoneNumber, purpose: "signup" }); // key managed + reused on ambiguous retries
await otp.verify(code);                              // otp.verified, otp.reasonCode, otp.error
```

Static site:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.0/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." }); // exact Origin allowlist
</script>
```

## UI components

A complete, accessible phone verification form in one line (React shown; Vue
and Svelte are the same), unstyled unless you import the theme:

```tsx
import { OtpForm } from "@k-otp/sdk/ui/react";
import "@k-otp/sdk/ui/theme.css"; // optional default theme

<OtpForm options={{ apiKey: "pk_live_..." }} purpose="signup" onVerified={(r) => console.log(r.issueId)} />;
```

Korean mobile numbers are canonicalized like the API (`+82 10-...` ->
`010...`), the code input handles paste, autofill (`one-time-code`, WebOTP)
and keyboard navigation, focus follows the flow, and every part exposes
`data-*` state for your own styles or a full headless composition
(`OtpForm.Root`, `OtpForm.PhoneField`, ...). See the
[UI guide](./docs/ui.md).

## Documentation

- [Getting started](./docs/getting-started.md)
- [Issue -> verify UX (cooldown, resend, retries, 402/429)](./docs/issue-verify-ux.md)
- Framework guides: [React](./docs/react.md), [Vue](./docs/vue.md), [Svelte](./docs/svelte.md)
- [UI components and theme](./docs/ui.md) (한국어 포함)
- [Examples](./examples) (vanilla/CDN, React, Vue, Svelte, Node server)
- [Errors, retries, rate limits (429) and idempotency](./docs/errors-and-retries.md)
- [Security: key types and the Origin allowlist](./docs/security.md)
- Troubleshooting: `NETWORK_ERROR` in the browser but the same key works with
  curl? The page origin is missing from the `pk_` key's `allowedOrigins`
  (exact scheme + host + port); see
  [errors and retries](./docs/errors-and-retries.md#network_error-in-the-browser-but-the-same-call-works-with-curl).
- [Releasing](./docs/releasing.md)
- API reference: [`@k-otp/sdk`](./packages/sdk/README.md) (core, headless, contract, CDN), [`/server`](./docs/reference/server.md), [`/react`](./docs/reference/react.md), [`/vue`](./docs/reference/vue.md), [`/svelte`](./docs/reference/svelte.md), [`/ui*`](./docs/reference/ui.md)

## How the SDK stays in sync with the API

The public OpenAPI document is vendored at [`spec/openapi.json`](./spec/openapi.json).
TypeScript types are generated from it (`bun run gen:types`), the oRPC contract
in `packages/sdk/src/core/contract.ts` mirrors its operations, and a drift test
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
