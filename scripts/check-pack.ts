#!/usr/bin/env bun
/**
 * Packs every publishable package exactly like the release does
 * (`bun pm pack`, which rewrites `workspace:` / `catalog:` ranges) and checks
 * the tarball:
 *
 * - every non-private `packages/*` package is covered
 * - only `dist/`, README.md, CHANGELOG.md, LICENSE and package.json are
 *   published
 * - every `exports`/`main`/`module`/`types`/`unpkg`/`jsdelivr` target exists
 *   in the tarball
 * - dependencies are an explicit allowlist (no private/internal packages,
 *   no `workspace:`/`catalog:` leftovers, lockstep versions between SDKs)
 * - every bare import in the built JS is a declared dependency
 *
 * Run `bun run build` first.
 */
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

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
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Allowed runtime dependencies per package. */
const ALLOWED_DEPENDENCIES: Record<string, readonly string[]> = {
  "@k-otp/sdk-core": ["@orpc/client", "@orpc/contract", "@orpc/openapi-client"],
  "@k-otp/sdk-server": ["@k-otp/sdk-core"],
  "@k-otp/sdk-react": ["@k-otp/sdk-core", "react"],
  "@k-otp/sdk-vue": ["@k-otp/sdk-core", "vue"],
  "@k-otp/sdk-svelte": ["@k-otp/sdk-core", "svelte"],
};

/** Frameworks must be peer dependencies (never bundled or installed twice). */
const REQUIRED_PEERS: Record<string, readonly string[]> = {
  "@k-otp/sdk-react": ["react"],
  "@k-otp/sdk-vue": ["vue"],
  "@k-otp/sdk-svelte": ["svelte"],
};

const PACKAGES = [
  "packages/sdk-core",
  "packages/sdk-server",
  "packages/sdk-react",
  "packages/sdk-vue",
  "packages/sdk-svelte",
];
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

const bareImports = (code: string): string[] => {
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1] ?? "";
      // Relative paths and Node builtins (`node:fs` as well as `fs`).
      if (!specifier.startsWith(".") && !isBuiltin(specifier)) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers];
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

// Every publishable package must be listed, and the lockstep versions are
// known before any package is checked (independent of PACKAGES order).
const versions = new Map<string, string>();
for (const entry of await readdir(path.join(root, "packages"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const dir = `packages/${entry.name}`;
  if (!(await Bun.file(path.join(root, dir, "package.json")).exists()))
    continue;
  const manifest = await readManifest(dir);
  if (manifest.private) continue;
  if (!PACKAGES.includes(dir)) {
    fail(manifest.name, `${dir} is publishable but missing from PACKAGES`);
  }
  versions.set(manifest.name, manifest.version);
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
  if (!name.startsWith("@k-otp/sdk-")) fail(name, "unexpected package name");

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
  const allowed = new Set(ALLOWED_DEPENDENCIES[name] ?? []);
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
  for (const peer of REQUIRED_PEERS[name] ?? []) {
    if (!manifest.peerDependencies?.[peer]) {
      fail(name, `${peer} must be a peer dependency`);
    }
    if (manifest.dependencies?.[peer]) {
      fail(name, `${peer} must not be a regular dependency`);
    }
  }
  const coreRange = manifest.dependencies?.["@k-otp/sdk-core"];
  if (coreRange !== undefined) {
    const coreVersion = versions.get("@k-otp/sdk-core");
    if (coreRange !== coreVersion) {
      fail(
        name,
        `@k-otp/sdk-core must be pinned to ${coreVersion} (got ${coreRange})`,
      );
    }
  }

  // Imports in the built output must be declared dependencies.
  for (const file of files.filter((f) => /\.(c?js|mjs)$/.test(f))) {
    if (file.includes(".iife.")) continue; // self-contained CDN bundle
    const code = await readFile(path.join(unpacked, file), "utf8");
    for (const specifier of bareImports(code)) {
      if (!Object.hasOwn(runtimeDeps, packageName(specifier))) {
        fail(name, `${file} imports undeclared package "${specifier}"`);
      }
    }
  }

  const packed = await Bun.file(tarball).arrayBuffer();
  console.log(
    `${name}@${manifest.version}: ${files.length} files, ${(packed.byteLength / 1024).toFixed(1)} kB packed`,
  );
};

try {
  for (const dir of PACKAGES) {
    try {
      await checkPackage(dir);
    } catch (error) {
      // Keep checking the other packages; report everything at the end.
      fail(dir, error instanceof Error ? error.message : String(error));
    }
  }

  const unique = new Set(versions.values());
  if (unique.size > 1) {
    errors.push(
      `lockstep versions differ: ${[...versions].map(([n, v]) => `${n}@${v}`).join(", ")}`,
    );
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
