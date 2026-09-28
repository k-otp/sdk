#!/usr/bin/env bun
/**
 * Type-checks, builds and smoke-tests every example under `examples/` with
 * its own toolchain (each example pins TypeScript 5.x, vue-tsc or
 * svelte-check like a regular app would). Examples consume the BUILT
 * workspace packages, so run `bun run build` first.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const examplesDir = path.join(root, "examples");
const STEPS = ["typecheck", "build", "smoke"] as const;

let failed = false;
for (const entry of await readdir(examplesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(examplesDir, entry.name);
  const manifest = Bun.file(path.join(dir, "package.json"));
  if (!(await manifest.exists())) continue;
  const scripts =
    ((await manifest.json()) as { scripts?: Record<string, string> }).scripts ??
    {};
  for (const step of STEPS) {
    if (!scripts[step]) continue;
    const child = Bun.spawn(["bun", "run", step], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    console.log(
      `[examples] ${entry.name} ${step}: ${code === 0 ? "ok" : "FAILED"}`,
    );
    if (code !== 0) {
      failed = true;
      console.log(`${stdout}${stderr}`.trim());
      break;
    }
  }
}
process.exit(failed ? 1 : 0);
