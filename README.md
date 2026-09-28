# K-OTP SDK

[English](./README.md) | [한국어](./README_ko.md)

Official JavaScript/TypeScript SDKs for the [K-OTP](https://api.k-otp.dev)
Korean OTP API: issue and verify one-time passwords delivered by SMS or
KakaoTalk AlimTalk.

| Package | Use it for |
| --- | --- |
| [`@k-otp/sdk-core`](./packages/sdk-core) | `issue` / `verify` from browsers (`pk_` key), SSR and edge. Framework-agnostic, also available as a `<script>` bundle (`window.KOtp`). |
| [`@k-otp/sdk-server`](./packages/sdk-server) | Every public `/v1` operation (status, history, ledger, balance, templates) from Node.js, Bun, Deno or Workers with an `sk_` key. |

React, Vue and Svelte adapters built on `sdk-core` are coming next.

## Quick start

```bash
npm install @k-otp/sdk-server   # backend
npm install @k-otp/sdk-core     # browser / SSR
```

```ts
import { createIdempotencyKey, createOtpServerClient } from "@k-otp/sdk-server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

const idempotencyKey = createIdempotencyKey("signup"); // persist & reuse on retries
const { issueId } = await otp.issue({ phoneNumber: "01012345678", purpose: "signup", idempotencyKey });

const { verified, reasonCode } = await otp.verify({ issueId, code: "123456" });
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
- [Errors, retries and idempotency](./docs/errors-and-retries.md)
- [Security: key types and the Origin allowlist](./docs/security.md)
- [Releasing](./docs/releasing.md)
- API reference: [`sdk-core`](./packages/sdk-core/README.md), [`sdk-server`](./packages/sdk-server/README.md)

## How the SDK stays in sync with the API

The public OpenAPI document is vendored at [`spec/openapi.json`](./spec/openapi.json).
TypeScript types are generated from it (`bun run gen:types`), the oRPC contract
in `packages/sdk-core/src/contract.ts` mirrors its operations, and a drift test
fails CI when either disagrees with the spec. Refresh the spec with
`bun run sync:openapi`.

## Development

```bash
bun install
bun run check   # typecheck, lint, test, build, pack check, dist smoke, size
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 1990Company
