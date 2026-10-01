#!/usr/bin/env bun
/**
 * CI compatibility matrix helper: pins the workspace catalog to another
 * React and/or Svelte major (and/or Vue minor) before `bun install`, so the
 * adapter tests in `tests/` run against it. Never commit the result.
 *
 *   bun run scripts/set-framework-versions.ts --react 18 --svelte 4 --vue 3.3
 */
import path from "node:path";
import { parseArgs } from "node:util";

/**
 * Catalog pins per major. An empty object means "the major the catalog
 * already pins": keep it in sync with the root catalog when that major
 * changes (tests/versions.test.ts asserts the installed major either way).
 */
const VERSIONS: Record<string, Record<string, Record<string, string>>> = {
  react: {
    "18": {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "@types/react": "^18.3.28",
      "@types/react-dom": "^18.3.7",
    },
    "19": {},
  },
  svelte: {
    "4": { svelte: "^4.2.20" },
    "5": {},
  },
  vue: {
    "3.3": { vue: "~3.3.13" },
    "3.5": {},
  },
};

const { values } = parseArgs({
  options: {
    react: { type: "string" },
    svelte: { type: "string" },
    vue: { type: "string" },
  },
});
if (!values.react && !values.svelte && !values.vue) {
  throw new Error(
    "pass --react <major>, --svelte <major> and/or --vue <minor>",
  );
}
const file = path.resolve(import.meta.dir, "..", "package.json");
const manifest = (await Bun.file(file).json()) as {
  workspaces?: { catalog?: Record<string, string> };
};
const catalog = manifest.workspaces?.catalog;
if (!catalog || typeof catalog !== "object") {
  throw new Error(`${file} has no workspaces.catalog to pin`);
}
for (const framework of ["react", "svelte", "vue"] as const) {
  const major = values[framework];
  if (!major) continue;
  const pins = VERSIONS[framework]?.[major];
  if (!pins) throw new Error(`unsupported ${framework} major: ${major}`);
  Object.assign(catalog, pins);
  console.log(`${framework} ${major}: ${JSON.stringify(pins)}`);
}
await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
