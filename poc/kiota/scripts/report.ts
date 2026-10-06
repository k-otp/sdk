import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  command,
  config,
  json,
  outputRoot,
  root,
  type Stage,
  type StageResult,
  sha256,
  stage,
} from "./common";
import { identityIssues } from "./evidence";

type ReportRow = {
  target: string;
  inputVariant: string;
  blockers: string[];
} & Record<Stage, StageResult> &
  Record<string, unknown>;
const results: ReportRow[] = [];
const sourceCommit = (
  await command(
    ["git", "rev-parse", "HEAD"],
    path.join(outputRoot, "aggregate/source-commit.txt"),
  )
).output.trim();
const spec = await Bun.file(path.join(root, config.spec)).json();
const sourceHash = sha256(await Bun.file(path.join(root, config.spec)).bytes());
const context = {
  sourceCommit,
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  specSha256: sourceHash,
  fixtureSha256: sha256(
    await Bun.file(path.join(root, "poc/kiota/fixtures/contract.json")).bytes(),
  ),
  actionCommit: config.actionCommit,
};
for (const target of config.targets) {
  for (const variant of target.target === "Swift"
    ? ["raw"]
    : ["raw", "overlay"]) {
    const location = path.join(
      outputRoot,
      `${target.target}-${variant}/reports/result.json`,
    );
    let issues = ["missing evidence for this run"];
    if (await Bun.file(location).exists()) {
      const candidate = await Bun.file(location).json();
      issues = identityIssues(candidate, context, target.target, variant);
      if (!issues.length) {
        results.push(candidate);
        continue;
      }
      await json(
        path.join(
          outputRoot,
          "aggregate",
          `rejected-${target.target}-${variant}.json`,
        ),
        { issues, candidate },
      );
    }
    {
      const missing = Object.fromEntries(
        config.stages.map((key) => [
          key,
          stage(
            key === "kotlinInterop" && target.target !== "Kotlin"
              ? "not_applicable"
              : "not_run",
            "missing evidence for this run",
          ),
        ]),
      );
      results.push({
        ...context,
        openapiVersion: spec.openapi,
        apiContractVersion: spec.info.version,
        kiotaVersion: null,
        actionCommit: config.actionCommit,
        runtimeVersions: {},
        dependencyLockHash: {},
        generatedSourceFiles: 0,
        warningSummary: [],
        evidencePaths: [],
        target: target.target,
        inputVariant: variant,
        blockers: issues,
        ...(missing as Record<Stage, StageResult>),
      });
    }
  }
}
const comparisonFile = path.join(
  outputRoot,
  "ExistingTypeScript-raw/reports/result.json",
);
if (await Bun.file(comparisonFile).exists()) {
  const comparison = await Bun.file(comparisonFile).json();
  if (!identityIssues(comparison, context, "ExistingTypeScript", "raw").length)
    results.push(comparison);
}
const header = ["Target", "Input", ...config.stages];
const table = [
  header,
  header.map(() => "---"),
  ...results.map((r) => [
    r.target,
    r.inputVariant,
    ...config.stages.map((key) => r[key as Stage].status),
  ]),
]
  .map((row) => `| ${row.join(" | ")} |`)
  .join("\n");
const markdown = `# Kiota PoC evidence\n\nRequired gate evaluates overlay candidates only. Raw and experimental failures remain failed jobs; this summary is not an all-language support claim.\n\n${table}\n\nStage success only covers that stage. Missing artifacts never reuse prior runs.\n\n${results
  .filter((r) => r.blockers.length)
  .map((r) => `- ${r.target}/${r.inputVariant}: ${r.blockers.join("; ")}`)
  .join("\n")}\n`;
await mkdir(path.join(outputRoot, "aggregate"), { recursive: true });
await json(path.join(outputRoot, "aggregate/results.json"), results);
await Bun.write(path.join(outputRoot, "aggregate/results.md"), markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  await Bun.write(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(table);
if (process.argv.includes("--gate")) {
  process.exitCode = config.targets
    .filter((t) => t.required)
    .every((t) => {
      const r = results.find(
        (r) => r.target === t.target && r.inputVariant === "overlay",
      );
      return [
        "generation",
        "buildOrLoad",
        "wireContract",
        "packageConsumer",
        "reproducibility",
        ...(t.target === "Kotlin" ? ["kotlinInterop"] : []),
      ].every((key) => r?.[key as Stage].status === "passed");
    })
    ? 0
    : 1;
}
