#!/usr/bin/env bun
/**
 * Packs the publishable package exactly like the release does
 * (`bun pm pack`, which rewrites `workspace:` / `catalog:` ranges) and checks
 * the tarball:
 *
 * - `@k-otp/sdk` is the only publishable `packages/*` package
 * - only `dist/`, README.md, CHANGELOG.md, LICENSE and package.json are
 *   published
 * - the `exports` map has exactly the public subpaths below, and every
 *   `exports`/`main`/`module`/`types`/`unpkg`/`jsdelivr` target exists in the
 *   tarball
 * - dependencies are an explicit allowlist (no private/internal packages,
 *   no `workspace:`/`catalog:` leftovers); React, Vue and Svelte are
 *   optional peer dependencies
 * - every bare import in the built JS (and the shipped `.svelte` sources)
 *   is a declared dependency, and a framework is only imported by its own
 *   subpaths: `react` only from `dist/react.*`, `dist/ui-react.*` and the
 *   chunk they share (`dist/react-<hash>.js`), never from the core or a
 *   chunk of another subpath
 * - `sideEffects` lists only the CSS files (the optional theme)
 * - `"use client"` opens exactly the files with React code: the react and
 *   ui-react entries and their shared hooks chunk (via source maps)
 *
 * Run `bun run build` first.
 */
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bareImports } from "./package-imports";

const root = path.resolve(import.meta.dir, "..");

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  module?: string;
  types?: string;
  unpkg?: string;
  jsdelivr?: string;
  exports?: unknown;
  sideEffects?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const PACKAGE_DIR = "packages/sdk";
const PACKAGE_NAME = "@k-otp/sdk";

/** The public subpaths, in order. Anything else (e.g. `./internal`) fails. */
const EXPECTED_EXPORTS = [
  ".",
  "./core",
  "./headless",
  "./contract",
  "./testing",
  "./server",
  "./kiota",
  "./react",
  "./vue",
  "./svelte",
  "./ui",
  "./ui/react",
  "./ui/vue",
  "./ui/svelte",
  "./ui/theme.css",
  "./k-otp.iife.js",
  "./k-otp.iife.min.js",
  "./package.json",
];

/** Allowed runtime dependencies (regular and peer). */
const ALLOWED_DEPENDENCIES = [
  "@microsoft/kiota-abstractions",
  "@microsoft/kiota-bundle",
  "@microsoft/kiota-http-fetchlibrary",
  "@microsoft/kiota-serialization-form",
  "@microsoft/kiota-serialization-json",
  "@microsoft/kiota-serialization-multipart",
  "@microsoft/kiota-serialization-text",
  "@orpc/client",
  "@orpc/contract",
  "@orpc/openapi-client",
  "react",
  "vue",
  "svelte",
];

/**
 * Frameworks are optional peer dependencies (never bundled, never installed
 * for apps that do not use them), each imported only by the files of its own
 * subpaths (see `owner`).
 */
const FRAMEWORKS: Record<string, string[]> = {
  react: ["react", "ui-react"],
  vue: ["vue", "ui-vue"],
  svelte: ["svelte", "ui-svelte"],
};

/** Entries that must start with `"use client"`. */
const REACT_ENTRY = /^dist[/\\](?:ui-)?react\.c?js$/;
/** Source directories of React code (hooks and components). */
const REACT_SOURCES = /(?:^|[/\\])src[/\\](?:ui[/\\])?react[/\\]/;

/** Whether a built file's source map lists React sources. */
const hasReactSources = async (
  unpacked: string,
  file: string,
): Promise<boolean> => {
  try {
    const map = JSON.parse(
      await readFile(path.join(unpacked, `${file}.map`), "utf8"),
    ) as { sources?: string[] };
    return (map.sources ?? []).some((source) => REACT_SOURCES.test(source));
  } catch {
    return false; // no source map: the IIFE bundles and the server stub
  }
};

/** Only the theme has side effects (importing it applies styles). */
const SIDE_EFFECTS = ["**/*.css"];

/**
 * The subpath a built file belongs to: `dist/react.js` and its shared
 * chunk `dist/react-<hash>.js` -> `react`; `dist/ui-svelte/*` ->
 * `ui-svelte`; `dist/ui-<hash>.js` -> `ui`.
 */
const owner = (file: string): string => {
  const [top, ...rest] = path.normalize(file).split(path.sep);
  if (top === "dist" && rest.length > 1) return rest[0] ?? "";
  const base = (rest[0] ?? top ?? "").split(".")[0] ?? "";
  return base.replace(/-[\w-]{8}$/, "");
};

const ALLOWED_TOP_LEVEL = new Set([
  "dist",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
]);

const errors: string[] = [];
const fail = (pkg: string, message: string) =>
  errors.push(`${pkg}: ${message}`);

const run = async (cmd: string[], cwd: string): Promise<string> => {
  const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed:\n${stderr}`);
  return stdout;
};

const walk = async (dir: string, base = dir): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
};

const exportTargets = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(exportTargets);
  }
  return [];
};

const packageName = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);

const readManifest = async (dir: string): Promise<Manifest> =>
  JSON.parse(
    await readFile(path.join(root, dir, "package.json"), "utf8"),
  ) as Manifest;

const rootLicense = await readFile(path.join(root, "LICENSE"), "utf8");

// `@k-otp/sdk` must be the only publishable package.
for (const entry of await readdir(path.join(root, "packages"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const dir = `packages/${entry.name}`;
  if (!(await Bun.file(path.join(root, dir, "package.json")).exists()))
    continue;
  let manifest: Manifest;
  try {
    manifest = await readManifest(dir);
  } catch (error) {
    // Report it with the other failures instead of aborting the discovery.
    fail(
      dir,
      `invalid package.json (${error instanceof Error ? error.message : String(error)})`,
    );
    continue;
  }
  if (manifest.private) continue;
  if (dir !== PACKAGE_DIR) {
    fail(manifest.name, `${dir} is publishable; only ${PACKAGE_DIR} may be`);
  }
}

const work = await mkdtemp(path.join(tmpdir(), "k-otp-pack-"));

const checkPackage = async (dir: string): Promise<void> => {
  const pkgDir = path.join(root, dir);
  const dest = path.join(work, path.basename(dir));
  await mkdir(dest, { recursive: true });
  await run(
    ["bun", "pm", "pack", "--destination", dest, "--ignore-scripts", "--quiet"],
    pkgDir,
  );
  // Find the tarball on disk instead of parsing `bun pm pack` output.
  const tarballs = (await readdir(dest)).filter((f) => f.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(
      `expected one tarball in ${dest}, found ${tarballs.length}`,
    );
  }
  const tarball = path.join(dest, tarballs[0] as string);
  await run(["tar", "-xzf", tarball, "-C", dest], root);
  const unpacked = path.join(dest, "package");
  const files = await walk(unpacked);
  const manifest = JSON.parse(
    await readFile(path.join(unpacked, "package.json"), "utf8"),
  ) as Manifest;
  const name = manifest.name;

  if (manifest.private) fail(name, "package is private");
  if (name !== PACKAGE_NAME) fail(name, `expected ${PACKAGE_NAME}`);
  if (JSON.stringify(manifest.sideEffects) !== JSON.stringify(SIDE_EFFECTS)) {
    fail(
      name,
      `sideEffects must be ${JSON.stringify(SIDE_EFFECTS)} (tree-shaking of unused subpaths; CSS is a side effect)`,
    );
  }
  const css = files.filter((f) => f.endsWith(".css"));
  if (!css.includes(path.normalize("dist/ui/theme.css"))) {
    fail(name, "dist/ui/theme.css (./ui/theme.css) is missing");
  }

  // The public subpaths, exactly.
  const exportKeys =
    manifest.exports && typeof manifest.exports === "object"
      ? Object.keys(manifest.exports)
      : [];
  if (JSON.stringify(exportKeys) !== JSON.stringify(EXPECTED_EXPORTS)) {
    fail(
      name,
      `exports subpaths ${JSON.stringify(exportKeys)} != ${JSON.stringify(EXPECTED_EXPORTS)}`,
    );
  }

  // Published files.
  for (const file of files) {
    const top = file.split(path.sep)[0] ?? file;
    if (!ALLOWED_TOP_LEVEL.has(top)) fail(name, `unexpected file ${file}`);
  }
  for (const required of ["README.md", "LICENSE", "package.json"]) {
    if (!files.includes(required)) fail(name, `missing ${required}`);
  }
  if (files.includes("LICENSE")) {
    const license = await readFile(path.join(unpacked, "LICENSE"), "utf8");
    if (license !== rootLicense)
      fail(name, "LICENSE differs from root LICENSE");
  }
  const targets = [
    manifest.main,
    manifest.module,
    manifest.types,
    manifest.unpkg,
    manifest.jsdelivr,
    ...exportTargets(manifest.exports),
  ].filter((t): t is string => typeof t === "string");
  for (const target of targets) {
    const normalized = path.normalize(target);
    if (normalized === "package.json") continue;
    if (!files.includes(normalized)) {
      fail(name, `exports target ${target} is missing from the tarball`);
    }
  }

  // Dependencies.
  const allowed = new Set(ALLOWED_DEPENDENCIES);
  const runtimeDeps: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
  for (const [dep, range] of Object.entries(runtimeDeps)) {
    if (!allowed.has(dep)) fail(name, `dependency ${dep} is not allowlisted`);
    if (/^(workspace|catalog|file|link):/.test(range)) {
      fail(name, `unresolved dependency range ${dep}@${range}`);
    }
  }
  if (
    manifest.devDependencies &&
    Object.keys(manifest.devDependencies).length
  ) {
    // Harmless for consumers, but keep published manifests minimal.
    fail(name, "devDependencies should not be published");
  }
  for (const framework of Object.keys(FRAMEWORKS)) {
    if (!manifest.peerDependencies?.[framework]) {
      fail(name, `${framework} must be a peer dependency`);
    }
    if (manifest.peerDependenciesMeta?.[framework]?.optional !== true) {
      fail(name, `${framework} must be an optional peer dependency`);
    }
    if (manifest.dependencies?.[framework]) {
      fail(name, `${framework} must not be a regular dependency`);
    }
  }

  // Imports in the built output must be declared dependencies.
  for (const file of files.filter((f) => /\.(c?js|mjs|svelte)$/.test(f))) {
    const code = await readFile(path.join(unpacked, file), "utf8");
    // `"use client"` opens every file with React code (Next.js App Router):
    // the react and ui-react entries and the hooks chunk they share, found
    // through the source maps. On any other file (a core chunk) it would
    // turn framework-free code into client code.
    const useClient = /^\s*["']use client["'];?/.test(code);
    const needsUseClient =
      REACT_ENTRY.test(file) || (await hasReactSources(unpacked, file));
    if (needsUseClient && !useClient) {
      fail(
        name,
        `${file} contains React code and must start with "use client"`,
      );
    }
    if (!needsUseClient && /["']use client["']/.test(code)) {
      fail(name, `${file} has no React code and must not contain "use client"`);
    }
    if (file.includes(".iife.")) continue; // self-contained CDN bundle
    for (const specifier of bareImports(code, file.endsWith(".svelte"))) {
      const dep = packageName(specifier);
      if (!Object.hasOwn(runtimeDeps, dep)) {
        fail(name, `${file} imports undeclared package "${specifier}"`);
      }
      // dist/react.js may import react; the core or dist/vue.js may not.
      const subpaths = FRAMEWORKS[dep];
      if (subpaths && !subpaths.includes(owner(file))) {
        fail(
          name,
          `${file} imports "${specifier}" outside ${subpaths.join("/")}`,
        );
      }
    }
  }

  const packed = await Bun.file(tarball).arrayBuffer();
  console.log(
    `${name}@${manifest.version}: ${path.basename(tarball)}, ${files.length} files, ${(packed.byteLength / 1024).toFixed(1)} kB packed`,
  );
  console.log(`  exports: ${exportKeys.join(" ")}`);
};

try {
  try {
    await checkPackage(PACKAGE_DIR);
  } catch (error) {
    fail(PACKAGE_DIR, error instanceof Error ? error.message : String(error));
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`\nPack check failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Pack check passed.");
}
