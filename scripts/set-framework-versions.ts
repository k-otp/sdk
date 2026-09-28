#!/usr/bin/env bun
/**
 * CI compatibility matrix helper: pins the workspace catalog to another
 * React and/or Svelte major before `bun install`, so the adapter tests in
 * `tests/` run against it. Never commit the result.
 *
 *   bun run scripts/set-framework-versions.ts --react 18 --svelte 4
 */
import path from "node:path";
import { parseArgs } from "node:util";

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
};

const { values } = parseArgs({
  options: { react: { type: "string" }, svelte: { type: "string" } },
});
const file = path.resolve(import.meta.dir, "..", "package.json");
const manifest = (await Bun.file(file).json()) as {
  workspaces: { catalog: Record<string, string> };
};
for (const framework of ["react", "svelte"] as const) {
  const major = values[framework];
  if (!major) continue;
  const pins = VERSIONS[framework]?.[major];
  if (!pins) throw new Error(`unsupported ${framework} major: ${major}`);
  Object.assign(manifest.workspaces.catalog, pins);
  console.log(`${framework} ${major}: ${JSON.stringify(pins)}`);
}
await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
