import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, json, outputRoot, stage } from "./common";

const results = [];
for (const target of config.targets) {
  const location = path.join(
    outputRoot,
    `${target.target}-raw/reports/result.json`,
  );
  if (await Bun.file(location).exists())
    results.push(await Bun.file(location).json());
  else {
    const missing = Object.fromEntries(
      config.stages.map((key) => [
        key,
        stage(
          target.target === "Swift"
            ? key === "generation"
              ? "unsupported"
              : "not_applicable"
            : "not_run",
          "missing evidence for this run",
        ),
      ]),
    );
    results.push({
      target: target.target,
      inputVariant: "raw",
      blockers: ["missing evidence for this run"],
      ...missing,
    });
  }
}
const header = ["Target", "Input", ...config.stages];
const table = [
  header,
  header.map(() => "---"),
  ...results.map((r) => [
    r.target,
    r.inputVariant,
    ...config.stages.map((key) => r[key].status),
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
      const r = results.find((r) => r.target === t.target);
      return [
        "generation",
        "buildOrLoad",
        "wireContract",
        "packageConsumer",
        "reproducibility",
        ...(t.target === "Kotlin" ? ["kotlinInterop"] : []),
      ].every((key) => r?.[key].status === "passed");
    })
    ? 0
    : 1;
}
