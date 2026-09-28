#!/usr/bin/env bun
/**
 * Type-checks every project with ttsc (TypeScript 7 + @ttsc/lint type-aware
 * rules). Projects run in parallel; output is printed in a stable order.
 */
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

const projects = [
  "packages/sdk-core/tsconfig.json",
  "packages/sdk-core/tsconfig.test.json",
  "packages/sdk-server/tsconfig.json",
  "packages/sdk-server/tsconfig.test.json",
  "scripts/tsconfig.json",
];

const results = await Promise.all(
  projects.map(async (project) => {
    const child = Bun.spawn(["bun", "x", "ttsc", "--noEmit", "-p", project], {
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
  }),
);

let failed = false;
for (const { project, exitCode, output } of results) {
  console.log(`[typecheck] ${project}: ${exitCode === 0 ? "ok" : "FAILED"}`);
  if (output) console.log(output);
  failed ||= exitCode !== 0;
}
process.exit(failed ? 1 : 0);
