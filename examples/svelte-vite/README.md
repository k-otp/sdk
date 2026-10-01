# Svelte + Vite example

Phone verification (issue -> verify) with
[`@k-otp/sdk/svelte`](../../docs/reference/svelte.md)'s flow store: resend
cooldown, retry-safe idempotency keys and error messages for 402/429/403.

## Run

From the repository root:

```bash
bun install
bun run build                      # the example uses the built workspace packages
cd examples/svelte-vite
cp .env.example .env.local         # optional, see below
bun run dev                        # http://localhost:5173
```

Without a key the app talks to an in-browser mock API (`src/mock-fetch.ts`);
the code is always `123456`.

## Using a real key

Set `VITE_K_OTP_PUBLIC_KEY` in `.env.local` to a **`pk_` public key**:

- A `pk_` key only works from origins listed **exactly** in its
  `allowedOrigins` (scheme + host + port, no wildcards, no trailing slash).
  Add `http://localhost:5173` for this dev server (preferably on a separate
  development key) and your production origin, e.g. `https://www.example.com`.
  Requests from any other origin fail with `403 FORBIDDEN`.
- Never put an `sk_` secret key in a `VITE_*` variable: everything in
  `import.meta.env.VITE_*` is shipped to the browser. Server-side flows
  belong in a backend, see [`node-server`](../node-server).
- Browser-direct verification only proves to the browser that the code
  matched. If your backend grants access based on it, confirm server-side
  (`getStatus` with an `sk_` key).

## What to look at

- `src/App.svelte` (Svelte 5): `createOtpStores(options)` per component (no
  module-level singleton, so it stays SSR-safe if you move it to SvelteKit),
  `otp.createFlow({ resendCooldownMs: 30_000 })` read with `$flow`, forms
  wired with `use:otpForm` (no double submits), "Retry" while an ambiguous
  attempt's idempotency key is pending, `reasonCode` handling, and
  `flow.abort()` on destroy.
- The adapter only uses `svelte/store`, so the same code works in Svelte 4
  components.

Type-check with `bun run typecheck` (`svelte-check`).

See the [issue -> verify UX guide](../../docs/issue-verify-ux.md).
