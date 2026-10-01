#!/usr/bin/env node
// Loads the BUILT `@k-otp/sdk` with plain Node.js through its `exports` map
// (ESM import and CJS require of every subpath, the IIFE bundle in a vm
// context) and performs one mocked call through each. The adapters are
// exercised the way SSR frameworks load them: React through react-dom/server,
// Vue through vue/server-renderer, Svelte stores directly. The UI subpaths
// are server-rendered without any DOM (the `.svelte` sources through a module
// hook that compiles them like an SSR bundler would).
// Run after `bun run build`: `node scripts/smoke-dist.mjs`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The root workspace depends on `@k-otp/sdk` (workspace:*), so the package
// resolves from here like it would from an app's node_modules.
const require = createRequire(import.meta.url);

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

const esmCore = await import("@k-otp/sdk");
const cjsCore = require("@k-otp/sdk");
const esmServer = await import("@k-otp/sdk/server");
const cjsServer = require("@k-otp/sdk/server");

// `@k-otp/sdk` and `@k-otp/sdk/core` are the same module.
assert.equal(await import("@k-otp/sdk/core"), esmCore, "core subpath (esm)");
assert.equal(require("@k-otp/sdk/core"), cjsCore, "core subpath (cjs)");
// `./internal` is not a public subpath.
assert.throws(
  () => require("@k-otp/sdk/internal"),
  /ERR_PACKAGE_PATH_NOT_EXPORTED|not defined by "exports"/,
);
for (const [label, mod] of [
  ["contract esm", await import("@k-otp/sdk/contract")],
  ["contract cjs", require("@k-otp/sdk/contract")],
]) {
  assert.equal(typeof mod.otpPublicContract.issue, "object", label);
  assert.equal(typeof mod.otpServerContract.balance, "object", label);
  console.log(`ok - ${label}`);
}

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
  vm.runInContext(
    readFileSync(require.resolve(`@k-otp/sdk/${file}`), "utf8"),
    bundleContext,
  );
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
  ["headless esm", await import("@k-otp/sdk/headless")],
  ["headless cjs", require("@k-otp/sdk/headless")],
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
  ["react esm", await import("@k-otp/sdk/react")],
  ["react cjs", require("@k-otp/sdk/react")],
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
  ["vue esm", await import("@k-otp/sdk/vue")],
  ["vue cjs", require("@k-otp/sdk/vue")],
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

const svelte = await import("@k-otp/sdk/svelte");
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

// UI subpaths, server-side, with no DOM.
assert.equal(typeof globalThis.window, "undefined", "no window in smoke");
assert.equal(typeof globalThis.document, "undefined", "no document in smoke");
const uiExpect = (html, label) => {
  assert.match(html, /data-k-otp="root"/, label);
  assert.match(html, /data-state="phone"/, label);
  assert.match(html, /id="otp-phone"/, label);
  assert.match(html, /data-k-otp="message"/, label);
};
for (const [label, mod] of [
  ["ui esm", await import("@k-otp/sdk/ui")],
  ["ui cjs", require("@k-otp/sdk/ui")],
]) {
  assert.equal(
    mod.parseOtpPhoneNumber("+82 10-1234-5678").value,
    "01012345678",
  );
  const form = mod.createOtpForm(
    esmCore.createOtpClient({ apiKey: "pk_smoke", fetch }),
    { purpose: "smoke", createIdempotencyKey: () => "smoke-1" },
  );
  form.setPhoneNumber("010-1234-5678");
  const sent = await form.send();
  assert.deepEqual(sent.data, issueOutput, label);
  assert.equal(form.getState().phase, "code", label);
  assert.equal(form.getState().sentTo, "010-****-5678", label);
  console.log(`ok - ${label}`);
}
for (const [label, mod] of [
  ["ui/react esm", await import("@k-otp/sdk/ui/react")],
  ["ui/react cjs", require("@k-otp/sdk/ui/react")],
]) {
  const html = renderToString(
    react.createElement(mod.OtpForm, {
      options: { apiKey: "pk_smoke", fetch },
      purpose: "smoke",
      id: "otp",
    }),
  );
  uiExpect(html, label);
  assert.equal(typeof mod.OtpForm.Root, "function", label);
  console.log(`ok - ${label}`);
}
for (const file of ["ui-react.js", "ui-react.cjs"]) {
  const code = readFileSync(path.join(root, "packages/sdk/dist", file), "utf8");
  assert.match(code, /^"use client";/, `${file} is a client module`);
}
for (const [label, mod] of [
  ["ui/vue esm", await import("@k-otp/sdk/ui/vue")],
  ["ui/vue cjs", require("@k-otp/sdk/ui/vue")],
]) {
  const app = vue.createSSRApp({
    render: () =>
      vue.h(mod.OtpForm, {
        options: { apiKey: "pk_smoke", fetch },
        purpose: "smoke",
        id: "otp",
      }),
  });
  uiExpect(await renderVue(app), label);
  console.log(`ok - ${label}`);
}
{
  // `.svelte` sources resolve through the `exports` map and are compiled
  // for the server, as SvelteKit/Vite SSR would.
  const compiler = import.meta.resolve("svelte/compiler");
  if (typeof nodeModule.registerHooks === "function") {
    // Node >= 22.15: synchronous in-thread hooks.
    const { compile, VERSION } = await import(compiler);
    nodeModule.registerHooks({
      load(url, context, next) {
        if (!url.endsWith(".svelte")) return next(url, context);
        const filename = fileURLToPath(url);
        const { js } = compile(readFileSync(filename, "utf8"), {
          filename,
          generate: VERSION.startsWith("4.") ? "ssr" : "server",
        });
        return { format: "module", source: js.code, shortCircuit: true };
      },
    });
  } else {
    // Node 20: off-thread hooks.
    const hooks = `
      import { readFile } from "node:fs/promises";
      import { fileURLToPath } from "node:url";
      const { compile, VERSION } = await import(${JSON.stringify(compiler)});
      export async function load(url, context, next) {
        if (!url.endsWith(".svelte")) return next(url, context);
        const filename = fileURLToPath(url);
        const { js } = compile(await readFile(filename, "utf8"), {
          filename,
          generate: VERSION.startsWith("4.") ? "ssr" : "server",
        });
        return { format: "module", source: js.code, shortCircuit: true };
      }`;
    nodeModule.register(
      `data:text/javascript,${encodeURIComponent(hooks)}`,
      pathToFileURL(`${root}/`),
    );
  }
  const mod = await import("@k-otp/sdk/ui/svelte");
  const { VERSION } = await import("svelte/compiler");
  const props = {
    options: { apiKey: "pk_smoke", fetch },
    purpose: "smoke",
    id: "otp",
  };
  const html = VERSION.startsWith("4.")
    ? mod.OtpForm.render(props).html
    : (await import("svelte/server")).render(mod.OtpForm, { props }).body;
  uiExpect(html, "ui/svelte");
  assert.equal(typeof mod.createOtpFormRoot, "function");
  console.log(`ok - ui/svelte (Svelte ${VERSION}, server-compiled sources)`);
}
assert.match(
  readFileSync(require.resolve("@k-otp/sdk/ui/theme.css"), "utf8"),
  /\[data-k-otp="root"\]/,
);
console.log("ok - ui/theme.css");

// Subpaths share one copy of the core modules per format (no duplicated
// `OtpApiError` class between `@k-otp/sdk` and an adapter).
for (const [label, mod] of [
  ["react", await import("@k-otp/sdk/react")],
  ["vue", await import("@k-otp/sdk/vue")],
  ["svelte", svelte],
]) {
  assert.equal(mod.OtpApiError, esmCore.OtpApiError, `${label} OtpApiError`);
  assert.equal(mod.createOtpClient, esmCore.createOtpClient, label);
}
// `@k-otp/sdk/ui/react` shares the hooks' modules: one OtpProvider context.
for (const [label, hooks, ui] of [
  [
    "esm",
    await import("@k-otp/sdk/react"),
    await import("@k-otp/sdk/ui/react"),
  ],
  ["cjs", require("@k-otp/sdk/react"), require("@k-otp/sdk/ui/react")],
]) {
  const html = renderToString(
    react.createElement(
      hooks.OtpProvider,
      { options: { apiKey: "pk_smoke", fetch } },
      react.createElement(ui.OtpForm, { purpose: "smoke", id: "otp" }),
    ),
  );
  assert.match(html, /data-k-otp="root"/, `OtpProvider + OtpForm (${label})`);
}
console.log(
  "ok - OtpProvider (react) provides the client to OtpForm (ui/react)",
);
assert.equal(require("@k-otp/sdk/react").OtpApiError, cjsCore.OtpApiError);
console.log("ok - one OtpApiError per format across subpaths");

// Across formats (ESM + CJS loaded side by side) the classes differ, but
// `instanceof` and the adapters' context keys still match.
assert.notEqual(cjsCore.OtpApiError, esmCore.OtpApiError);
const errorOptions = { code: "UNKNOWN", status: 0, message: "x" };
const cjsError = new cjsCore.OtpApiError(errorOptions);
const esmError = new esmCore.OtpApiError(errorOptions);
assert.ok(cjsError instanceof esmCore.OtpApiError, "cjs instanceof esm");
assert.ok(esmError instanceof cjsCore.OtpApiError, "esm instanceof cjs");
assert.ok(esmCore.isOtpApiError(cjsError) && cjsCore.isOtpApiError(esmError));
assert.ok(!(new Error("x") instanceof esmCore.OtpApiError));
assert.equal(
  require("@k-otp/sdk/vue").OTP_CLIENT_KEY,
  (await import("@k-otp/sdk/vue")).OTP_CLIENT_KEY,
);
console.log("ok - OtpApiError instanceof and the Vue key work across ESM/CJS");

// `@k-otp/sdk/server` under the "browser" export condition is a stub with the
// same export names whose functions throw, unless a server runtime condition
// (workerd, worker, edge-light, deno) wins.
const importServer = (...conditions) =>
  spawnSync(
    process.execPath,
    [
      ...conditions.map((c) => `--conditions=${c}`),
      "--input-type=module",
      "-e",
      `const m = await import("@k-otp/sdk/server");
      let created;
      try {
        m.createOtpServerClient({ apiKey: "sk_smoke" });
        created = "created";
      } catch (error) {
        created = error.message;
      }
      console.log(JSON.stringify({ names: Object.keys(m).sort(), created }));`,
    ],
    { cwd: root, encoding: "utf8" },
  );
const serverNames = Object.keys(esmServer).sort();
const browserServer = importServer("browser");
assert.equal(browserServer.status, 0, browserServer.stderr);
const stub = JSON.parse(browserServer.stdout);
assert.deepEqual(stub.names, serverNames, "stub exports = server exports");
assert.match(stub.created, /resolved with the "browser" export condition/);
for (const runtime of ["workerd", "worker", "edge-light", "deno"]) {
  const result = importServer(runtime, "browser");
  assert.equal(result.status, 0, `${runtime}: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout).created, "created", runtime);
}
console.log(
  "ok - server: throwing browser stub (same exports), real client for workerd/worker/edge-light/deno",
);
