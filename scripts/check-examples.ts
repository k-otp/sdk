#!/usr/bin/env bun
/**
 * Type-checks, builds and smoke-tests every example under `examples/` with
 * its own toolchain (each example pins TypeScript 5.x, vue-tsc or
 * svelte-check like a regular app would). Examples consume the BUILT
 * workspace packages, so run `bun run build` first.
 *
 * Examples run one after another on purpose: each step's output stays in
 * one readable block, and vite/tsc already use every core.
 *
 * Bundle check: the framework examples are built once more with source maps,
 * and the modules that ended up in the browser bundle must come from their
 * own `@k-otp/sdk/<framework>` and `@k-otp/sdk/ui/<framework>` subpaths
 * only: e.g. the React app must not contain Vue, Svelte, `dist/vue.js`,
 * `dist/ui-vue.js` or the server client, and must contain the UI
 * components it renders.
 */
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const examplesDir = path.join(root, "examples");
const STEPS = ["typecheck", "build", "smoke"] as const;
/** A hung step (e.g. a smoke server that never closes) fails instead of stalling CI. */
const STEP_TIMEOUT_MS = 5 * 60_000;
/** After the step exits, leftover grandchildren may keep the pipes open. */
const PIPE_DRAIN_MS = 5_000;

/** Framework examples and the subpath each one must be built from. */
const BUNDLE_CHECKS: Record<string, "react" | "vue" | "svelte"> = {
  "react-vite": "react",
  "vue-vite": "vue",
  "svelte-vite": "svelte",
};
/** npm packages that belong to each framework. */
const FRAMEWORK_PACKAGES: Record<string, RegExp> = {
  react: /(^|\/)node_modules\/(react|react-dom|scheduler)\//,
  vue: /(^|\/)node_modules\/(vue|@vue\/[^/]+)\//,
  svelte: /(^|\/)node_modules\/svelte\//,
};
const SDK_DIST = path.join(root, "packages/sdk/dist");
/** Subpaths (owners of built files, see `owner`) of the SDK. */
const SDK_ENTRIES = [
  "core",
  "headless",
  "contract",
  "server",
  "react",
  "vue",
  "svelte",
  "ui",
  "ui-react",
  "ui-vue",
  "ui-svelte",
];
/** Subpaths a framework example may (and must) bundle. */
const ALLOWED: Record<string, string[]> = {
  react: ["core", "headless", "ui", "react", "ui-react"],
  vue: ["core", "headless", "ui", "vue", "ui-vue"],
  svelte: ["core", "headless", "ui", "svelte", "ui-svelte"],
};

/**
 * The subpath a built file belongs to: `dist/react.js` and its shared chunk
 * `dist/react-<hash>.js` -> `react`; `dist/ui-svelte/*` -> `ui-svelte`.
 */
const owner = (file: string): string => {
  const [top, ...rest] = path.relative(SDK_DIST, file).split(path.sep);
  if (rest.length) return top ?? "";
  return (top ?? "").replace(/\.(c?js|svelte)$/, "").replace(/-[\w-]{8}$/, "");
};

/**
 * Builds `dir` with source maps into a temp dir and returns every source
 * module (absolute paths) that contributed code to the bundle.
 */
const bundledSources = async (dir: string): Promise<string[]> => {
  // Real path: source map paths are relative to it (macOS /var -> /private/var).
  const out = await realpath(
    await mkdtemp(path.join(tmpdir(), "k-otp-bundle-")),
  );
  try {
    const vite = path.join(dir, "node_modules", ".bin", "vite");
    const child = Bun.spawn(
      [
        vite,
        "build",
        "--sourcemap",
        "--outDir",
        out,
        "--emptyOutDir",
        "--logLevel",
        "error",
      ],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`vite build failed:\n${stdout}${stderr}`);
    const sources: string[] = [];
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".js.map")) {
          const map = JSON.parse(await readFile(full, "utf8")) as {
            sources?: string[];
            sourceRoot?: string;
          };
          for (const source of map.sources ?? []) {
            sources.push(
              path.resolve(path.dirname(full), map.sourceRoot ?? "", source),
            );
          }
        }
      }
    };
    await walk(out);
    return sources;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
};

/** Problems with what the framework example's bundle contains. */
const bundleProblems = async (
  dir: string,
  framework: "react" | "vue" | "svelte",
): Promise<string[]> => {
  const sources = await bundledSources(dir);
  const problems: string[] = [];
  const sdkFiles = sources.filter(
    (source) => !path.relative(SDK_DIST, source).startsWith(".."),
  );
  const owners = new Set(sdkFiles.map(owner));
  for (const required of [framework, `ui-${framework}`]) {
    if (!owners.has(required)) {
      problems.push(
        `bundle does not contain @k-otp/sdk/${required.replace("-", "/")}`,
      );
    }
  }
  for (const file of sdkFiles) {
    const by = owner(file);
    if (
      (SDK_ENTRIES.includes(by) && !ALLOWED[framework]?.includes(by)) ||
      by.startsWith("server")
    ) {
      problems.push(`bundle contains dist/${path.relative(SDK_DIST, file)}`);
    }
  }
  for (const [other, pattern] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (other === framework) continue;
    const leaked = sources.find((source) => pattern.test(source));
    if (leaked)
      problems.push(`bundle contains ${other}: ${path.relative(root, leaked)}`);
  }
  return problems;
};

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
    const framework = BUNDLE_CHECKS[entry.name];
    if (step === "build" && framework) {
      let problems: string[];
      try {
        problems = await bundleProblems(dir, framework);
      } catch (error) {
        problems = [error instanceof Error ? error.message : String(error)];
      }
      console.log(
        `[examples] ${entry.name} bundle (only @k-otp/sdk/${framework}): ${problems.length ? "FAILED" : "ok"}`,
      );
      if (problems.length) {
        failed = true;
        console.log(problems.map((problem) => `  - ${problem}`).join("\n"));
        break;
      }
    }
  }
}
process.exitCode = failed ? 1 : 0;
