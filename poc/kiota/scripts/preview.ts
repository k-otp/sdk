import { cp, mkdir, rm } from "node:fs/promises";
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
import { identityIssues } from "./evidence";
import { assessPreview, previewSourceHash } from "./preview-evidence";
import { previewPackages } from "./preview-package";

const target = process.argv[2];
if (!target || !previewPackages[target])
  throw new Error("A preview SDK target is required");
const source = path.join(outputRoot, `${target}-overlay`);
const out = path.join(outputRoot, `${target}-preview`);
const result = await Bun.file(path.join(source, "reports/result.json")).json();
const sourceCommit = (
  await command(
    ["git", "rev-parse", "HEAD"],
    path.join(source, "logs/preview-commit.txt"),
  )
).output.trim();
const context = {
  sourceCommit,
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  specSha256: sha256(await Bun.file(path.join(root, config.spec)).bytes()),
  fixtureSha256: sha256(
    await Bun.file(path.join(root, "poc/kiota/fixtures/contract.json")).bytes(),
  ),
  actionCommit: config.actionCommit,
};
const identity = identityIssues(result, context, target, "overlay");
if (identity.length) throw new Error(identity.join("; "));
if (
  result.generation.status !== "passed" ||
  result.reproducibility.status !== "passed"
)
  throw new Error(
    "Successful overlay generation and regeneration are required",
  );
// Go's module cache contains read-only module directories. Clean that private
// cache with Go before removing the remaining preview workspace.
if (target === "Go") {
  const cleanup = await command(
    [process.env.GO_BIN ?? "go", "clean", "-modcache"],
    path.join(out, "logs/module-cache-clean.txt"),
    root,
    { GOMODCACHE: path.join(out, "module-cache") },
  );
  if (cleanup.exitCode)
    throw new Error("Private Go module cache cleanup failed");
}
await rm(out, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
await mkdir(out, { recursive: true });
for (const directory of ["generated", "reports"])
  await cp(path.join(source, directory), path.join(out, directory), {
    recursive: true,
  });
for (const field of [
  "buildOrLoad",
  "wireContract",
  "packageConsumer",
  ...(target === "Kotlin" ? ["kotlinInterop"] : []),
])
  result[field] = stage("not_run");
result.blockers = [];
result.previewPackage = {
  ...previewPackages[target],
  channel: "local-preview",
  profile: "preview",
  sourceHash: await previewSourceHash(target),
};
await json(path.join(out, "reports/result.json"), result);
const execution = await command(
  [
    "bun",
    "run",
    path.join(root, "poc/kiota/scripts/harness.ts"),
    target,
    "overlay",
  ],
  path.join(out, "logs/preview-build.txt"),
  root,
  { POC_PROFILE: "preview" },
);
const fresh = await Bun.file(path.join(out, "reports/result.json")).json();
const wireFile = Bun.file(path.join(out, "reports/wire-cases.json"));
const wire = (await wireFile.exists()) ? await wireFile.json() : null;
const observationsFile = Bun.file(
  path.join(out, "reports/consumer-observations.json"),
);
const verdict = assessPreview(
  fresh,
  wire,
  (await observationsFile.exists()) ? await observationsFile.json() : [],
  context,
  await previewSourceHash(target),
);
if (execution.exitCode !== 0)
  verdict.errors.push(`Preview consumer command exited ${execution.exitCode}`);
const passed = verdict.errors.length === 0;
await json(path.join(out, "reports/preview-verdict.json"), {
  target,
  ...fresh.previewPackage,
  sourceCommit: fresh.sourceCommit,
  runId: fresh.runId,
  runAttempt: fresh.runAttempt,
  specSha256: fresh.specSha256,
  fixtureSha256: fresh.fixtureSha256,
  actionCommit: config.actionCommit,
  passed,
  errors: verdict.errors,
});
for (const error of verdict.errors) console.error(error);
console.log(
  `${target}: preview package ${fresh.previewPackage.version} ${passed ? "passed" : "FAILED"}`,
);
process.exitCode = passed ? 0 : 1;
