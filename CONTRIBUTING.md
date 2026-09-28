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
| `bun run build` | tsdown: ESM + CJS + `.d.ts`/`.d.cts`, plus the sdk-core IIFE bundle. |
| `bun run check:pack` | Packs each package like the release and validates the tarball. |
| `bun run smoke:dist` | Loads the built ESM/CJS/IIFE output with Node.js. |
| `bun run size` | Browser bundle size report with budgets (core, IIFE, each adapter alone and with core). |
| `bun run scripts/set-framework-versions.ts --react 18 --svelte 4 && bun install && bun run --cwd tests test` | Runs the adapter tests on React 18 / Svelte 4 like the CI `adapter-compat` matrix (revert `package.json` and `bun.lock` afterwards). |
| `bun run check:examples` | Typecheck, build and smoke-test every example against the built packages. |
| `bun run gen:types` | Regenerates `packages/sdk-core/src/generated/openapi.ts` from `spec/openapi.json`. |
| `bun run sync:openapi [--from <api checkout \| file \| url>]` | Refreshes `spec/openapi.json`. |
| `bun run check` | Everything above (except the generators). |

## Changing the API surface

1. `bun run sync:openapi --from <path-or-url>` then `bun run gen:types`.
2. Update `packages/sdk-core/src/contract.ts` for added/removed operations and
   the client methods that expose them.
3. `bun run check:openapi` must pass.
4. Update the package READMEs and `docs/`.

Internal/admin endpoints of the K-OTP platform (billing, quota, provider
operations) are out of scope for this public SDK.

## Conventions

- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and
  `isolatedDeclarations` (exported APIs need explicit types; that is what lets
  tsdown emit declarations with oxc).
- No top-level side effects and no `window`/`document` access at import time.
- `@k-otp/sdk-core` must not depend on any UI framework. Adapters may only use
  framework peer dependencies, depend on `@k-otp/sdk-core` (`workspace:*`,
  packed as the exact lockstep version) and wrap the shared headless
  controllers so that behavior stays identical; the parity suite in
  `tests/parity` enforces it.
- Every rejected promise from an SDK method is an `OtpApiError`; configuration
  errors throw `TypeError`.
- Generated files (`src/generated/**`) are never edited by hand.

## Commits and changesets

- Conventional commits (`feat(sdk-core): ...`, `fix(sdk-server): ...`,
  `docs: ...`, `chore: ...`).
- Any user-facing change to a published package needs a changeset:
  `sampo add`. All `@k-otp/sdk-*` packages share one version.

## Security

Never commit keys. Report vulnerabilities privately through GitHub Security
Advisories (see [docs/security.md](./docs/security.md)).
