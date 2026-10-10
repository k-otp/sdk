# AGENTS.md

Guide for coding agents working in the `k-otp/sdk` repository
(https://github.com/k-otp/sdk).

## What this repo is

Public, MIT-licensed SDK for the K-OTP Korean OTP API (`https://api.k-otp.dev/v1`).

- `packages/sdk` (`@k-otp/sdk`): the only published package, one subpath
  export per use (tsdown builds every entry in one graph per format, so the
  core is shared within a format, never duplicated; ESM and CJS are separate
  copies, so cross-copy identity relies on `Symbol.for` brands/keys, e.g.
  `OtpApiError[Symbol.hasInstance]`):
  - `src/core` -> `@k-otp/sdk` and `@k-otp/sdk/core`: framework-agnostic
    `issue`/`verify` client (browser `pk_` keys, SSR, edge). oRPC
    `OpenAPILink` over REST `/v1`. `src/core/contract.ts` ->
    `@k-otp/sdk/contract`. `src/core/internal.ts` is shared by the server
    client and the adapters through relative imports and is NOT exported.
  - `src/headless` -> `@k-otp/sdk/headless` (public, SemVer-covered): the
    `createOtpOperation` / `createOtpFlow` controllers. Put shared adapter
    behavior there, never in one adapter, so the adapters stay identical.
  - `src/testing` -> `@k-otp/sdk/testing` (public, SemVer-covered):
    `createMockTransport()`, an in-memory simulator of the API test mode
    (`pk_test_`/`sk_test_`) for users' unit tests. The test-mode constants
    and helpers (`isTestKey`, `TEST_PHONE_NUMBERS`, `TEST_OTP_CODE`, ...)
    live in `src/core/test-mode.ts` and are exported from core. The scenario
    table, number patterns, timings, fixed code, simulated balance and error
    messages mirror the API repository's
    `packages/shared/src/modules/otp/test-mode.ts` (and its simulator model)
    by hand: there is no shared fixture, so when that module changes, update
    `src/core/test-mode.ts`, `src/testing/mock-transport.ts`,
    `test/test-mode.test.ts` and `docs/test-mode.md` in the same change.
  - `src/server` -> `@k-otp/sdk/server`: all public `/v1` operations with
    `sk_` keys only (any key not starting with `sk_` is a `TypeError`).
    Under the `browser` export condition it resolves to
    `src/server/browser.ts` (same exports, functions throw when called;
    keep its names in sync, smoke-dist checks), unless `workerd`, `worker`,
    `edge-light` or `deno` matches first.
  - `src/react|vue|svelte` -> `@k-otp/sdk/react|vue|svelte`: thin adapters.
    The framework is an optional `peerDependency` (framework dev packages
    live in the root `devDependencies`); svelte is ESM-only.
  - `src/ui` -> `@k-otp/sdk/ui`: the framework-agnostic UI model (phone
    canonicalization, code input model, `createOtpForm` state machine over
    the headless flow, KO/EN messages, WebOTP, part attributes). Put shared
    UI behavior there, never in one framework's components.
  - `src/ui/react|vue` -> `@k-otp/sdk/ui/react|vue`: headless components
    (`createElement` / `h` render functions, no JSX/SFC build).
    `src/ui/svelte` -> `@k-otp/sdk/ui/svelte`: `.svelte` sources in Svelte 4
    syntax (no runes, plain JS, compiled by the app's Svelte 4 or 5 through
    the `svelte` export condition; hand-written `.svelte.d.ts`) over the
    compiled `runtime.ts`. `src/ui/theme.css` -> `@k-otp/sdk/ui/theme.css`
    (only `[data-k-otp]`, `:where()` selectors).
  - `src/iife.ts` -> `dist/k-otp.iife(.min).js` exposing `window.KOtp`.
- `sdks/`: native server wrappers and language guides. `sdks/packages.json`
  owns their independent release coordinates. `@k-otp/sdk/kiota` uses the
  TypeScript wrapper, bundles generated code from `.cache/kiota/npm`, and emits
  `KotpApiError` / `KotpTransportError`. It has a throwing browser export.
  Build with the pinned Kiota CLI; never edit generated output.
- `tests/`: private workspace running under happy-dom: adapter tests, the
  cross-adapter parity suite (`tests/parity`) and the UI component tests
  (`tests/ui`, including the cross-framework UI parity suite; the
  `*.browser.test.*` files run with `--conditions=browser` for the Svelte
  client runtime), which must pass for every behavior change.
- `examples/*`: private, runnable apps (`workspace:*`, mock API without
  keys), checked by `bun run check:examples` against the built package
  (including a bundle check that each framework app only contains its own
  subpath).
- `spec/openapi.json`: vendored public OpenAPI document (source of truth).
- `scripts/`: type generator, spec sync, typecheck runner, pack/size/smoke
  checks (exports map, optional peers, per-subpath budgets, tree-shaking),
  `publish-oidc.sh`.

## Hard rules

- This repository is **public**. Never add secrets, real API keys, customer
  data, or code copied from private/licensed repositories. Do not depend on any
  private package (e.g. `@repo/*`); `check:pack` enforces a dependency
  allowlist.
- Only the public `/v1` operations of `spec/openapi.json` belong here; never
  add endpoints that are not in the public OpenAPI document.
- Do not push, publish to npm, or create GitHub repositories/releases unless the
  user explicitly asks.
- `packages/sdk/src/core/generated/**` is generated by `bun run gen:types`;
  never hand-edit (Biome and @ttsc/lint ignore it).
- Core (`src/core`, `src/headless`): no framework imports, no import-time
  side effects, no top-level `window`/`document` access. Keep the contract
  schema-less. Never import `@k-otp/sdk` from inside `packages/sdk` (use
  relative imports), and never import one framework from another
  framework's subpath; `check:pack` and `size` enforce it.
- Every SDK method rejects with `OtpApiError`; config mistakes throw
  `TypeError`. `issue` must keep validating the idempotency key before any
  request and send it as header + body.
- Adapters: no top-level `window` access, no module-level state, no mutation
  of protocol semantics. `run`/flow actions resolve `{ data } | { error }`
  (never reject for API errors). `"use client"` opens exactly the built
  files with React code: the react and ui-react entries and the hooks chunk
  they share (`outputOptions.banner` in `packages/sdk/tsdown.config.ts`,
  verified through the source maps by `check:pack`), never a core chunk.
- UI: the three frameworks must render the same `data-*`/ARIA state
  (`tests/ui/parity.browser.test.tsx`). The hooks subpaths, core, headless
  and server must never load `src/ui` (`bun run size` checks it). The
  `.svelte` sources must compile with Svelte 4 and 5 (the compat matrix runs
  the tests on both).

## Toolchain

- Bun 1.4.2 is the package manager, script runner and test runner
  (`bun install`, `bun run`, `bun test`, `bunx`; never npm/pnpm/yarn for
  installs).
- TypeScript 7 checked with `ttsc` (+ `@ttsc/lint`, config `lint.config.ts`).
- Biome for lint/format (`biome.json`), tsdown for builds, Sampo for
  changesets and versions of `npm/@k-otp/sdk` (`.sampo/config.toml`; first
  release 1.0.0, see `docs/releasing.md`).

## Commands

```bash
bun install
bun run typecheck      # ttsc over all tsconfigs
bun run lint           # biome check (lint:fix to autofix)
bun run test           # bun test (includes OpenAPI drift test)
bun run build
bun run check:pack
bun run smoke:dist
bun run size
bun run check:examples # typecheck/build/smoke examples (after build)
bun run e2e:examples   # UI flows of the framework examples in Chromium
bun run check          # all of the above
bun run gen:types      # after changing spec/openapi.json
bun run sync:openapi [--from <file | url>]   # refresh the spec
sampo add              # changeset (npm/@k-otp/sdk) for user-facing changes
```

## When the API changes

Sync spec -> `gen:types` -> update `packages/sdk/src/core/contract.ts` and the
client methods -> `check:openapi` -> update READMEs and `docs/` -> changeset.

## Adding a subpath

New APIs are subpaths of `@k-otp/sdk`, never new packages. Follow "Adding a
subpath" in `docs/releasing.md` (tsdown entry, `exports`, `check-pack.ts`
`EXPECTED_EXPORTS`, tsconfig `paths`, size budget, smoke check).
