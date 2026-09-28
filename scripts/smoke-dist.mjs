#!/usr/bin/env node
// Loads the BUILT packages with plain Node.js (ESM import, CJS require, and the
// IIFE bundle in a vm context) and performs one mocked call through each.
// Run after `bun run build`: `node scripts/smoke-dist.mjs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dist = (pkg, file) => path.join(root, "packages", pkg, "dist", file);

const issueOutput = {
  issueId: "i_1",
  expiresAt: "2026-01-01T00:03:00Z",
  attemptsRemaining: 5,
  queuedAt: "2026-01-01T00:00:00Z",
};
const fetch = async (request) => {
  assert.equal(request.headers.get("idempotency-key"), "smoke-1");
  return new Response(JSON.stringify(issueOutput), {
    headers: { "content-type": "application/json" },
  });
};
const input = {
  phoneNumber: "01012345678",
  purpose: "smoke",
  idempotencyKey: "smoke-1",
};

const esmCore = await import(pathToFileURL(dist("sdk-core", "index.js")).href);
const cjsCore = require(dist("sdk-core", "index.cjs"));
const esmServer = await import(
  pathToFileURL(dist("sdk-server", "index.js")).href
);
const cjsServer = require(dist("sdk-server", "index.cjs"));

for (const [label, mod] of [
  ["core esm", esmCore],
  ["core cjs", cjsCore],
]) {
  const result = await mod
    .createOtpClient({ apiKey: "pk_smoke", fetch })
    .issue(input);
  assert.deepEqual(result, issueOutput, label);
  console.log(`ok - ${label}`);
}
for (const [label, mod] of [
  ["server esm", esmServer],
  ["server cjs", cjsServer],
]) {
  const result = await mod
    .createOtpServerClient({ apiKey: "sk_smoke", fetch })
    .issue(input);
  assert.deepEqual(result, issueOutput, label);
  console.log(`ok - ${label}`);
}

const context = vm.createContext({
  fetch,
  Response,
  Request,
  Headers,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  DOMException,
  TextEncoder,
  TextDecoder,
  Blob,
  File,
  FormData,
  ReadableStream,
  WritableStream,
  TransformStream,
  TextDecoderStream,
  TextEncoderStream,
  performance,
  queueMicrotask,
  setTimeout,
  clearTimeout,
  crypto: globalThis.crypto,
  console,
});
context.window = context;
context.document = {};
vm.runInContext(
  readFileSync(dist("sdk-core", "k-otp.iife.min.js"), "utf8"),
  context,
);
const result = await vm.runInContext(
  `KOtp.createOtpClient({ apiKey: "pk_smoke" }).issue(${JSON.stringify(input)})`,
  context,
);
assert.equal(result.issueId, issueOutput.issueId);
assert.throws(
  () => vm.runInContext(`KOtp.createOtpClient({ apiKey: "sk_live" })`, context),
  /Refusing to use an sk_ secret key/,
);
console.log("ok - iife (window.KOtp)");
