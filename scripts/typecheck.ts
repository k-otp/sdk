#!/usr/bin/env bun
/**
 * Type-checks every project with ttsc (TypeScript 7 + @ttsc/lint type-aware
 * rules). Projects are discovered (`packages/*\/tsconfig*.json`, `tests/`,
 * `scripts/`), run in parallel, and reported in a stable order.
 */
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

// The locally installed binary: never let `bun x` fetch ttsc from the registry.
const ttsc = path.join(root, "node_modules", ".bin", "ttsc");
if (!(await Bun.file(ttsc).exists())) {
  console.error("[typecheck] ttsc is not installed. Run `bun install` first.");
  process.exit(1);
}

const projects = [
  ...(await Array.fromAsync(
    new Bun.Glob("packages/*/tsconfig*.json").scan({ cwd: root }),
  )),
  "tests/tsconfig.json",
  "scripts/tsconfig.json",
].sort();

const results = await Promise.all(
  projects.map(async (project) => {
    try {
      const child = Bun.spawn([ttsc, "--noEmit", "-p", project], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { project, exitCode, output: `${stderr}${stdout}`.trim() };
    } catch (error) {
      return { project, exitCode: 1, output: String(error) };
    }
  }),
);

let failed = false;
for (const { project, exitCode, output } of results) {
  console.log(`[typecheck] ${project}: ${exitCode === 0 ? "ok" : "FAILED"}`);
  if (output) console.log(output);
  failed ||= exitCode !== 0;
}
// exitCode (not exit()) lets piped stdout flush first.
process.exitCode = failed ? 1 : 0;
