# Sampo

This repository uses [Sampo](https://github.com/bruits/sampo) for changesets,
versioning and the changelog of its only published package, `@k-otp/sdk`
(`npm/@k-otp/sdk`, in `packages/sdk`). All subpaths (`/server`, `/react`,
...) share that version.

- Add a changeset for any user-facing change under `packages/sdk`:

  ```bash
  sampo add            # interactive
  sampo add -p npm/@k-otp/sdk -b patch -m "Fix ..."
  ```

- Preview the next release locally (releases are cut from `main`):

  ```bash
  SAMPO_RELEASE_BRANCH=main sampo release --dry-run
  ```

After merges to `main`, the Release workflow keeps a single `sampo/release` PR
(version bump + changelog) up to date. Merging that PR publishes to npm once
Trusted Publishing is enabled; see [docs/releasing.md](../docs/releasing.md),
which also explains the first release (`0.0.0 -> 1.0.0`).
