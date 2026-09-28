#!/usr/bin/env bun
/**
 * Reports (and enforces budgets for) the browser cost of `@k-otp/sdk-core`
 * and the framework adapters:
 *
 * - ESM: what an app bundler ships for `import { createOtpClient,
 *   createIdempotencyKey } from "@k-otp/sdk-core"` (tree-shaken, minified,
 *   dependencies included), measured from the built `dist/`.
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
  // Includes the headless flow (KOtp.createOtpFlow) since 0.1.0.
  iife: 14 * 1024,
  // Adapter code only (sdk-core and the framework are external).
  adapter: 2 * 1024,
  // What an app ships for OTP with an adapter (sdk-core included, framework external).
  adapterWithCore: 14 * 1024,
} as const;

/** Every public runtime export of each adapter. */
const ADAPTERS = [
  {
    name: "@k-otp/sdk-react",
    dir: "packages/sdk-react",
    framework: ["react"],
    exports: [
      "OtpProvider",
      "useOtpClient",
      "useOtpIssue",
      "useOtpVerify",
      "useOtpFlow",
    ],
  },
  {
    name: "@k-otp/sdk-vue",
    dir: "packages/sdk-vue",
    framework: ["vue"],
    exports: [
      "createOtpPlugin",
      "provideOtpClient",
      "useOtpClient",
      "useOtp",
      "useOtpFlow",
    ],
  },
  {
    name: "@k-otp/sdk-svelte",
    dir: "packages/sdk-svelte",
    framework: ["svelte", "svelte/store"],
    exports: [
      "createOtpStores",
      "createOtpFlowStore",
      "setOtpContext",
      "getOtpContext",
      "otpForm",
    ],
  },
] as const;

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

const bundle = async (
  entry: string,
  root: string,
  external: string[] = [],
): Promise<Buffer> => {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: true,
    root,
    external,
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }
  const output = result.outputs[0];
  if (!output) throw new Error("Bun.build produced no output");
  return Buffer.from(await output.arrayBuffer());
};

const work = await mkdtemp(path.join(tmpdir(), "k-otp-size-"));
let failed = false;
try {
  const entry = path.join(work, "entry.js");
  await writeFile(
    entry,
    `export { createOtpClient, createIdempotencyKey, isOtpApiError } from ${JSON.stringify(
      path.join(coreDir, "dist/index.js"),
    )};\n`,
  );
  // Resolve @orpc/* from the sdk-core package like an app would.
  const esm = await bundle(entry, coreDir);
  const iife = Buffer.from(
    await Bun.file(path.join(coreDir, "dist/k-otp.iife.min.js")).arrayBuffer(),
  );

  const rows: [string, Buffer, number][] = [
    ["@k-otp/sdk-core ESM (tree-shaken)", esm, BUDGETS.esm],
    ["@k-otp/sdk-core IIFE (k-otp.iife.min.js)", iife, BUDGETS.iife],
  ];

  for (const adapter of ADAPTERS) {
    const dir = path.join(root, adapter.dir);
    const adapterEntry = path.join(work, `${path.basename(dir)}.js`);
    await writeFile(
      adapterEntry,
      `export { ${adapter.exports.join(", ")} } from ${JSON.stringify(
        path.join(dir, "dist/index.js"),
      )};\n`,
    );
    const framework = [...adapter.framework];
    rows.push(
      [
        `${adapter.name} ESM (adapter only)`,
        await bundle(adapterEntry, dir, [
          ...framework,
          "@k-otp/sdk-core",
          "@k-otp/sdk-core/headless",
        ]),
        BUDGETS.adapter,
      ],
      [
        `${adapter.name} ESM (+ sdk-core, ${adapter.framework[0]} external)`,
        await bundle(adapterEntry, dir, framework),
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
process.exit(failed ? 1 : 0);
