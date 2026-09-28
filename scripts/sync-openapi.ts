#!/usr/bin/env bun
/**
 * Refreshes the vendored `spec/openapi.json`.
 *
 *   bun run sync:openapi                               # from the live API
 *   bun run sync:openapi --from ../api.k-otp.dev       # from a local API checkout
 *   bun run sync:openapi --from ./openapi.api.json     # from a file
 *   bun run sync:openapi --from https://.../v1.json    # from a URL
 *   bun run sync:openapi --check                       # exit 1 if it would change
 *
 * After syncing, run `bun run gen:types` and `bun run check:openapi`; update
 * `packages/sdk-core/src/contract.ts` if operations were added or removed.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { type OpenApiDocument, summarizeOperations } from "./lib/openapi-types";

const DEFAULT_SOURCE = "https://api.k-otp.dev/openapi/v1.json";
/** Location of the generated spec inside an `api.k-otp.dev` checkout. */
const CHECKOUT_SPEC_PATH = "pages/api/public/openapi/openapi.api.json";

const root = path.resolve(import.meta.dir, "..");
const target = path.join(root, "spec/openapi.json");

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const load = async (source: string): Promise<string> => {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`GET ${source} failed: HTTP ${response.status}`);
    }
    return response.text();
  }
  const resolved = path.resolve(source);
  const info = await stat(resolved);
  const file = info.isDirectory()
    ? path.join(resolved, CHECKOUT_SPEC_PATH)
    : resolved;
  return Bun.file(file).text();
};

const source = readArg("--from") ?? DEFAULT_SOURCE;
const next = JSON.parse(await load(source)) as OpenApiDocument;
if (typeof next.openapi !== "string" || typeof next.paths !== "object") {
  throw new Error(`${source} is not an OpenAPI document`);
}

const current = (await Bun.file(target).exists())
  ? (JSON.parse(await Bun.file(target).text()) as OpenApiDocument)
  : undefined;
const serialized = `${JSON.stringify(next, null, 2)}\n`;
const changed =
  !current || `${JSON.stringify(current, null, 2)}\n` !== serialized;

const ids = (doc?: OpenApiDocument): Set<string> =>
  new Set(doc ? summarizeOperations(doc).map((op) => op.operationId) : []);
const before = ids(current);
const after = ids(next);
const added = [...after].filter((id) => !before.has(id));
const removed = [...before].filter((id) => !after.has(id));

console.log(`source:   ${source}`);
console.log(
  `version:  ${current?.info.version ?? "(none)"} -> ${next.info.version}`,
);
if (added.length) console.log(`added:    ${added.join(", ")}`);
if (removed.length) console.log(`removed:  ${removed.join(", ")}`);

if (process.argv.includes("--check")) {
  if (changed) {
    console.error(
      "spec/openapi.json is out of date. Run `bun run sync:openapi`.",
    );
    process.exit(1);
  }
  console.log("spec/openapi.json is up to date.");
} else if (changed) {
  await Bun.write(target, serialized);
  console.log(
    "Updated spec/openapi.json. Next: `bun run gen:types && bun run check:openapi`.",
  );
} else {
  console.log("No changes.");
}
