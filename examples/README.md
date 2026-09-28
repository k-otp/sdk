# Examples

Minimal, runnable apps. Each one is a private workspace package that depends
on the SDK with `workspace:*` (never published) and runs against a built-in
mock API when no key is configured.

| Example | SDK | Key |
| --- | --- | --- |
| [`vanilla-cdn`](./vanilla-cdn) | `@k-otp/sdk-core` script bundle (`window.KOtp`), jsDelivr + SRI notes | `pk_` |
| [`react-vite`](./react-vite) | `@k-otp/sdk-react` (`useOtpFlow`) | `pk_` |
| [`vue-vite`](./vue-vite) | `@k-otp/sdk-vue` (`useOtpFlow`) | `pk_` |
| [`svelte-vite`](./svelte-vite) | `@k-otp/sdk-svelte` (flow store, `use:otpForm`) | `pk_` |
| [`node-server`](./node-server) | `@k-otp/sdk-server` issue/verify endpoints | `sk_` (server only) |

```bash
bun install
bun run build            # examples use the built packages
bun run check:examples   # typecheck + build (+ smoke) every example
cd examples/react-vite && bun run dev
```

Browser examples use **`pk_` public keys**, which only work from origins
listed exactly (scheme + host + port) in the key's `allowedOrigins`: the dev
servers run on `http://localhost:5173`. **`sk_` secret keys** belong on a
server only (see `node-server`); never put them in `VITE_*` variables or
static pages.
