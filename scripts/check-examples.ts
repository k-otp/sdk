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
/** After the step exits, leftover grandchildren may keep the pipes open. */
const PIPE_DRAIN_MS = 5_000;

/**
 * A line reporting a warning ("warn", "warning", "3 warnings"), ignoring the
 * `$ command` echo of `bun run` (e.g. `--fail-on-warnings`) and zero counts
 * such as svelte-check's "0 WARNINGS".
 */
const isWarningLine = (line: string): boolean =>
  !line.startsWith("$ ") &&
  /\bwarn(ings?)?\b/i.test(line.replace(/\b0 warnings?\b/gi, ""));

/** Kills the step's whole process group (it runs detached, as group leader). */
const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // ESRCH: the group is already gone.
  }
};

/** Reads a pipe, giving up `PIPE_DRAIN_MS` after `exited` settles. */
const drain = async (
  text: Promise<string>,
  exited: Promise<unknown>,
): Promise<string> => {
  await exited;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve("[output cut: the pipe stayed open after the step exited]"),
      PIPE_DRAIN_MS,
    );
  });
  try {
    return await Promise.race([text, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

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
    const started = performance.now();
    const child = Bun.spawn(["bun", "run", step], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      // Own process group, so a timeout also kills grandchildren (vite, node).
      detached: true,
    });
    const timer = setTimeout(() => killGroup(child.pid), STEP_TIMEOUT_MS);
    // Start reading right away (a full pipe would block the child).
    const stdoutText = new Response(child.stdout).text();
    const stderrText = new Response(child.stderr).text();
    const code = await child.exited;
    clearTimeout(timer);
    const elapsed = performance.now() - started;
    // Leftovers (e.g. a server a smoke step never closed) must not linger.
    killGroup(child.pid);
    const [stdout, stderr] = await Promise.all([
      drain(stdoutText, child.exited),
      drain(stderrText, child.exited),
    ]);
    let status = code === 0 ? "ok" : "FAILED";
    if (code !== 0 && child.signalCode !== null) {
      status += ` (killed by ${child.signalCode}`;
      if (elapsed >= STEP_TIMEOUT_MS) {
        status += `; timeout ${STEP_TIMEOUT_MS / 1000}s`;
      }
      status += ")";
    }
    console.log(`[examples] ${entry.name} ${step}: ${status}`);
    // Also show warnings of successful steps (vite, tsc, svelte-check).
    const output = `${stdout}${stderr}`.trim();
    if (code !== 0) {
      failed = true;
      if (output) console.log(output);
      break;
    }
    if (output.split("\n").some(isWarningLine)) console.log(output);
  }
}
process.exitCode = failed ? 1 : 0;
