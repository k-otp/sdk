import path from "node:path";
import { assess, type ResultRow, type WireEvidence } from "./ci-policy";
import { command, config, json, outputRoot, root, sha256 } from "./common";
import { identityIssues } from "./evidence";

const target = process.argv[2];
const variant = process.argv[3] ?? "raw";
if (!target) throw new Error("A CI consumer target is required");
if (
  !config.targets.some((item) => item.target === target && item.harness) &&
  target !== "ExistingTypeScript"
)
  throw new Error(`No CI consumer for ${target}`);
const out = path.join(outputRoot, `${target}-${variant}`);
const script =
  target === "ExistingTypeScript" ? "compare-existing.ts" : "harness.ts";
const run = await command(
  ["bun", "run", path.join(root, "poc/kiota/scripts", script), target, variant],
  path.join(out, "logs/ci-consumer-command.txt"),
);
const sourceCommit = (
  await command(
    ["git", "rev-parse", "HEAD"],
    path.join(out, "logs/ci-commit.txt"),
  )
).output.trim();
let errors: string[] = [];
try {
  const row: ResultRow & Record<string, unknown> = await Bun.file(
    path.join(out, "reports/result.json"),
  ).json();
  errors = identityIssues(
    row,
    {
      sourceCommit,
      runId: process.env.GITHUB_RUN_ID ?? "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
      specSha256: sha256(await Bun.file(path.join(root, config.spec)).bytes()),
      fixtureSha256: sha256(
        await Bun.file(
          path.join(root, "poc/kiota/fixtures/contract.json"),
        ).bytes(),
      ),
      actionCommit: config.actionCommit,
    },
    target,
    variant,
  );
  const wireFile = Bun.file(path.join(out, "reports/wire-cases.json"));
  const httpFile = Bun.file(path.join(out, "reports/http-examples.json"));
  const verdict = assess(
    row,
    (await wireFile.exists())
      ? ((await wireFile.json()) as WireEvidence)
      : null,
    (await httpFile.exists()) ? await httpFile.json() : null,
  );
  errors.push(...verdict.errors);
  const expectedExit = verdict.compatibilityPassed ? 0 : 1;
  if (run.exitCode !== expectedExit)
    errors.push(
      `consumer command exited ${run.exitCode}, expected ${expectedExit}`,
    );
  await json(path.join(out, "reports/ci-verdict.json"), {
    ...verdict,
    sourceCommit,
    consumerExitCode: run.exitCode,
    validationPassed: errors.length === 0,
    errors,
  });
  console.log(
    `${target}/${variant}: SDK wire=${row.wireContract.status}; CI ${verdict.mode}=${errors.length ? "FAILED" : "passed"}`,
  );
  if (verdict.expectedGap) console.log(verdict.expectedGap);
} catch (error) {
  errors.push(`missing or malformed evidence: ${String(error)}`);
}
for (const error of errors) console.error(error);
process.exitCode = errors.length ? 1 : 0;
