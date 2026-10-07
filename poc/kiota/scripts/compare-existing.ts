import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  command,
  config,
  json,
  outputRoot,
  root,
  sha256,
  stage,
} from "./common";

const out = path.join(outputRoot, "ExistingTypeScript-raw");
await mkdir(path.join(out, "consumer"), { recursive: true });
const runner = path.join(
  root,
  "poc/kiota/harness/existing-typescript/runner.ts",
);
const execution = await command(
  [
    "bun",
    "run",
    path.join(root, "poc/kiota/scripts/wire.ts"),
    "bun",
    "run",
    runner,
  ],
  path.join(out, "logs/comparison.txt"),
  root,
  { POC_TARGET_DIR: out },
);
const spec = await Bun.file(path.join(root, config.spec)).json();
const wireEvidence = await Bun.file(
  path.join(out, "reports/wire-cases.json"),
).json();
await json(path.join(out, "reports/result.json"), {
  sourceCommit: (
    await command(
      ["git", "rev-parse", "HEAD"],
      path.join(out, "logs/commit.txt"),
    )
  ).output.trim(),
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  specSha256: sha256(await Bun.file(path.join(root, config.spec)).bytes()),
  fixtureSha256: sha256(
    await Bun.file(path.join(root, "poc/kiota/fixtures/contract.json")).bytes(),
  ),
  openapiVersion: spec.openapi,
  apiContractVersion: spec.info.version,
  kiotaVersion: null,
  actionCommit: config.actionCommit,
  target: "ExistingTypeScript",
  inputVariant: "raw",
  runtimeVersions: {
    bun: Bun.version,
    os: process.platform,
    runner: process.env.ImageOS ?? "local",
  },
  dependencyLockHash: {
    "bun.lock": sha256(await Bun.file(path.join(root, "bun.lock")).bytes()),
  },
  generatedSourceFiles: 0,
  generation: stage("not_applicable", "Existing hand-written SDK comparison"),
  buildOrLoad: stage(
    wireEvidence.runnerExitCode === 0 ? "passed" : "failed",
    "Bun loads the existing public server client; regression/build are checked by the separate existing-sdk job",
  ),
  wireContract: stage(
    execution.exitCode ? "failed" : "passed",
    execution.output.trim(),
  ),
  kotlinInterop: stage("not_applicable"),
  packageConsumer: stage(
    "not_applicable",
    "Source API comparison; existing distribution has its own pack/smoke checks",
  ),
  reproducibility: stage("not_applicable"),
  warningSummary: [],
  blockers: execution.exitCode
    ? [
        "Existing SDK exposes a normalized error view: defined/raw Retry-After are unavailable; invalid idempotency rejects as OtpApiError. Inspect the same fixture's per-case evidence.",
      ]
    : [],
  evidencePaths: [
    path.relative(root, execution.log),
    path.relative(root, path.join(out, "reports/wire-cases.json")),
  ],
});
console.log(execution.output.trim());
process.exitCode = execution.exitCode ? 1 : 0;
