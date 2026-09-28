#!/usr/bin/env node
// Loads the BUILT packages with plain Node.js (ESM import, CJS require, and the
// IIFE bundle in a vm context) and performs one mocked call through each. The
// adapters are exercised the way SSR frameworks load them: React through
// react-dom/server, Vue through vue/server-renderer, Svelte stores directly.
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
const fetch = async (input, init) => {
  // Normalize like a real fetch would, whatever the calling convention.
  const request = new Request(input, init);
  assert.equal(request.method, "POST");
  assert.equal(new URL(request.url).pathname, "/v1/issue");
  assert.match(request.headers.get("authorization") ?? "", /^Bearer [ps]k_/);
  assert.equal(request.headers.get("idempotency-key"), "smoke-1");
  assert.equal((await request.json()).idempotencyKey, "smoke-1");
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

/** Browser-like globals for the IIFE bundles. */
const browserGlobals = {
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
  document: {},
};
// Both published CDN bundles (separate tsdown passes, so they can diverge).
// Results cross the vm boundary as JSON so deepEqual compares plain data.
for (const file of ["k-otp.iife.js", "k-otp.iife.min.js"]) {
  const bundleContext = vm.createContext({ ...browserGlobals });
  bundleContext.window = bundleContext;
  vm.runInContext(readFileSync(dist("sdk-core", file), "utf8"), bundleContext);
  const result = await vm.runInContext(
    `KOtp.createOtpClient({ apiKey: "pk_smoke" })
      .issue(${JSON.stringify(input)})
      .then((r) => JSON.stringify(r))`,
    bundleContext,
  );
  assert.deepEqual(JSON.parse(result), issueOutput, file);
  assert.throws(
    () =>
      vm.runInContext(
        `KOtp.createOtpClient({ apiKey: "sk_live" })`,
        bundleContext,
      ),
    /Refusing to use an sk_ secret key/,
  );
  const flow = await vm.runInContext(
    `(async () => {
      const flow = KOtp.createOtpFlow(KOtp.createOtpClient({ apiKey: "pk_smoke" }), {
        createIdempotencyKey: () => "smoke-1",
      });
      const sent = await flow.send({ phoneNumber: "01012345678", purpose: "smoke" });
      return JSON.stringify({
        data: sent.data,
        cooldownRemainingMs: flow.getState().cooldownRemainingMs,
      });
    })()`,
    bundleContext,
  );
  const flowResult = JSON.parse(flow);
  assert.deepEqual(flowResult.data, issueOutput, file);
  assert.equal(flowResult.cooldownRemainingMs > 0, true, file);
  console.log(`ok - iife ${file} (window.KOtp, KOtp.createOtpFlow)`);
}

for (const [label, mod] of [
  [
    "headless esm",
    await import(pathToFileURL(dist("sdk-core", "headless.js")).href),
  ],
  ["headless cjs", require(dist("sdk-core", "headless.cjs"))],
]) {
  const flow = mod.createOtpFlow(
    esmCore.createOtpClient({ apiKey: "pk_smoke", fetch }),
    {
      createIdempotencyKey: () => "smoke-1",
    },
  );
  const sent = await flow.send({
    phoneNumber: "01012345678",
    purpose: "smoke",
  });
  assert.deepEqual(sent.data, issueOutput, label);
  assert.equal(flow.getState().cooldownRemainingMs > 0, true, label);
  console.log(`ok - ${label}`);
}

// Adapters.
const adapterInput = { ...input };
const react = await import("react");
const { renderToString } = await import("react-dom/server");
for (const [label, mod] of [
  [
    "react esm",
    await import(pathToFileURL(dist("sdk-react", "index.js")).href),
  ],
  ["react cjs", require(dist("sdk-react", "index.cjs"))],
]) {
  let issue;
  const View = () => {
    issue = mod.useOtpIssue();
    return react.createElement("p", null, issue.status);
  };
  const html = renderToString(
    react.createElement(
      mod.OtpProvider,
      { options: { apiKey: "pk_smoke", fetch } },
      react.createElement(View),
    ),
  );
  assert.equal(html, "<p>idle</p>", label);
  const result = await issue.run(adapterInput);
  assert.deepEqual(result.data, issueOutput, label);
  console.log(`ok - ${label}`);
}

const vue = await import("vue");
const { renderToString: renderVue } = await import("vue/server-renderer");
for (const [label, mod] of [
  ["vue esm", await import(pathToFileURL(dist("sdk-vue", "index.js")).href)],
  ["vue cjs", require(dist("sdk-vue", "index.cjs"))],
]) {
  let otp;
  const app = vue.createSSRApp({
    setup: () => {
      otp = mod.useOtp();
      return () => vue.h("p", otp.issue.status.value);
    },
  });
  app.use(mod.createOtpPlugin({ apiKey: "pk_smoke", fetch }));
  assert.equal(await renderVue(app), "<p>idle</p>", label);
  const result = await otp.issue.run(adapterInput);
  assert.deepEqual(result.data, issueOutput, label);
  assert.equal(otp.issue.status.value, "success", label);
  console.log(`ok - ${label}`);
}

const svelte = await import(pathToFileURL(dist("sdk-svelte", "index.js")).href);
const stores = svelte.createOtpStores({ apiKey: "pk_smoke", fetch });
// Observe the store wiring, not only the promise returned by run().
const statuses = [];
const unsubscribe = stores.issue.subscribe((state) =>
  statuses.push(state.status),
);
const svelteResult = await stores.issue.run(adapterInput);
unsubscribe();
assert.deepEqual(svelteResult.data, issueOutput, "svelte esm");
assert.deepEqual(statuses, ["idle", "loading", "success"], "svelte esm");
console.log("ok - svelte esm");
