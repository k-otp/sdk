import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { compatibilityOverlay } from "../poc/kiota/overlays/compat";
import config from "../poc/kiota/targets.json";

const root = path.resolve(import.meta.dir, "..");
const work = path.join(root, ".cache/kiota/npm");
const dist = path.join(root, "packages/sdk/dist");
await mkdir(work, { recursive: true });
await mkdir(dist, { recursive: true });
const localCli = path.join(root, ".cache/kiota-tool/kiota");
const cli =
  process.env.KIOTA_BIN ??
  ((await Bun.file(localCli).exists()) ? localCli : "kiota");
async function run(args: string[], label: string) {
  const process = Bun.spawn(args, {
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...globalThis.process.env,
      KIOTA_CLI_TELEMETRY_OPTOUT: "true",
      KIOTA_OFFLINE_ENABLED: "true",
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  await Bun.write(path.join(work, `${label}.txt`), stdout + stderr);
  if (code) throw new Error(`${label} failed: ${stdout + stderr}`);
  return stdout.trim();
}
if ((await run([cli, "--version"], "version")) !== config.kiotaBuild)
  throw new Error("Kiota version differs from the pinned SDK generator");
const specText = await Bun.file(path.join(root, config.spec)).text();
if (
  new Bun.CryptoHasher("sha256").update(specText).digest("hex") !==
  config.specSha256
)
  throw new Error(
    "Review the SDK generation configuration after changing the vendored spec",
  );
const overlay = compatibilityOverlay(JSON.parse(specText), "TypeScript");
const input = path.join(work, "openapi.json");
await Bun.write(input, JSON.stringify(overlay.spec));
await run(
  [
    cli,
    "generate",
    "--openapi",
    input,
    "--language",
    "TypeScript",
    "--class-name",
    config.className,
    "--namespace-name",
    "KOtpSdkGenerated",
    "--clean-output",
    "--output",
    path.join(work, "generated"),
  ],
  "generate",
);
await cp(path.join(root, "sdks/typescript"), path.join(work, "preview"), {
  recursive: true,
});
// The generated implementation stays outside the source tree and is included
// only in this subpath's bundle. Other SDK subpaths never import it.
for (const format of ["esm", "cjs"] as const) {
  const build = await Bun.build({
    entrypoints: [path.join(work, "preview/index.ts")],
    target: "node",
    format,
    packages: "external",
    sourcemap: "external",
  });
  if (!build.success)
    throw new AggregateError(build.logs, "Kiota bundle failed");
  for (const output of build.outputs) {
    const name =
      output.kind === "sourcemap"
        ? `kiota.${format === "esm" ? "js" : "cjs"}.map`
        : `kiota.${format === "esm" ? "js" : "cjs"}`;
    let content = await output.text();
    if (output.kind !== "sourcemap")
      content = content.replace(
        /sourceMappingURL=[^\n]+/,
        `sourceMappingURL=${name}.map`,
      );
    await Bun.write(path.join(dist, name), content);
  }
}
const browser = await Bun.build({
  entrypoints: [path.join(root, "packages/sdk/src/kiota/browser.ts")],
  target: "browser",
  format: "esm",
});
if (!browser.success || !browser.outputs[0])
  throw new AggregateError(browser.logs, "Kiota browser guard failed");
await Bun.write(path.join(dist, "kiota.browser.js"), browser.outputs[0]);
for (const name of ["kiota.d.ts", "kiota.d.cts"])
  await cp(
    path.join(root, "packages/sdk/src/kiota/index.d.ts"),
    path.join(dist, name),
  );
console.log(
  "Built @k-otp/sdk/kiota with the pinned Kiota generator and official runtimes",
);
