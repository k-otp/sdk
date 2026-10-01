# Contributing

Thanks for helping improve the K-OTP SDKs.

## Setup

Requirements: [Bun](https://bun.sh) 1.4.2 (see `packageManager`), Node.js >= 22.18
for the dist smoke test and the node-server example (see `engines`), and Go available on `PATH` the first time `ttsc`
builds its lint plugin (cached under `node_modules/.cache/ttsc`).

```bash
bun install
bun run check
```

## Scripts

| Script | What it does |
| --- | --- |
| `bun run typecheck` | ttsc (TypeScript 7) over every package, tests and scripts, with `@ttsc/lint` type-aware rules. |
| `bun run lint` / `lint:fix` | Biome lint + format check / autofix. |
| `bun run test` | Package unit tests (`bun test packages`, including the OpenAPI drift test), then the adapter + parity tests in `tests/` (happy-dom). |
| `bun run build` | tsdown: `packages/sdk/dist`, ESM + CJS + `.d.ts`/`.d.cts` per subpath (Svelte ESM only), the server browser stub and the IIFE bundle. |
| `bun run check:pack` | Packs `@k-otp/sdk` like the release and validates the tarball (exports map, files, optional peers, framework imports per subpath). |
| `bun run smoke:dist` | Loads every built subpath through the `exports` map with Node.js (ESM, CJS, IIFE, the server `browser` condition). |
| `bun run size` | Size report with budgets per subpath (core, headless, IIFE, each framework subpath alone and with core, server) and a tree-shaking check (no subpath loads another framework, adapter or the server). |
| `bun run scripts/set-framework-versions.ts --react 18 --svelte 4 && bun install && bun run --cwd tests test` | Runs the adapter tests on React 18 / Svelte 4 like the CI `adapter-compat` matrix (revert `package.json` and `bun.lock` afterwards). |
| `bun run check:examples` | Typecheck, build and smoke-test every example against the built package, and check that each framework example's bundle contains only its own subpath. |
| `bun run gen:types` | Regenerates `packages/sdk/src/core/generated/openapi.ts` from `spec/openapi.json`. |
| `bun run sync:openapi [--from <api checkout \| file \| url>]` | Refreshes `spec/openapi.json`. |
| `bun run check` | Everything above (except the generators). |

## Changing the API surface

1. `bun run sync:openapi --from <path-or-url>` then `bun run gen:types`.
2. Update `packages/sdk/src/core/contract.ts` for added/removed operations and
   the client methods that expose them.
3. `bun run check:openapi` must pass.
4. Update `packages/sdk/README.md`, `docs/` (including `docs/reference/`)
   and add a changeset.

Internal/admin endpoints of the K-OTP platform (billing, quota, provider
operations) are out of scope for this public SDK.

## Conventions

- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and
  `isolatedDeclarations` (exported APIs need explicit types; that is what lets
  tsdown emit declarations with oxc).
- No top-level side effects and no `window`/`document` access at import time.
- One package, `@k-otp/sdk` (`packages/sdk`), with a source directory per
  subpath: `src/core`, `src/headless`, `src/server`, `src/react`, `src/vue`,
  `src/svelte`. The core (`src/core`, `src/headless`) must not import any UI
  framework. Each adapter imports only its own framework (an optional peer
  dependency) and the core through relative imports (`../core`,
  `../headless`, `../core/internal`; never `@k-otp/sdk` itself), and wraps
  the shared headless controllers so that behavior stays identical; the
  parity suite in `tests/parity` enforces it. `check:pack` and `size` fail
  when a subpath pulls in another framework.
- Every rejected promise from an SDK method is an `OtpApiError`; configuration
  errors throw `TypeError`.
- Generated files (`packages/sdk/src/core/generated/**`) are never edited by
  hand.

## Commits and changesets

- Conventional commits (`feat(react): ...`, `fix(server): ...`,
  `docs: ...`, `chore: ...`).
- Any user-facing change to `@k-otp/sdk` needs a Sampo changeset for
  `npm/@k-otp/sdk`: `sampo add` (or `sampo add -p npm/@k-otp/sdk -b patch -m
  "..."`), committed under `.sampo/changesets/`. Sampo is the only place
  versions are decided; never edit `version` by hand. See
  [Adding a changeset](./docs/releasing.md#adding-a-changeset).

## Security

Never commit keys. Report vulnerabilities privately through GitHub Security
Advisories (see [docs/security.md](./docs/security.md)).
