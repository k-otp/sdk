# Sampo

This repository uses [Sampo](https://github.com/bruits/sampo) for changesets,
lockstep versioning and changelogs. All `@k-otp/sdk-*` packages share one
version (see the `fixed` group in `config.toml`).

- Add a changeset for any user-facing change under `packages/*`:

  ```bash
  sampo add            # interactive
  sampo add -p npm/@k-otp/sdk-core -b patch -m "Fix ..."
  ```

- Preview the next release locally:

  ```bash
  sampo release --dry-run
  ```

After merges to `main`, the Release workflow keeps a single `sampo/release` PR
(version bumps + changelogs) up to date. Merging that PR publishes to npm once
Trusted Publishing is enabled; see [docs/releasing.md](../docs/releasing.md).
