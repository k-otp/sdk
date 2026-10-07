#!/usr/bin/env bun
/**
 * Refreshes the vendored `spec/openapi.json`.
 *
 *   bun run sync:openapi                               # from the live API
 *   bun run sync:openapi --from ./openapi.json         # from a file
 *   bun run sync:openapi --from https://.../v1.json    # from a URL
 *   bun run sync:openapi --check                       # exit 1 if it would change
 *
 * After syncing, run `bun run gen:types` and `bun run check:openapi`; update
 * `packages/sdk/src/core/contract.ts` if operations were added or removed.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { type OpenApiDocument, summarizeOperations } from "./lib/openapi-types";

const DEFAULT_SOURCE = "https://api.k-otp.dev/openapi/v1.json";

const root = path.resolve(import.meta.dir, "..");
const target = path.join(root, "spec/openapi.json");

/** Fails with one friendly line instead of a stack trace. */
const die = (message: string): never => {
  console.error(`sync:openapi: ${message}`);
  process.exit(1);
};

/** Value of `--name <value>`; a missing value is an error, never a default. */
const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) die(`${name} needs a value`);
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const load = async (source: string): Promise<string> => {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      headers: { accept: "application/json" },
    }).catch((error: unknown) => die(`GET ${source} failed: ${error}`));
    if (!response.ok) die(`GET ${source} failed: HTTP ${response.status}`);
    return response.text();
  }
  const resolved = path.resolve(source);
  const info = await stat(resolved).catch((error: unknown) =>
    die(
      `--from ${source}: cannot read ${resolved} (${error instanceof Error ? error.message : String(error)})`,
    ),
  );
  if (!info.isFile()) die(`--from ${source}: ${resolved} is not a file`);
  return Bun.file(resolved).text();
};

const source = readArg("--from") ?? DEFAULT_SOURCE;
const raw = await load(source);
let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  die(`${source} did not return JSON (${error})`);
}
if (
  !isRecord(parsed) ||
  typeof parsed.openapi !== "string" ||
  !isRecord(parsed.paths) ||
  !isRecord(parsed.info) ||
  typeof parsed.info.version !== "string"
) {
  die(`${source} is not an OpenAPI document (openapi, info.version, paths)`);
}
const next = parsed as OpenApiDocument;

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
