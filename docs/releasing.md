# Releasing

The repository publishes one npm package, **`@k-otp/sdk`** (`packages/sdk`).
Its subpaths (`/core`, `/headless`, `/contract`, `/server`, `/react`, `/vue`,
`/svelte`, `/ui`, `/ui/react`, `/ui/vue`, `/ui/svelte`, `/ui/theme.css`, the
IIFE bundle) are not separate packages and share its version.
[Sampo](https://github.com/bruits/sampo) is the single source of version
management (changesets -> version bump -> `CHANGELOG.md`), and the package is
published to npm with [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(GitHub OIDC, no npm token in the repository).

## Adding a changeset

Every PR that changes what `@k-otp/sdk` users get (anything under
`packages/sdk/src`, its `package.json`, or the vendored spec when it changes
the generated types) adds a changeset. CI warns when one is missing.

```bash
sampo add                                              # interactive
sampo add -p npm/@k-otp/sdk -b patch -m "Fix ..."      # non-interactive
```

This writes a Markdown file under `.sampo/changesets/`; commit it with the
change. By hand, the same file looks like:

```md
---
npm/@k-otp/sdk: minor
---

Add `foo` to `@k-otp/sdk/react` ...
```

- The package id is always `npm/@k-otp/sdk`, whichever subpath changed;
  name the subpath in the text.
- Bump: `patch` for fixes, `minor` for backwards-compatible features, `major`
  for breaking changes to any public subpath (SemVer applies from 1.0.0).
- Write the text for users: it becomes the changelog entry.

Preview the next release locally (Sampo only releases from `main`; set
`SAMPO_RELEASE_BRANCH=main` to preview from a feature branch):

```bash
SAMPO_RELEASE_BRANCH=main sampo release --dry-run   # e.g. "@k-otp/sdk: 1.0.0 -> 1.1.0"
```

## Day-to-day flow

1. PRs add changesets (above).
2. After merge to `main`, the **Release** workflow
   (`.github/workflows/release.yml`) runs Sampo, which keeps a single
   `sampo/release` PR up to date: it consumes the pending changesets, bumps
   `packages/sdk/package.json` and writes `packages/sdk/CHANGELOG.md`.
   Sampo's lockfile refresh also moves every dependency (and the lockfile's
   copy of the catalog), which the frozen installs reject, so the workflow
   then runs `scripts/release-lockfile.sh`: it rebuilds the branch's
   `bun.lock` from `main`'s with `bun install --lockfile-only` and pushes a
   `chore(release): keep only the version bumps in bun.lock` commit, so the
   release PR changes nothing in `bun.lock` but the workspace versions.
3. Merging the release PR pushes the new version to `main`; the workflow sees
   an unpublished version and runs `scripts/publish-oidc.sh`, which builds,
   runs `check:pack` and `smoke:dist`, publishes the `bun pm pack` tarball
   with `npm publish <tarball>`, tags `vX.Y.Z`, and
   creates a GitHub Release.

## The first release: 1.0.0

`packages/sdk/package.json` keeps `"version": "0.0.0"`, the "never released"
placeholder that `publish-oidc.sh` never publishes. The pending changeset
`.sampo/changesets/initial-release.md` is a `major` bump for
`npm/@k-otp/sdk`, which Sampo turns into **1.0.0** (`0.0.0 -> 1.0.0`). It
replaces the earlier per-package changesets of the former `@k-otp/sdk-*`
packages, which were never published. Do not edit the `version` field by
hand; let the release PR set it.

## Recovering a half-finished release

`publish-oidc.sh --check` reports two separate outputs:

- `should_publish=true`: the package version is not on npm yet. The workflow
  publishes, and skips the Sampo step in that run (the release PR is updated
  again on the next push).
- `needs_finalize=true`: the version is on npm, but the release tag
  (`vX.Y.Z`) or the GitHub Release is missing (an
  earlier run failed after `npm publish`). The workflow re-runs the publish
  step, which skips the published package and only creates what is missing.
  This output does not gate the Sampo step, so a stuck recovery can never
  stop the release PR from being updated. Tag and Release lookups are
  retried; if they keep failing, `--check` warns and reports
  `needs_finalize=false` for that run instead of failing the job.

When tags must be created, recovery tags the commit that shipped the version,
not the current `HEAD`: npm's recorded `gitHead` when present, otherwise the
last commit that set `"version": "X.Y.Z"` in `packages/sdk/package.json`. If
neither is found the script fails and asks you to tag manually. When every
tag exists and only the GitHub Release is missing, no commit is resolved.

## Safe no-op until the owner enables publishing

Publishing only happens when the repository variable
`NPM_TRUSTED_PUBLISHING` is `true`. Without it, the workflow keeps the release
PR up to date and logs a warning instead of publishing.

## One-time owner setup

1. **GitHub repository** `k-otp/sdk` (public). In *Settings -> Actions ->
   General*, allow GitHub Actions to create and approve pull requests (needed
   for the release PR).
2. **npm organization.** Create the `k-otp` npm organization (scope
   `@k-otp`) and make sure you are an owner.
3. **Create the package on npm.** Trusted Publishing is configured per
   package. If npm does not let you configure it for a package that has never
   been published, bootstrap once from a trusted machine after merging the
   first release PR (version 1.0.0):
   ```bash
   bun install && bun run check
   cd packages/sdk && bun pm pack && npm publish k-otp-sdk-1.0.0.tgz --access public
   ```
   Always publish the `bun pm pack` tarball (it rewrites `catalog:` ranges to
   real versions), never `npm publish` inside the package directory. Then tag
   the release commit (`git tag v1.0.0 && git push origin v1.0.0`) and
   create the GitHub Release, or
   let the next workflow run finalize it (`needs_finalize`).
4. **Configure Trusted Publishing** for `@k-otp/sdk` on npmjs.com -> package
   -> *Settings -> Trusted publishing*:
   - Publisher: GitHub Actions
   - Organization or user: `k-otp`
   - Repository: `sdk` (i.e. `k-otp/sdk`)
   - Workflow filename: `release.yml`
   - Environment: leave empty (or add one and reference it in the workflow)
5. Optionally, in the package's npm settings, require two-factor
   authentication and disallow token publishing.
6. **Enable publishing:** *Settings -> Secrets and variables -> Actions ->
   Variables* -> add `NPM_TRUSTED_PUBLISHING` = `true`.
7. Protect `main` (require the CI checks) and the `v*` tags.

Trusted Publishing needs Node >= 22.14 and npm >= 11.5.1 on the runner (the
workflow uses Node 24). Packages published this way automatically get npm
provenance attestations.

## Adding a subpath

New public APIs are subpaths of `@k-otp/sdk`, not new packages:

1. Add the source under `packages/sdk/src/<name>/` and an entry in
   `packages/sdk/tsdown.config.ts` (both the ESM and, unless ESM-only, the
   CJS entry list). Import other parts of the SDK relatively, never through
   `@k-otp/sdk`.
2. Add the subpath to `exports` in `packages/sdk/package.json`, to
   `EXPECTED_EXPORTS` in `scripts/check-pack.ts`, and a source `paths` entry
   to `tsconfig.base.json`. A new framework peer goes to `peerDependencies` +
   `peerDependenciesMeta` (optional), `ALLOWED_DEPENDENCIES` / `FRAMEWORKS` in
   `scripts/check-pack.ts`, and the root `devDependencies`.
3. Add a size budget and tree-shaking check to `scripts/size-report.ts` and a
   smoke check to `scripts/smoke-dist.mjs`.
4. Document it in `packages/sdk/README.md` and add a changeset (`minor`).

CSS files are the only files with side effects (`"sideEffects":
["**/*.css"]`, checked by `scripts/check-pack.ts`). Use the `**/` form: a
bare `*.css` only matches the package root in Rolldown-based Vite, which then
drops `dist/ui/theme.css` from app builds. Files that tsdown does not build
(the `.svelte` sources of `ui/svelte`, the theme) are copied by the `copy`
option in `packages/sdk/tsdown.config.ts`.

## Manual checks

```bash
./scripts/publish-oidc.sh --check                  # should_publish / needs_finalize
SAMPO_RELEASE_BRANCH=main sampo release --dry-run  # planned version bump
./scripts/release-lockfile.sh                      # fix a drifted sampo/release lockfile (pushes)
bun run check                                      # full local gate
```

## Native server SDKs

`sdks/packages.json` owns the native coordinates and independent version
(currently 0.1.0). npm remains one Sampo package; its `/kiota` subpath shares
the existing npm version. Do not publish the raw or fixture-only packages.

1. Change wrappers under `sdks/` and add a Sampo changeset when `/kiota` changes.
2. Require the existing CI plus the complete Kiota SDK validation on the PR.
   `kiota-poc.yml` is manual only: run `gh workflow run kiota-poc.yml --ref <branch>`.
3. Merge, merge the Sampo release PR, and let `release.yml` publish npm via OIDC.
4. Dispatch `kiota-poc.yml` on main at the final release commit
   (`gh workflow run kiota-poc.yml --ref main`) and wait for it to succeed.
5. Dispatch `release-sdks.yml` on main with that validation run ID. It rejects
   stale, failed, PR or unrelated workflow evidence, validates all nine installed
   consumers and artifact hashes, then publishes `server-sdk-v0.1.0` with native
   packages, checksums and validation records. It never re-builds release assets.

Go needs committed source for module discovery. The release workflow adds the
exact verified module ZIP contents to a separate snapshot commit under
`sdks/go` and tags it `sdks/go/v0.1.0`. The main branch keeps generated code in
`.cache`. Go proxy installation must be verified after publishing the tag.
The release is created as a draft, uploaded completely, and then published.
An existing published release is never overwritten.

NuGet, Maven Central, PyPI, RubyGems, pub.dev and Packagist need publisher
accounts/namespace ownership configured before registry upload. GitHub release
assets are installable meanwhile; language guides use this route. Maven assets
include the real POM, sources and Javadoc; signing and Central credentials are
configured with the publisher account. Packagist additionally needs a repository
with composer.json at its root, so it needs a separately configured distribution
repository before it can be submitted.
