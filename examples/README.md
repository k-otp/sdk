# Examples

Minimal, runnable apps. Each one is a private workspace package that depends
on the SDK with `workspace:*` (never published) and runs against a built-in
mock API when no key is configured.

| Example | SDK | Key |
| --- | --- | --- |
| [`vanilla-cdn`](./vanilla-cdn) | `@k-otp/sdk/k-otp.iife.min.js` script bundle (`window.KOtp`), jsDelivr/unpkg + SRI notes | `pk_` |
| [`react-vite`](./react-vite) | `@k-otp/sdk/ui/react` (`<OtpForm />` preset + theme, headless `OtpForm.Root` parts) | `pk_` |
| [`vue-vite`](./vue-vite) | `@k-otp/sdk/ui/vue` (`<OtpForm />` preset + theme, headless `OtpForm.Root` parts) | `pk_` |
| [`svelte-vite`](./svelte-vite) | `@k-otp/sdk/ui/svelte` (`<OtpForm />` preset + theme, headless `OtpFormRoot` parts) | `pk_` |
| [`node-server`](./node-server) | `@k-otp/sdk/server` issue/verify endpoints | `sk_` (server only) |

```bash
bun install
bun run build            # examples use the built packages
bun run check:examples   # typecheck + build (+ smoke, + bundle check) every example
bun run e2e:examples     # drive the UI flow of the framework examples in Chromium
cd examples/react-vite && bun run dev
```

Browser examples use **`pk_` public keys**, which only work from origins
listed exactly (scheme + host + port) in the key's `allowedOrigins`: the dev
servers run on `http://localhost:5173`. **`sk_` secret keys** belong on a
server only (see `node-server`); never put them in `VITE_*` variables or
static pages.
