#!/usr/bin/env bun
/**
 * Reports (and enforces budgets for) the cost of every `@k-otp/sdk` subpath,
 * measured from the built `dist/` (minified, min+gzip):
 *
 * - `@k-otp/sdk` (= `/core`), `/headless`, `/ui`: every public runtime
 *   export (`export *`, so new exports are measured automatically),
 *   dependencies included. This is the worst case; apps that import less
 *   ship less.
 * - IIFE: the CDN bundle `dist/k-otp.iife.min.js`.
 * - `/react`, `/vue`, `/svelte`, `/ui/react`, `/ui/vue`, `/ui/svelte`: once
 *   alone (the subpath's own code: the built files whose source maps point
 *   into its own `src/` directory; the rest of the SDK and the framework
 *   external) and once with everything it loads (total OTP cost for an app;
 *   the framework is always external). `/ui/svelte` is measured through its
 *   compiled runtime; its `.svelte` sources are compiled by the app and
 *   reported as source size.
 * - `/ui/theme.css`: the stylesheet.
 * - `/server`: everything it loads, bundled for Node (it is not a browser
 *   subpath; see the "browser" export condition).
 *
 * Tree-shaking: while bundling a subpath, every import is recorded. A subpath
 * must never load another framework, another framework's subpaths, or the
 * server client (e.g. `@k-otp/sdk/ui/react` must not pull Vue, Svelte or
 * `server.js`), and the non-UI subpaths (core, headless, server and the
 * `react`/`vue`/`svelte` hooks) must not load any UI code (`src/ui`).
 *
 * Run `bun run build` first.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { BunPlugin } from "bun";

const root = path.resolve(import.meta.dir, "..");
const dist = path.join(root, "packages/sdk/dist");
const src = path.join(root, "packages/sdk/src");

/** Budgets in bytes (min+gzip). Raise deliberately, with a reason. */
const BUDGETS = {
  core: 13 * 1024,
  headless: 4 * 1024,
  // Includes the headless flow (KOtp.createOtpFlow).
  iife: 14 * 1024,
  // A framework hooks subpath's own code.
  adapter: 2 * 1024,
  // What an app ships for OTP with an adapter (SDK chunks included,
  // framework external). Every re-exported core API is measured.
  adapterWithCore: 15 * 1024,
  // The UI model (phone, code input, form state machine, both KO/EN
  // catalogs, part attributes, WebOTP), headless flow included.
  ui: 11 * 1024,
  // A UI components subpath's own code.
  uiAdapter: 4 * 1024,
  // Everything an app ships for the UI components of one framework (core,
  // headless, hooks, UI model, components; framework external). Raised
  // from 23 kB for the single-tab-stop/IME handling, the local cooldown and
  // the request epoch of the form.
  uiAdapterWithAll: 24 * 1024,
  // The `.svelte` sources (uncompiled; the app compiles them).
  uiSvelteSources: 4 * 1024,
  theme: 4 * 1024,
  // Server client with every public /v1 operation (Node target).
  server: 14 * 1024,
} as const;

type Subpath = {
  /** Public name. */
  name: string;
  /** Built entry file (relative to dist). */
  file: string;
  /** Source directory of its own code (relative to src). */
  own: string;
  /** Bare framework imports it may (and must) leave external. */
  external: string[];
  /** Owners (see `owner`) it may load besides the shared SDK chunks. */
  allowed: string[];
  /** Must not load any module from src/ui. */
  noUi: boolean;
};

const ADAPTERS: Subpath[] = [
  {
    name: "@k-otp/sdk/react",
    file: "react.js",
    own: "react",
    external: ["react"],
    allowed: ["react"],
    noUi: true,
  },
  {
    name: "@k-otp/sdk/vue",
    file: "vue.js",
    own: "vue",
    external: ["vue"],
    allowed: ["vue"],
    noUi: true,
  },
  {
    name: "@k-otp/sdk/svelte",
    file: "svelte.js",
    own: "svelte",
    external: ["svelte", "svelte/store"],
    allowed: ["svelte"],
    noUi: true,
  },
];

const UI_ADAPTERS: Subpath[] = [
  {
    name: "@k-otp/sdk/ui/react",
    file: "ui-react.js",
    own: "ui/react",
    external: ["react"],
    allowed: ["react", "ui-react"],
    noUi: false,
  },
  {
    name: "@k-otp/sdk/ui/vue",
    file: "ui-vue.js",
    own: "ui/vue",
    external: ["vue"],
    allowed: ["vue", "ui-vue"],
    noUi: false,
  },
  {
    name: "@k-otp/sdk/ui/svelte (runtime)",
    file: "ui-svelte/runtime.js",
    own: "ui/svelte",
    external: ["svelte", "svelte/store"],
    allowed: ["svelte", "ui-svelte"],
    noUi: false,
  },
];

const FRAMEWORKS = ["react", "vue", "svelte"] as const;

/** Owners that belong to one framework, or to the server. */
const RESTRICTED_OWNERS = [
  "react",
  "ui-react",
  "vue",
  "ui-vue",
  "svelte",
  "ui-svelte",
  "server",
  "server.browser",
];

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

/**
 * The subpath a built file belongs to: `react.js` and its shared chunk
 * `react-<hash>.js` -> `react`; `ui-svelte/*` -> `ui-svelte`.
 */
const owner = (file: string): string => {
  const relative = path.relative(dist, file);
  const [top, ...rest] = relative.split(path.sep);
  if (rest.length) return top ?? "";
  const base = (top ?? "").replace(/\.js$/, "");
  return base === "server.browser" ? base : base.replace(/-[\w-]{8}$/, "");
};

/** Absolute source files a built file was generated from (its source map). */
const sourcesCache = new Map<string, string[]>();
const sourcesOf = async (file: string): Promise<string[]> => {
  const cached = sourcesCache.get(file);
  if (cached) return cached;
  let sources: string[] = [];
  try {
    const map = JSON.parse(await readFile(`${file}.map`, "utf8")) as {
      sources?: string[];
      sourceRoot?: string;
    };
    sources = (map.sources ?? []).map((source) =>
      path.resolve(path.dirname(file), map.sourceRoot ?? "", source),
    );
  } catch {
    // No source map (e.g. the IIFE): no attribution.
  }
  sourcesCache.set(file, sources);
  return sources;
};

const within = (file: string, dir: string): boolean =>
  file === dir || file.startsWith(`${dir}${path.sep}`);

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

/**
 * Keeps only the subpath's own code: bare imports and every built file whose
 * source map does not point into `ownDir` stay external.
 */
const onlyOwn = (ownDir: string): BunPlugin => ({
  name: "only-own",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (!args.importer) return undefined;
      if (!args.path.startsWith("."))
        return { path: args.path, external: true };
      const file = path.resolve(path.dirname(args.importer), args.path);
      const sources = await sourcesOf(file);
      return sources.some((source) => within(source, ownDir))
        ? undefined
        : { path: args.path, external: true };
    });
  },
});

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
  const entry = path.join(work, `${name.replace(/\W+/g, "-")}.js`);
  await writeFile(entry, `export * from ${JSON.stringify(file)};\n`);
  return entry;
};

/**
 * Fails when a subpath loaded another framework (or its subpaths), the
 * server, or (for `noUi` subpaths) any UI code.
 */
const isolationErrors = async (
  subpath: string,
  seen: Set<string>,
  options: { external: string[]; allowed: string[]; noUi: boolean },
): Promise<string[]> => {
  const errors: string[] = [];
  for (const specifier of seen) {
    if (!path.isAbsolute(specifier)) {
      const isFramework = FRAMEWORKS.some(
        (f) => specifier === f || specifier.startsWith(`${f}/`),
      );
      if (isFramework && !options.external.includes(specifier)) {
        errors.push(`${subpath} imports "${specifier}"`);
      }
      continue;
    }
    if (!within(specifier, dist)) continue;
    const by = owner(specifier);
    if (RESTRICTED_OWNERS.includes(by) && !options.allowed.includes(by)) {
      errors.push(
        `${subpath} loads dist/${path.relative(dist, specifier)} (${by})`,
      );
    }
    if (options.noUi) {
      const ui = (await sourcesOf(specifier)).find((source) =>
        within(source, path.join(src, "ui")),
      );
      if (ui) {
        errors.push(
          `${subpath} loads UI code: ${path.relative(root, ui)} (dist/${path.relative(dist, specifier)})`,
        );
      }
    }
  }
  return errors;
};

const work = await mkdtemp(path.join(tmpdir(), "k-otp-size-"));
let failed = false;
const isolation: string[] = [];
const rows: [string, Buffer, number][] = [];
try {
  const whole = async (
    name: string,
    file: string,
    budget: number,
    options: { noUi: boolean; target?: "browser" | "node" },
  ): Promise<void> => {
    const entry = path.join(dist, file);
    const result = await bundle(name, await reexportAll(work, name, entry), {
      target: options.target ?? "browser",
    });
    isolation.push(
      ...(await isolationErrors(name, result.seen, {
        external: [],
        allowed: [owner(entry)],
        noUi: options.noUi,
      })),
    );
    rows.push([`${name} (all exports)`, result.bytes, budget]);
  };

  await whole("@k-otp/sdk (= /core)", "core.js", BUDGETS.core, { noUi: true });
  await whole("@k-otp/sdk/headless", "headless.js", BUDGETS.headless, {
    noUi: true,
  });
  rows.push([
    "@k-otp/sdk/k-otp.iife.min.js (CDN)",
    Buffer.from(
      await Bun.file(
        await built(path.join(dist, "k-otp.iife.min.js")),
      ).arrayBuffer(),
    ),
    BUDGETS.iife,
  ]);

  const measure = async (
    subpath: Subpath,
    budgets: { alone: number; all: number },
    allLabel: string,
  ): Promise<void> => {
    const file = await built(path.join(dist, subpath.file));
    const alone = await bundle(`${subpath.name} (alone)`, file, {
      plugins: [onlyOwn(path.join(src, subpath.own))],
    });
    const all = await bundle(
      `${subpath.name} (all)`,
      await reexportAll(work, subpath.name, file),
      { external: subpath.external },
    );
    isolation.push(...(await isolationErrors(subpath.name, all.seen, subpath)));
    rows.push(
      [`${subpath.name} (subpath only)`, alone.bytes, budgets.alone],
      [`${subpath.name} (${allLabel})`, all.bytes, budgets.all],
    );
  };

  for (const adapter of ADAPTERS) {
    await measure(
      adapter,
      { alone: BUDGETS.adapter, all: BUDGETS.adapterWithCore },
      `+ core, ${adapter.external[0]} external`,
    );
  }

  await whole("@k-otp/sdk/ui", "ui.js", BUDGETS.ui, { noUi: false });
  for (const adapter of UI_ADAPTERS) {
    await measure(
      adapter,
      { alone: BUDGETS.uiAdapter, all: BUDGETS.uiAdapterWithAll },
      `+ SDK and UI model, ${adapter.external[0]} external`,
    );
  }
  const svelteDir = path.join(dist, "ui-svelte");
  const svelteSources = Buffer.concat(
    await Promise.all(
      (await readdir(svelteDir))
        .filter((name) => name.endsWith(".svelte"))
        .sort()
        .map(async (name) => readFile(path.join(svelteDir, name))),
    ),
  );
  rows.push([
    "@k-otp/sdk/ui/svelte (.svelte sources, uncompiled)",
    svelteSources,
    BUDGETS.uiSvelteSources,
  ]);
  rows.push([
    "@k-otp/sdk/ui/theme.css",
    await readFile(await built(path.join(dist, "ui/theme.css"))),
    BUDGETS.theme,
  ]);

  await whole("@k-otp/sdk/server", "server.js", BUDGETS.server, {
    noUi: true,
    target: "node",
  });

  // A browser bundle that imports `@k-otp/sdk/server` builds, but gets the
  // throwing stub ("browser" export condition), never the real client.
  // The entry lives under node_modules/.cache so `@k-otp/sdk` resolves
  // through the root workspace link and its `exports` map.
  const cacheDir = path.join(root, "node_modules", ".cache");
  await mkdir(cacheDir, { recursive: true });
  const browserDir = await mkdtemp(path.join(cacheDir, "k-otp-size-"));
  try {
    const entry = path.join(browserDir, "server-in-browser.js");
    await writeFile(
      entry,
      'import { createOtpServerClient } from "@k-otp/sdk/server";\nexport const run = () => createOtpServerClient({ apiKey: "sk_x" });\n',
    );
    const code = (
      await bundle("@k-otp/sdk/server (browser)", entry)
    ).bytes.toString();
    if (!code.includes("export condition. It needs an sk_ secret key")) {
      isolation.push("@k-otp/sdk/server in a browser bundle is not the stub");
    }
    if (code.includes("must not run in a browser")) {
      isolation.push(
        "@k-otp/sdk/server in a browser bundle is the real client",
      );
    }
  } finally {
    await rm(browserDir, { recursive: true, force: true });
  }

  for (const [label, bytes, budget] of rows) {
    const gzip = gzipSync(bytes, { level: 9 }).byteLength;
    const over = gzip > budget;
    failed ||= over;
    const size =
      label.includes("sources") || label.endsWith(".css")
        ? `${kb(bytes.byteLength)} raw`
        : `${kb(bytes.byteLength)} min`;
    console.log(
      `${label}: ${size}, ${kb(gzip)} ${size.endsWith("raw") ? "gzip" : "min+gzip"} (budget ${kb(budget)})${over ? "  OVER BUDGET" : ""}`,
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
    "\nTree-shaking: no subpath loads another framework, another framework's subpaths or the server client, core, headless, server and the react/vue/svelte hooks load no UI code, and browser bundles get the server stub.",
  );
}
// exitCode (not exit()) lets piped stdout flush first.
process.exitCode = failed ? 1 : 0;
