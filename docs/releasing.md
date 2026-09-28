# Releasing

All `@k-otp/sdk-*` packages are versioned in lockstep with
[Sampo](https://github.com/bruits/sampo) (`.sampo/config.toml`, `fixed` group)
and published to npm with
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (GitHub OIDC,
no npm token in the repository).

## Day-to-day flow

1. Every PR that changes a published package adds a changeset:
   `sampo add` (CI warns when one is missing).
2. After merge to `main`, the **Release** workflow updates a single
   `sampo/release` PR with version bumps and changelogs.
3. Merging the release PR pushes new versions to `main`; the workflow sees
   unpublished versions and runs `scripts/publish-oidc.sh`, which builds,
   runs `check:pack`, publishes each package with `npm publish <tarball>`,
   tags `vX.Y.Z` plus per-package tags, and creates a GitHub Release.

Version `0.0.0` is the "never released" placeholder and is never published.

## Safe no-op until the owner enables publishing

Publishing only happens when the repository variable
`NPM_TRUSTED_PUBLISHING` is `true`. Without it, the workflow keeps the release
PR up to date and logs a warning instead of publishing.

## One-time owner setup

1. **GitHub repository** `k-otp/k-otp-sdk` (public). In *Settings -> Actions ->
   General*, allow GitHub Actions to create and approve pull requests (needed
   for the release PR).
2. **npm scope.** Make sure the `@k-otp` npm organization exists and you are an
   owner.
3. **Create the packages on npm.** Trusted Publishing is configured per
   package. If npm does not let you configure it for a package that has never
   been published, bootstrap once from a trusted machine:
   ```bash
   bun install && bun run check
   # after merging the first release PR (versions are 0.1.0):
   cd packages/sdk-core && bun pm pack && npm publish k-otp-sdk-core-0.1.0.tgz --access public
   cd ../sdk-server && bun pm pack && npm publish k-otp-sdk-server-0.1.0.tgz --access public
   cd ../sdk-react && bun pm pack && npm publish k-otp-sdk-react-0.1.0.tgz --access public
   cd ../sdk-vue && bun pm pack && npm publish k-otp-sdk-vue-0.1.0.tgz --access public
   cd ../sdk-svelte && bun pm pack && npm publish k-otp-sdk-svelte-0.1.0.tgz --access public
   ```
   Always publish the `bun pm pack` tarball (it rewrites `workspace:*` to the
   exact version), never `npm publish` inside the package directory. Then tag
   the release commit (`git tag v0.1.0 && git push origin v0.1.0`) and create
   the GitHub Release.
4. **Configure Trusted Publishing** for each package (`@k-otp/sdk-core`,
   `@k-otp/sdk-server`, `@k-otp/sdk-react`, `@k-otp/sdk-vue`,
   `@k-otp/sdk-svelte`) on npmjs.com -> package ->
   *Settings -> Trusted publishing*:
   - Publisher: GitHub Actions
   - Organization or user: `k-otp`
   - Repository: `k-otp-sdk`
   - Workflow filename: `release.yml`
   - Environment: leave empty (or add one and reference it in the workflow)
5. Optionally, in each package's npm settings, require two-factor
   authentication and disallow token publishing.
6. **Enable publishing:** *Settings -> Secrets and variables -> Actions ->
   Variables* -> add `NPM_TRUSTED_PUBLISHING` = `true`.
7. Protect `main` (require the CI checks) and the `v*` tags.

Trusted Publishing needs Node >= 22.14 and npm >= 11.5.1 on the runner (the
workflow uses Node 24). Packages published this way automatically get npm
provenance attestations.

## Adding a package to the lockstep group

1. Add it under `packages/` with `"version"` equal to the current release
   version (or `0.0.0` before the first release).
2. Add `npm/<name>` to the `fixed` group in `.sampo/config.toml`.
3. Add its directory to `PACKAGE_DIRS` in `scripts/publish-oidc.sh` (after its
   dependencies) and to `PACKAGES` / `ALLOWED_DEPENDENCIES` (and
   `REQUIRED_PEERS` for framework adapters) in `scripts/check-pack.ts`.
4. Add its build to the root `build` script, its `tsconfig.json` to
   `scripts/typecheck.ts`, a source `paths` entry to `tsconfig.base.json`, a
   size budget to `scripts/size-report.ts` and a smoke check to
   `scripts/smoke-dist.mjs`.
5. Framework adapters: depend on `@k-otp/sdk-core` with `workspace:*` (packed
   as the exact lockstep version), declare the framework as a
   `peerDependency`, and put framework dev packages in the root
   `devDependencies` (published manifests must not carry
   `devDependencies`).
6. Configure Trusted Publishing for the new npm package (steps 3-4 above).

## Manual checks

```bash
./scripts/publish-oidc.sh --check   # should_publish=true|false
sampo release --dry-run             # planned version bumps
bun run check                       # full local gate
```
