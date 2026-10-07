# Kiota multi-language PoC

This evaluates the vendored public `/v1` OpenAPI with Kiota 1.35.0. All native
SDKs are unpublished fixtures outside the Bun/Sampo release workspace. See the
[adoption report](ADOPTION.md) for the measured scope and
remaining failures.

Public preview wrapper packages and their usage guides are under
[`preview/`](../../sdks/README.md). They include client setup, all nine operations,
normalized API errors and K-OTP idempotency/retry policy in the installed artifact.
Internal build/CI evidence stays in this PoC directory.

## Run a target

Run from the repository root with Bun 1.4.2 and the native toolchain installed.
Use a new `POC_OUTPUT` directory when comparing commits; result collection
rejects another commit/run/spec/fixture's evidence.

```sh
bun install --frozen-lockfile
export KIOTA_BIN=/absolute/path/to/kiota
export POC_OUTPUT=.cache/kiota-poc/local-current

bun run poc/kiota/scripts/generate.ts Java raw
bun run poc/kiota/scripts/reproduce.ts Java raw
bun run poc/kiota/scripts/harness.ts Java raw

bun run poc/kiota/scripts/generate.ts Java overlay
bun run poc/kiota/scripts/reproduce.ts Java overlay
bun run poc/kiota/scripts/harness.ts Java overlay
bun run poc/kiota/scripts/preview.ts Java

bun run poc/kiota/scripts/report.ts
```

The strict `harness.ts` exits nonzero for raw compatibility gaps. Execute the
commands separately and inspect each exit code. CI uses `ci-target.ts` to assert
the exact reviewed negative regression in `fixtures/known-baseline-gaps.json`;
the raw SDK's `wireContract` remains `failed`. Every SDK overlay must pass all
28 cases, and cannot appear in that failure inventory. `report.ts --gate`
requires complete overlay generation/build/wire/package/regeneration evidence
for CSharp, Java, Kotlin, PHP, Go, Python, Ruby, Dart and TypeScript, plus Kotlin
interoperability and complete raw/HTTP/comparison evidence. Running only Java
does not satisfy that gate.

`targets.json` generates all raw/overlay matrix entries. Kotlin uses the Java
generator and a separate Kotlin JVM consumer; HTTP inspects request examples.
Swift is outside the generation matrix:

```sh
bun run poc/kiota/scripts/generate.ts Swift raw
bun run poc/kiota/scripts/compare-existing.ts
bun run poc/kiota/scripts/ci-target.ts ExistingTypeScript raw
bunx --no-install ttsc --noEmit -p poc/kiota/tsconfig.json
bun test poc/kiota/overlays poc/kiota/mock poc/kiota/scripts/evidence.test.ts poc/kiota/scripts/ci-policy.test.ts
bun run check
```

The existing SDK comparison deliberately uses the same strict fixture. Its
normalized error API does not expose every raw envelope/header field. The
comparison records those differences with a failing exit code. `ci-target.ts`
asserts those exact differences as a negative comparison; `bun run check` is
the independent existing SDK regression gate.

## Pinned environment

CI runs on `ubuntu-24.04` (actual OS/architecture/runner/tool output is recorded
in result JSON and logs). The action and CLI are separate pins:

- setup-kiota v0.5.0: `111eb592b2b3b2602ba9e0d979d4a4509cd59bb5`
- Release `v1.35.0`, action input `version: v1.35.0`
- Required full CLI build: `1.35.0+114aa7ee609262d892fd9ceb02b2d9f7ecb84190`
- OpenAPI `3.1.1`; service contract `1.8.0`
- Vendored SHA-256: `d0a122d0855be1bbd133b0649c4851e33d69b0c36c244a05b0b61ff16d4f91da`

| Target | Native toolchain | Main Kiota runtime pin |
| --- | --- | --- |
| CSharp | .NET SDK 8.0.303 | Bundle 2.0.0 + NuGet lock |
| Java / Kotlin | Temurin 21.0.8+9, Maven 3.9.9, Kotlin 2.1.20 | Java bundle/serializers 1.9.3; Jakarta annotations 2.1.1 |
| PHP | PHP 8.4.4, Composer 2.8.6 | Bundle 2.1.0 + Composer lock |
| Go | Go 1.26.5 | Abstractions 1.11.1, HTTP 1.5.4 + module sums |
| Python | Python 3.13.2 | Bundle 1.14.2 + exact hash-locked requirements |
| Ruby | Ruby 3.3.6, Bundler 2.5.22 | Abstractions/Faraday/JSON 0.24.0 + Gemfile lock |
| Dart | Dart 3.9.4 | Bundle 0.1.1 + Pub lock |
| TypeScript | Bun 1.4.2, ttsc 0.30.4, TypeScript 7.0.2 | Bundle 1.0.0-preview.106 + Bun lock |

Optional `MAVEN_BIN`, `GO_BIN`, `RUBY_BIN`, `DART_BIN` select absolute executables
locally. Other native executables must be on `PATH`. The JVM emits Java 17
bytecode; Android and Kotlin Multiplatform are untested.

## What the harness proves

`generate.ts` saves `--version`, `generate --help`, `info`, per-language runtime
recommendations, warning categories, source hashes, public declarations and
operation inventory. It performs two clean generations and compares every code
file byte for byte; no source normalization or generated edits are used.

`harness.ts` compiles/loads all generated files with the real runtimes. It then
creates a local NuGet package, Java JAR, wheel, Composer ZIP, Go module ZIP,
gem, Dart source archive or Bun tarball and uses a separate consumer. Consumers
reference the installed artifact, not the original generated source workspace.
Package hashes and dependency metadata are retained. HTTP has no SDK package.

`wire.ts` starts a guarded loopback HTTP server. Real generated request builders,
serializers and adapters process 28 shared contract cases covering all nine
operations. A separate observation records the runtime's default retry chain;
it is not counted as a successful K-OTP contract case. The PoC usage policy
disables automatic retries, validates issue idempotency before transport, and
allows one explicit 503 retry with the same key/body. Timeouts remain unknown.

The overlay is generated by `overlays/compat.ts`, with every change and its
reason saved. Enum/type adaptations preserve permitted values; the common error
view deliberately loses branch-specific const/typed-data validation. The raw
spec stays intact. Ruby's overlay adds float format annotations to select the
official numeric parser, retaining all numeric constraints. Dart's optional
unconstrained error `data` uses `additionalProperties` to preserve the JSON tree
through the official additional-data path.

Ruby, Dart and TypeScript require the small `preview/<language>/` compatibility
compatibility layers as well as the generated artifact and K-OTP retry policy.
They repair enum wire values, dynamic JSON/boolean handling and null response
objects through the official runtime. Ruby uses a narrowly guarded parser
prepend; it is process-wide and version-specific. Native guard tests verify
that unrelated parser errors still propagate, all Dart enum query values are
sent correctly, and null objects remain distinct from empty objects. The
packaged SDK alone is not the validated profile. No Kiota/runtime fork or
generated source patch is used.

`reproduce.ts Java` confirms the smallest oneOf error-mapping
failure/fix; `reproduce.ts Go` confirms the nil optional-date panic in 1.9.3 and
its absence in the selected 1.11.1 runtime.

## Evidence and CI

For each target/variant, `.cache/kiota-poc/runs/<Target>-<variant>/` contains:

- `generated/`, `regenerated/`: original generator output, ignored by Git.
- `logs/`: commands and native tool output, separate from clean-output paths.
- `reports/result.json`: six independent stage statuses and provenance.
- `reports/source-manifest.json`, `public-api.txt`, `operations.json`,
  `regeneration-diff.json`: reproducibility and API review evidence.
- `reports/wire-cases.json`, `http-requests.json`, `consumer-observations.json`,
  `default-retry.json`: actual wire behavior; keys/OTP/phone numbers masked.
- `reports/ci-verdict.json`: CI validation separate from SDK compatibility.
- `packages/`, `repros/`: local artifacts and minimal regressions when applicable.

`<Target>-preview/` contains the separately built preview package and a consumer
that imports only its public client. `preview.ts` validates all 28 contracts,
public `requestId`/`retryAfterMs`, package hashes and current source/run identity.
It uses the corresponding clean overlay generation as input. All nine preview
consumers are mandatory CI checks, including Kotlin's consumption of the Java JAR.
Artifacts include a usage README and MIT license. Native pre-release versions
and public entry points are listed in `../../sdks/packages.json`; no registry publish
or existing SDK version change is involved.

CI uploads evidence even when a native stage fails, then writes JSON/Markdown
and Job Summary from this run only. Missing or mismatched artifacts never
satisfy the gate. All eight SDK languages and the Kotlin/JVM overlay consumer
are required positive tests. Raw, HTTP and existing-SDK comparison tests assert
the exact reviewed failure inventory: changed failures, unexpected fixes,
crashes, dependency/build/package failures and missing cases fail CI. The
inventory is never automatically refreshed. SDK compatibility remains failed
in its original stage even when that negative test passes. CLI/spec/fixture
changes require baseline review. There is no `continue-on-error` suppression.

No production OTP requests, remote spec replacement, package publication,
release/tag/mirror creation, main merge or SDK version change is performed.
