import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { compatibilityOverlay } from "../overlays/compat";
import { command, config, files, json, outputRoot, root } from "./common";

const target = process.argv[2];
const variant = process.argv[3] ?? "raw";
const out = path.join(outputRoot, `${target}-${variant}`, "repros");
await mkdir(out, { recursive: true });
let passed = false;
if (target === "Java") {
  const source = path.join(root, "poc/kiota/fixtures/error-oneof-minimal.json");
  const overlay = path.join(out, "minimal-overlay.json");
  await json(overlay, compatibilityOverlay(await Bun.file(source).json()).spec);
  const evidence = [];
  for (const [name, input] of [
    ["raw", source],
    ["overlay", overlay],
  ] as const) {
    const generated = path.join(out, name, "generated");
    const run = await command(
      [
        process.env.KIOTA_BIN ?? "kiota",
        "generate",
        "-d",
        input,
        "-l",
        "Java",
        "-n",
        "dev.kotp.repro",
        "-o",
        generated,
        "--clean-output",
        "--log-level",
        "Information",
      ],
      path.join(out, `${name}.txt`),
    );
    const builder = (await files(generated)).find((file) =>
      file.endsWith("VerifyRequestBuilder.java"),
    );
    const text = builder ? await Bun.file(builder).text() : "";
    evidence.push({
      inputVariant: name,
      exitCode: run.exitCode,
      missingErrorTypeWarning: run.output.includes(
        "Could not create error type for 400",
      ),
      hasErrorMapping: text.includes('errorMapping.put("400"'),
    });
  }
  passed =
    evidence[0]?.exitCode === 0 &&
    evidence[0]?.missingErrorTypeWarning === true &&
    evidence[0]?.hasErrorMapping === false &&
    evidence[1]?.exitCode === 0 &&
    evidence[1]?.hasErrorMapping === true;
  await json(path.join(out, "result.json"), {
    target,
    kiotaVersion: config.kiotaBuild,
    passed,
    evidence,
    runtimeImpact:
      "The full raw SDK wire test loses error envelope fields; the overlay full wire test preserves them",
  });
} else if (target === "Go") {
  const evidence = [];
  const go = process.env.GO_BIN ?? "go";
  for (const version of ["1.9.3", "1.11.1"]) {
    const workspace = path.join(out, version);
    await cp(
      path.join(root, "poc/kiota/harness/repros/go-query-nil"),
      workspace,
      { recursive: true },
    );
    const mod = path.join(workspace, "go.mod");
    await Bun.write(
      mod,
      (await Bun.file(mod).text()).replace("v1.9.3", `v${version}`),
    );
    const deps = await command(
      [go, "mod", "tidy"],
      path.join(out, `${version}-install.txt`),
      workspace,
    );
    const run = await command(
      [go, "run", "."],
      path.join(out, `${version}-runtime.txt`),
      workspace,
    );
    evidence.push({
      runtimeVersion: version,
      dependencyExit: deps.exitCode,
      exitCode: run.exitCode,
      panic: run.output.includes("optional query panic"),
    });
  }
  passed =
    evidence[0]?.dependencyExit === 0 &&
    evidence[0]?.exitCode !== 0 &&
    evidence[0]?.panic === true &&
    evidence[1]?.dependencyExit === 0 &&
    evidence[1]?.exitCode === 0;
  await json(path.join(out, "result.json"), { target, passed, evidence });
} else throw new Error("Repro target must be Java or Go");
console.log(`${target} minimal reproducer: ${passed ? "confirmed" : "FAILED"}`);
process.exitCode = passed ? 0 : 1;
