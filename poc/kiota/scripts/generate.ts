import { mkdir } from "node:fs/promises";
import path from "node:path";
import { compatibilityOverlay } from "../overlays/compat";
import {
  codeManifest,
  command,
  config,
  json,
  outputRoot,
  root,
  sha256,
  stage,
} from "./common";

const name = process.argv[2];
if (!name) throw new Error("Target is required");
const variant = process.argv[3] ?? "raw";
const target = config.targets.find((value) => value.target === name);
if (!target) throw new Error(`Unknown target ${name}`);
if (!["raw", "overlay"].includes(variant))
  throw new Error(`Unknown input variant ${variant}`);
const out = path.join(outputRoot, `${name}-${variant}`);
const generated = path.join(out, "generated");
const logs = path.join(out, "logs");
const reports = path.join(out, "reports");
await mkdir(reports, { recursive: true });
const specPath = path.join(root, config.spec);
const spec = Bun.file(specPath);
const specText = await spec.text();
const specObject = JSON.parse(specText);
let inputSpecPath = specPath;
if (variant === "overlay") {
  const overlay = compatibilityOverlay(specObject);
  inputSpecPath = path.join(reports, "openapi-overlay.json");
  await json(inputSpecPath, overlay.spec);
  await json(path.join(reports, "overlay-changes.json"), overlay.changes);
}
const cli = process.env.KIOTA_BIN ?? "kiota";
const result = {
  sourceCommit: (
    await command(["git", "rev-parse", "HEAD"], path.join(logs, "commit.txt"))
  ).output.trim(),
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  specSha256: sha256(specText),
  openapiVersion: specObject.openapi,
  apiContractVersion: specObject.info.version,
  kiotaVersion: "",
  actionCommit: config.actionCommit,
  target: name,
  generationLanguage: target.language,
  runtimeVersions: {
    bun: Bun.version,
    os: process.platform,
    arch: process.arch,
    runner: process.env.ImageOS ?? "local",
  },
  dependencyLockHash: {},
  inputVariant: variant,
  inputSha256: sha256(await Bun.file(inputSpecPath).bytes()),
  fixtureSha256: sha256(
    await Bun.file(path.join(root, "poc/kiota/fixtures/contract.json")).bytes(),
  ),
  generatedSourceFiles: 0,
  generation: stage("not_run"),
  buildOrLoad: stage("not_run"),
  wireContract: stage("not_run"),
  kotlinInterop: stage(name === "Kotlin" ? "not_run" : "not_applicable"),
  packageConsumer: stage("not_run"),
  reproducibility: stage("not_run"),
  warningSummary: [] as { code: string; message: string; category: string }[],
  blockers: [] as string[],
  evidencePaths: [] as string[],
};
const resultFile = path.join(reports, "result.json");
const version = await command(
  [cli, "--version"],
  path.join(logs, "version.txt"),
);
const help = await command(
  [cli, "generate", "--help"],
  path.join(logs, "help.txt"),
);
const info = await command([cli, "info"], path.join(logs, "info.txt"));
result.evidencePaths.push(version.log, help.log, info.log);
result.kiotaVersion = version.output.trim();
try {
  if (version.exitCode || help.exitCode || info.exitCode)
    throw new Error("Kiota discovery failed; inspect CLI logs");
  if (result.kiotaVersion !== config.kiotaBuild)
    throw new Error(
      `Expected ${config.kiotaBuild}, got ${result.kiotaVersion}`,
    );
  if (result.specSha256 !== config.specSha256)
    throw new Error(
      "Vendored spec hash changed: review fixtures and targets.json before running",
    );
  const supported =
    /<([^>]+)>\s*\(REQUIRED\)/.exec(help.output)?.[1]?.split("|") ?? [];
  await json(path.join(reports, "discovery.json"), {
    supported,
    requested: target.language,
  });
  if (!supported.includes(target.language)) {
    result.generation = stage(
      "unsupported",
      "Pinned CLI does not register this target",
    );
    for (const key of [
      "buildOrLoad",
      "wireContract",
      "packageConsumer",
      "reproducibility",
    ] as const)
      result[key] = stage("not_applicable");
  } else {
    const runtimeInfo = await command(
      [cli, "info", "--language", target.language],
      path.join(logs, "runtime-info.txt"),
    );
    result.evidencePaths.push(runtimeInfo.log);
    const args = [
      "generate",
      "--openapi",
      inputSpecPath,
      "--language",
      target.language,
      "--class-name",
      config.className,
      "--namespace-name",
      target.namespace,
      "--clean-output",
      "--log-level",
      "Information",
    ];
    const generation = await command(
      [cli, ...args, "--output", generated],
      path.join(logs, "generate.txt"),
    );
    result.evidencePaths.push(generation.log);
    for (const warning of generation.output.matchAll(
      /warn: [^\n]*\[(\d+)\]\r?\n\s+([^\n]+)/g,
    )) {
      const message = (warning[2] ?? "").trim();
      result.warningSummary.push({
        code: warning[1] ?? "",
        message,
        category: message.includes("Could not create error type")
          ? "missing-error-mapping"
          : message.includes("Multiple servers")
            ? "base-url-selection"
            : "review-required",
      });
    }
    if (generation.exitCode !== 0)
      throw new Error(`Generation exited ${generation.exitCode}`);
    const manifest = await codeManifest(generated, target.extension);
    result.generatedSourceFiles = Object.keys(manifest).length;
    if (!result.generatedSourceFiles)
      throw new Error("Generator exited 0 but produced no source files");
    await json(path.join(reports, "source-manifest.json"), manifest);
    const publicDeclarations = [];
    for (const file of Object.keys(manifest)) {
      const text = await Bun.file(path.join(generated, file)).text();
      const declarations = text
        .split("\n")
        .filter((line) =>
          /^(export |type |func |class )|^\s*(public |protected |attr_accessor |def |async def )/.test(
            line,
          ),
        );
      publicDeclarations.push(`## ${file}\n${declarations.join("\n")}`);
    }
    await Bun.write(
      path.join(reports, "public-api.txt"),
      publicDeclarations.join("\n\n"),
    );
    result.generation = stage("passed");
    const repeat = path.join(out, "regenerated");
    const regenerated = await command(
      [cli, ...args, "--output", repeat],
      path.join(logs, "regenerate.txt"),
    );
    result.evidencePaths.push(regenerated.log);
    const other =
      regenerated.exitCode === 0
        ? await codeManifest(repeat, target.extension)
        : {};
    const differences = [
      ...new Set([...Object.keys(manifest), ...Object.keys(other)]),
    ].filter((key) => manifest[key] !== other[key]);
    await json(path.join(reports, "regeneration-diff.json"), {
      differences,
      excludedNonCode: ["kiota-lock.json"],
      normalization: "none",
    });
    result.reproducibility = stage(
      regenerated.exitCode === 0 && differences.length === 0
        ? "passed"
        : "failed",
      `${differences.length} source differences`,
    );
    if (result.reproducibility.status === "failed")
      result.blockers.push("Non-deterministic or failed regeneration");
    await json(
      path.join(reports, "operations.json"),
      Object.entries(specObject.paths).flatMap(([url, methods]) =>
        Object.entries(methods as Record<string, { operationId?: string }>)
          .filter(([method]) =>
            ["get", "post", "put", "patch", "delete"].includes(method),
          )
          .map(([method, operation]) => ({
            path: url,
            method,
            operationId: operation.operationId,
          })),
      ),
    );
  }
} catch (error) {
  if (result.generation.status === "not_run")
    result.generation = stage("failed", String(error));
  result.blockers.push(String(error));
} finally {
  result.evidencePaths = result.evidencePaths.map((value) =>
    path.relative(root, value),
  );
  await json(resultFile, result);
}
console.log(
  `${name}/${variant}: generation=${result.generation.status}, reproducibility=${result.reproducibility.status}, sourceFiles=${result.generatedSourceFiles}`,
);
process.exitCode =
  result.generation.status === "failed" ||
  result.reproducibility.status === "failed"
    ? 1
    : 0;
