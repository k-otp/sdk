import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  config,
  json,
  outputRoot,
  type Stage,
  type StageResult,
  stage,
} from "./common";

type ReportRow = {
  target: string;
  inputVariant: string;
  blockers: string[];
} & Record<Stage, StageResult>;
const results: ReportRow[] = [];
for (const target of config.targets) {
  for (const variant of target.target === "Swift"
    ? ["raw"]
    : ["raw", "overlay"]) {
    const location = path.join(
      outputRoot,
      `${target.target}-${variant}/reports/result.json`,
    );
    if (await Bun.file(location).exists())
      results.push(await Bun.file(location).json());
    else {
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
        target: target.target,
        inputVariant: variant,
        blockers: ["missing evidence for this run"],
        ...(missing as Record<Stage, StageResult>),
      });
    }
  }
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
const markdown = `# Kiota PoC evidence\n\n${table}\n\nStage success only covers that stage. Missing artifacts never reuse prior runs.\n\n${results
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
