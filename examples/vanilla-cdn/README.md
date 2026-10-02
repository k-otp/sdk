# Vanilla / CDN example

A single static `index.html` that uses the `window.KOtp` script bundle of
[`@k-otp/sdk`](../../packages/sdk/README.md#cdn--static-sites)
(`@k-otp/sdk/k-otp.iife.min.js`): no bundler, no framework.

## Run

```bash
bun install && bun run build          # from the repository root
cd examples/vanilla-cdn
bun run dev                           # http://localhost:5173 (node serve.ts)
bun run build                         # dist/: index.html + k-otp.iife.min.js
```

`serve.ts` serves `index.html` and the locally built
`packages/sdk/dist/k-otp.iife.min.js` (resolved through the
`@k-otp/sdk/k-otp.iife.min.js` export) as `./k-otp.iife.min.js`. With
`PUBLIC_KEY = ""` the page uses an in-page mock API (code `123456`).

## Production: jsDelivr (or unpkg) + SRI

Replace the local `<script>` with a pinned jsDelivr URL and an integrity
hash (unpkg: `https://unpkg.com/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js`):

```html
<script
  src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

- Pin an exact version; `@latest` or ranges cannot be combined with SRI.
- Get the hash from jsDelivr ("Copy HTML + SRI") or compute it:
  `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
  For the local build: `openssl dgst -sha384 -binary dist/k-otp.iife.min.js | openssl base64 -A`.

## Keys and origins

Set `PUBLIC_KEY` to a **`pk_` public key**. A `pk_` key only works from
origins listed **exactly** in its `allowedOrigins` (scheme + host + port,
no wildcards): add `http://localhost:5173` for local development (ideally on
a separate key) and your production origin such as
`https://www.example.com`. Other origins get `403 FORBIDDEN`. Never put an
`sk_` key in a page: the SDK refuses it in browsers, and anyone could read it.

The page drives the UI with `KOtp.createOtpFlow` (the public
`@k-otp/sdk/headless` flow that the framework adapters also use): one
idempotency key per send attempt, reused while the outcome is unknown, a
30 s resend cooldown (or the server's `retryAfterMs`), and `verify` results
with `reasonCode` handled as normal outcomes. See the
[issue -> verify UX guide](../../docs/issue-verify-ux.md).
