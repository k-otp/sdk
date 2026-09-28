#!/usr/bin/env bun
/**
 * Type-checks, builds and smoke-tests every example under `examples/` with
 * its own toolchain (each example pins TypeScript 5.x, vue-tsc or
 * svelte-check like a regular app would). Examples consume the BUILT
 * workspace packages, so run `bun run build` first.
 *
 * Examples run one after another on purpose: each step's output stays in
 * one readable block, and vite/tsc already use every core.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const examplesDir = path.join(root, "examples");
const STEPS = ["typecheck", "build", "smoke"] as const;
/** A hung step (e.g. a smoke server that never closes) fails instead of stalling CI. */
const STEP_TIMEOUT_MS = 5 * 60_000;

let failed = false;
for (const entry of await readdir(examplesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(examplesDir, entry.name);
  const manifest = Bun.file(path.join(dir, "package.json"));
  if (!(await manifest.exists())) continue;
  let scripts: Record<string, string>;
  try {
    scripts =
      ((await manifest.json()) as { scripts?: Record<string, string> })
        .scripts ?? {};
  } catch (error) {
    console.log(`[examples] ${entry.name}: invalid package.json (${error})`);
    failed = true;
    continue;
  }
  for (const step of STEPS) {
    if (!scripts[step]) continue;
    const child = Bun.spawn(["bun", "run", step], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: STEP_TIMEOUT_MS,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    let status = code === 0 ? "ok" : "FAILED";
    if (code !== 0 && child.signalCode !== null) {
      status += ` (killed by ${child.signalCode}; timeout ${STEP_TIMEOUT_MS / 1000}s)`;
    }
    console.log(`[examples] ${entry.name} ${step}: ${status}`);
    // Also show warnings of successful steps (vite, tsc, svelte-check).
    const output = `${stdout}${stderr}`.trim();
    if (code !== 0) {
      failed = true;
      if (output) console.log(output);
      break;
    }
    if (/\bwarn(ing)?\b/i.test(output)) console.log(output);
  }
}
process.exitCode = failed ? 1 : 0;
