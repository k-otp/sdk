/**
 * What `@k-otp/sdk/server` resolves to under the "browser" export condition
 * (browser bundles of Vite, webpack, esbuild, Rollup, Metro, ...). The server
 * client needs an `sk_` secret key, which must never reach a browser, so this
 * module exports nothing: a named import such as `createOtpServerClient`
 * fails the bundle, and loading the module anyway throws.
 *
 * Server runtimes whose bundlers also enable "browser" (Cloudflare Workers:
 * "workerd"/"worker", Vercel Edge: "edge-light", Deno-based edge: "deno") are
 * matched first in `package.json` and get the real server client.
 */
throw new Error(
  '@k-otp/sdk/server was resolved with the "browser" export condition. It needs an sk_ secret key and must only run on a server: use `@k-otp/sdk` (or `@k-otp/sdk/react|vue|svelte`) with a pk_ public key in browsers. For jsdom-style tests of server code, resolve with the "node" condition (e.g. Jest `testEnvironmentOptions.customExportConditions`).',
);

export {};
