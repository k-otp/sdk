# Svelte + Vite example

Phone verification (issue -> verify) with the UI components of
[`@k-otp/sdk/ui/svelte`](../../docs/ui.md): the one-line preset `OtpForm`
with the optional default theme (`@k-otp/sdk/ui/theme.css`), and the same
flow composed from the headless parts (`OtpFormRoot`, ...) styled
by the example's own CSS. Switch with the links on the page
(`?variant=preset|headless`, `?lang=ko|en`).

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

- `src/main.ts`: a `createOtpClient(...)` passed as `client` (mock fetch when no key), and the
  stylesheet of the variant: `import("@k-otp/sdk/ui/theme.css")` for the
  preset, `./custom.css` for the headless variant.
- `src/App.svelte`: the preset in one line, and the headless composition (render
  props / slots, `data-k-otp` parts, focus moves and live messages handled
  by the components).
- `src/custom.css`: styling the headless parts only through their
  `data-k-otp`, `data-state`, `data-invalid` and `aria-disabled`
  attributes.
- The components are Svelte 4 syntax sources compiled by your Svelte (4 or
  5): this runes-mode app passes snippets (`{#snippet children({ state })}`)
  where a Svelte 4 app would use `let:state`.
- Hooks without components (`the flow store`): see [`docs/svelte.md`](../../docs/svelte.md).

Type-check with `bun run typecheck` (`svelte-check`).

The flow is driven end to end in Chromium by `bun run e2e:examples` from the
repository root (Playwright, against the mock API).

See the [issue -> verify UX guide](../../docs/issue-verify-ux.md).
