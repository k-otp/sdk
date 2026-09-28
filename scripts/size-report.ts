#!/usr/bin/env bun
/**
 * Reports (and enforces budgets for) the browser cost of `@k-otp/sdk-core`:
 *
 * - ESM: what an app bundler ships for `import { createOtpClient,
 *   createIdempotencyKey } from "@k-otp/sdk-core"` (tree-shaken, minified,
 *   dependencies included), measured from the built `dist/`.
 * - IIFE: the CDN bundle `dist/k-otp.iife.min.js`.
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
const BUDGETS = { esm: 13 * 1024, iife: 13 * 1024 } as const;

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

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
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: true,
    // Resolve @orpc/* from the sdk-core package like an app would.
    root: coreDir,
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }
  const output = result.outputs[0];
  if (!output) throw new Error("Bun.build produced no output");
  const esm = Buffer.from(await output.arrayBuffer());
  const iife = Buffer.from(
    await Bun.file(path.join(coreDir, "dist/k-otp.iife.min.js")).arrayBuffer(),
  );

  const rows = [
    ["@k-otp/sdk-core ESM (tree-shaken)", esm, BUDGETS.esm],
    ["@k-otp/sdk-core IIFE (k-otp.iife.min.js)", iife, BUDGETS.iife],
  ] as const;
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
