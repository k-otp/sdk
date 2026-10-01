#!/usr/bin/env bun
/**
 * Reports (and enforces budgets for) the cost of every `@k-otp/sdk` subpath,
 * measured from the built `dist/` (minified, min+gzip):
 *
 * - `@k-otp/sdk` (= `/core`), `/headless`: every public runtime export
 *   (`export *`, so new exports are measured automatically), dependencies
 *   included. This is the worst case; apps that import less ship less.
 * - IIFE: the CDN bundle `dist/k-otp.iife.min.js`.
 * - `/react`, `/vue`, `/svelte`: once alone (the subpath's own entry chunk;
 *   shared SDK chunks and the framework external) and once with everything it
 *   loads (total OTP cost for an app; the framework is always external).
 * - `/server`: everything it loads, bundled for Node (it is not a browser
 *   subpath; see the "browser" export condition).
 *
 * Tree-shaking: while bundling a subpath, every import is recorded. A subpath
 * must never load another framework, another adapter entry, or the server
 * client (e.g. `@k-otp/sdk/react` must not pull Vue, Svelte or `server.js`).
 *
 * Run `bun run build` first.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { BunPlugin } from "bun";

const root = path.resolve(import.meta.dir, "..");
const dist = path.join(root, "packages/sdk/dist");

/** Budgets in bytes (min+gzip). Raise deliberately, with a reason. */
const BUDGETS = {
  core: 13 * 1024,
  headless: 4 * 1024,
  // Includes the headless flow (KOtp.createOtpFlow).
  iife: 14 * 1024,
  // A framework subpath's own code (shared SDK chunks external).
  adapter: 2 * 1024,
  // What an app ships for OTP with an adapter (SDK chunks included,
  // framework external). Every re-exported core API is measured.
  adapterWithCore: 15 * 1024,
  // Server client with every public /v1 operation (Node target).
  server: 14 * 1024,
} as const;

const FRAMEWORKS = ["react", "vue", "svelte"] as const;
type Framework = (typeof FRAMEWORKS)[number];

/** Bare framework imports each adapter may (and must) leave external. */
const FRAMEWORK_IMPORTS: Record<Framework, string[]> = {
  react: ["react"],
  vue: ["vue"],
  svelte: ["svelte", "svelte/store"],
};

/** Entry files a subpath must never load. */
const OTHER_ENTRIES = ["react", "vue", "svelte", "server", "server.browser"];

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

/** Records every import specifier the bundler resolves (resolution unchanged). */
const recorder = (seen: Set<string>): BunPlugin => ({
  name: "record-imports",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      seen.add(
        args.path.startsWith(".")
          ? path.resolve(path.dirname(args.importer), args.path)
          : args.path,
      );
      return undefined;
    });
  },
});

/** Marks every import of the entry as external (measures the entry alone). */
const onlyEntry: BunPlugin = {
  name: "only-entry",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) =>
      args.importer ? { path: args.path, external: true } : undefined,
    );
  },
};

/**
 * Bundles `entry` and returns the bytes of ALL outputs (chunks/assets too),
 * plus every import seen on the way.
 */
const bundle = async (
  label: string,
  entry: string,
  options: {
    external?: string[];
    target?: "browser" | "node";
    plugins?: BunPlugin[];
  } = {},
): Promise<{ bytes: Buffer; seen: Set<string> }> => {
  const seen = new Set<string>();
  const result = await Bun.build({
    entrypoints: [entry],
    target: options.target ?? "browser",
    format: "esm",
    minify: true,
    external: options.external ?? [],
    plugins: [...(options.plugins ?? []), recorder(seen)],
  });
  if (!result.success) {
    const logs = result.logs.map((log) => `  ${String(log)}`).join("\n");
    throw new Error(`Bun.build failed for ${label} (${entry}):\n${logs}`);
  }
  if (result.outputs.length === 0) {
    throw new Error(`Bun.build produced no output for ${label}`);
  }
  const bytes = Buffer.concat(
    await Promise.all(
      result.outputs.map(async (output) =>
        Buffer.from(await output.arrayBuffer()),
      ),
    ),
  );
  return { bytes, seen };
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

/** Fails when a subpath loaded another framework, adapter or the server. */
const isolationErrors = (
  subpath: string,
  seen: Set<string>,
  allowed: string[],
): string[] => {
  const errors: string[] = [];
  const own = subpath.split("/")[2] ?? "core";
  for (const specifier of seen) {
    const bare = !path.isAbsolute(specifier);
    if (bare) {
      const isFramework = FRAMEWORKS.some(
        (f) => specifier === f || specifier.startsWith(`${f}/`),
      );
      if (isFramework && !allowed.includes(specifier)) {
        errors.push(`${subpath} imports "${specifier}"`);
      }
      continue;
    }
    if (path.dirname(specifier) !== dist) continue;
    const base = path.basename(specifier).replace(/\.js$/, "");
    if (base !== own && OTHER_ENTRIES.includes(base)) {
      errors.push(`${subpath} loads dist/${base}.js`);
    }
  }
  return errors;
};

const work = await mkdtemp(path.join(tmpdir(), "k-otp-size-"));
let failed = false;
const isolation: string[] = [];
try {
  const core = await bundle(
    "@k-otp/sdk",
    await reexportAll(work, "core", path.join(dist, "core.js")),
  );
  isolation.push(...isolationErrors("@k-otp/sdk", core.seen, []));
  const headless = await bundle(
    "@k-otp/sdk/headless",
    await reexportAll(work, "headless", path.join(dist, "headless.js")),
  );
  isolation.push(...isolationErrors("@k-otp/sdk/headless", headless.seen, []));
  const iife = Buffer.from(
    await Bun.file(
      await built(path.join(dist, "k-otp.iife.min.js")),
    ).arrayBuffer(),
  );

  const rows: [string, Buffer, number][] = [
    ["@k-otp/sdk (= /core, all exports)", core.bytes, BUDGETS.core],
    ["@k-otp/sdk/headless (all exports)", headless.bytes, BUDGETS.headless],
    ["@k-otp/sdk/k-otp.iife.min.js (CDN)", iife, BUDGETS.iife],
  ];

  for (const framework of FRAMEWORKS) {
    const subpath = `@k-otp/sdk/${framework}`;
    const file = await built(path.join(dist, `${framework}.js`));
    const external = FRAMEWORK_IMPORTS[framework];
    const entry = await reexportAll(work, framework, file);
    const alone = await bundle(`${subpath} (alone)`, file, {
      plugins: [onlyEntry],
    });
    const withCore = await bundle(`${subpath} (+ core)`, entry, { external });
    isolation.push(...isolationErrors(subpath, withCore.seen, external));
    rows.push(
      [`${subpath} (subpath only)`, alone.bytes, BUDGETS.adapter],
      [
        `${subpath} (+ core, ${framework} external)`,
        withCore.bytes,
        BUDGETS.adapterWithCore,
      ],
    );
  }

  const server = await bundle(
    "@k-otp/sdk/server",
    await reexportAll(work, "server", path.join(dist, "server.js")),
    { target: "node" },
  );
  isolation.push(...isolationErrors("@k-otp/sdk/server", server.seen, []));
  rows.push([
    "@k-otp/sdk/server (all exports, node)",
    server.bytes,
    BUDGETS.server,
  ]);

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
if (isolation.length) {
  failed = true;
  console.log(`\nTree-shaking check failed:\n- ${isolation.join("\n- ")}`);
} else {
  console.log(
    "\nTree-shaking: no subpath loads another framework, adapter or the server client.",
  );
}
// exitCode (not exit()) lets piped stdout flush first.
process.exitCode = failed ? 1 : 0;
