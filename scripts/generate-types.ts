#!/usr/bin/env bun
/**
 * Regenerates `packages/sdk-core/src/generated/openapi.ts` from
 * `spec/openapi.json`.
 *
 *   bun run gen:types          # write
 *   bun run gen:types --check  # exit 1 if the committed file is stale
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type OpenApiDocument, renderOpenApiTypes } from "./lib/openapi-types";

const root = path.resolve(import.meta.dir, "..");
const specPath = path.join(root, "spec/openapi.json");
const outPath = path.join(root, "packages/sdk-core/src/generated/openapi.ts");

const spec = JSON.parse(await readFile(specPath, "utf8")) as OpenApiDocument;
const rendered = renderOpenApiTypes(spec);

if (process.argv.includes("--check")) {
  const current = await readFile(outPath, "utf8").catch(() => "");
  if (current !== rendered) {
    console.error(
      `${path.relative(root, outPath)} is stale. Run \`bun run gen:types\`.`,
    );
    process.exit(1);
  }
  console.log("Generated OpenAPI types are up to date.");
} else {
  await writeFile(outPath, rendered);
  console.log(`Wrote ${path.relative(root, outPath)}`);
}
