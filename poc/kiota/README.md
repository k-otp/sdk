# Kiota multi-language PoC

These unpublished fixtures evaluate the vendored public OpenAPI with Kiota
1.35.0. The generated code does not replace `@k-otp/sdk`.

```sh
KIOTA_BIN=/absolute/path/to/kiota bun run poc/kiota/scripts/generate.ts Java raw
bun run poc/kiota/scripts/report.ts
```

The selected release is `v1.35.0`; setup-kiota v0.5.0 resolves to commit
`111eb592b2b3b2602ba9e0d979d4a4509cd59bb5`. CLI version discovery must match the
full build string in `targets.json`. Logs, generated sources, hashes and results
are kept in `.cache/kiota-poc/runs`, outside the release workspace.

Generation and a byte-for-byte second generation are the first two checks.
Other stages remain `not_run` until real runtime harnesses provide evidence.
Swift is not in the execution matrix; its absence is checked against the pinned
CLI help. HTTP is a request-example target and is not counted as an SDK.

No remote spec downloads, external registry publishing or production OTP calls
are part of this PoC. See the final adoption report in `docs/kiota-poc-results.md`.
