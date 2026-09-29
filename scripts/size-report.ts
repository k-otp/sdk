#!/usr/bin/env bun
/**
 * Reports (and enforces budgets for) the browser cost of `@k-otp/sdk-core`
 * and the framework adapters:
 *
 * - ESM: every public runtime export of `@k-otp/sdk-core` (`export *` from
 *   the built `dist/`, so new exports are measured automatically), minified,
 *   dependencies included. This is the worst case; apps that import less
 *   ship less.
 * - Headless: every export of `@k-otp/sdk-core/headless`.
 * - IIFE: the CDN bundle `dist/k-otp.iife.min.js`.
 * - Adapters: every public export of `@k-otp/sdk-react|vue|svelte`, once with
 *   sdk-core external (adapter cost alone) and once with sdk-core bundled
 *   (total OTP cost for an app). The framework itself is always external.
 *
 * Run `bun run build` first.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dir, "..");
const coreDir = path.join(root, "packages/sdk-core");

/** Budgets in bytes (min+gzip). Raise deliberately, with a reason. */
const BUDGETS = {
  esm: 13 * 1024,
  headless: 4 * 1024,
  // Includes the headless flow (KOtp.createOtpFlow) since 0.1.0.
  iife: 14 * 1024,
  // Adapter code only (sdk-core and the framework are external).
  adapter: 2 * 1024,
  // What an app ships for OTP with an adapter (sdk-core included, framework
  // external). 15 kB: every re-exported sdk-core API is measured (`export *`).
  adapterWithCore: 15 * 1024,
} as const;

/** The adapters; every public runtime export is measured (`export *`). */
const ADAPTERS = [
  {
    name: "@k-otp/sdk-react",
    dir: "packages/sdk-react",
    framework: ["react"],
  },
  {
    name: "@k-otp/sdk-vue",
    dir: "packages/sdk-vue",
    framework: ["vue"],
  },
  {
    name: "@k-otp/sdk-svelte",
    dir: "packages/sdk-svelte",
    framework: ["svelte", "svelte/store"],
  },
] as const;

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

/**
 * Bundles `entry` and returns the bytes of ALL outputs (chunks/assets too).
 * Bare imports (`@orpc/*`, `@k-otp/sdk-core`) resolve from the imported
 * `dist/` file's package, like they would in an app.
 */
const bundle = async (
  label: string,
  entry: string,
  external: string[] = [],
): Promise<Buffer> => {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: true,
    external,
  });
  if (!result.success) {
    const logs = result.logs.map((log) => `  ${String(log)}`).join("\n");
    throw new Error(`Bun.build failed for ${label} (${entry}):\n${logs}`);
  }
  if (result.outputs.length === 0) {
    throw new Error(`Bun.build produced no output for ${label}`);
  }
  return Buffer.concat(
    await Promise.all(
      result.outputs.map(async (output) =>
        Buffer.from(await output.arrayBuffer()),
      ),
    ),
  );
};

/** A built file, with a hint instead of a raw ENOENT when it is missing. */
const built = async (file: string): Promise<string> => {
  if (!(await Bun.file(file).exists())) {
    throw new Error(
      `${path.relative(root, file)} is missing. Run \`bun run build\` first.`,
    );
  }
  return file;
};

/** Writes an entry that re-exports everything from `file`. */
const reexportAll = async (
  work: string,
  name: string,
  file: string,
): Promise<string> => {
  const source = await Bun.file(await built(file)).text();
  // `export *` skips the default export, which would then go unmeasured.
  if (/\bexport\s+default\b|\bas\s+default\b/.test(source)) {
    throw new Error(
      `${path.relative(root, file)} has a default export, which \`export *\` does not measure`,
    );
  }
  const entry = path.join(work, `${name}.js`);
  await writeFile(entry, `export * from ${JSON.stringify(file)};\n`);
  return entry;
};

const work = await mkdtemp(path.join(tmpdir(), "k-otp-size-"));
let failed = false;
try {
  const esm = await bundle(
    "@k-otp/sdk-core ESM",
    await reexportAll(work, "core", path.join(coreDir, "dist/index.js")),
  );
  const headless = await bundle(
    "@k-otp/sdk-core/headless ESM",
    await reexportAll(work, "headless", path.join(coreDir, "dist/headless.js")),
  );
  const iife = Buffer.from(
    await Bun.file(
      await built(path.join(coreDir, "dist/k-otp.iife.min.js")),
    ).arrayBuffer(),
  );

  const rows: [string, Buffer, number][] = [
    ["@k-otp/sdk-core ESM (all exports)", esm, BUDGETS.esm],
    ["@k-otp/sdk-core/headless ESM (all exports)", headless, BUDGETS.headless],
    ["@k-otp/sdk-core IIFE (k-otp.iife.min.js)", iife, BUDGETS.iife],
  ];

  for (const adapter of ADAPTERS) {
    const dir = path.join(root, adapter.dir);
    const adapterEntry = await reexportAll(
      work,
      path.basename(dir),
      path.join(dir, "dist/index.js"),
    );
    const framework = [...adapter.framework];
    rows.push(
      [
        `${adapter.name} ESM (adapter only)`,
        await bundle(`${adapter.name} (adapter only)`, adapterEntry, [
          ...framework,
          "@k-otp/sdk-core",
          "@k-otp/sdk-core/headless",
          "@k-otp/sdk-core/internal",
        ]),
        BUDGETS.adapter,
      ],
      [
        `${adapter.name} ESM (+ sdk-core, ${adapter.framework[0]} external)`,
        await bundle(`${adapter.name} (+ sdk-core)`, adapterEntry, framework),
        BUDGETS.adapterWithCore,
      ],
    );
  }

  for (const [label, bytes, budget] of rows) {
    const gzip = gzipSync(bytes, { level: 9 }).byteLength;
    const over = gzip > budget;
    failed ||= over;
    console.log(
      `${label}: ${kb(bytes.byteLength)} min, ${kb(gzip)} min+gzip (budget ${kb(budget)})${over ? "  OVER BUDGET" : ""}`,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
// exitCode (not exit()) lets piped stdout flush first.
process.exitCode = failed ? 1 : 0;
