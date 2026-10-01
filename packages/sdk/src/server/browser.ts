/**
 * What `@k-otp/sdk/server` resolves to under the "browser" export condition
 * (browser bundles of Vite, webpack, esbuild, Rollup, Metro, ...). The server
 * client needs an `sk_` secret key, which must never reach a browser, so the
 * real client is not shipped: this module has the same named exports, and
 * every function (and the `OtpApiError` constructor) throws an explanatory
 * error when called. The constants are the plain public values.
 *
 * It has no top-level side effects on purpose: the package is
 * `sideEffects: false`, so a load-time throw could be dropped by a bundler;
 * a throw on call cannot. `scripts/smoke-dist.mjs` checks that the export
 * names match `dist/server.js`.
 *
 * Server runtimes whose bundlers also enable "browser" (Cloudflare Workers:
 * "workerd"/"worker", Vercel Edge: "edge-light", Deno-based edge: "deno") are
 * matched first in `package.json` and get the real server client.
 */
export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  OTP_API_ERROR_CODES,
} from "../core";

type Stub = (...args: unknown[]) => never;

const serverOnly = (name: string): Stub =>
  // A `function` (not an arrow) so `new` and `instanceof` fail predictably.
  function stub(): never {
    throw new Error(
      `@k-otp/sdk/server (${name}) was resolved with the "browser" export condition. It needs an sk_ secret key and must only run on a server: use \`@k-otp/sdk\` (or \`@k-otp/sdk/react|vue|svelte\`) with a pk_ public key in browsers. For server code built or tested with browser conditions (Vite SSR with ssr.target "webworker", jsdom tests), resolve with the "workerd", "worker" or "node" condition; see docs/reference/server.md.`,
    );
  };

export const createOtpServerClient: Stub = serverOnly("createOtpServerClient");
export const paginate: Stub = serverOnly("paginate");
export const paginatePages: Stub = serverOnly("paginatePages");
export const createIdempotencyKey: Stub = serverOnly("createIdempotencyKey");
export const isOtpApiError: Stub = serverOnly("isOtpApiError");
export const normalizeIdempotencyKey: Stub = serverOnly(
  "normalizeIdempotencyKey",
);
export const normalizeOtpApiError: Stub = serverOnly("normalizeOtpApiError");
export const OtpApiError: Stub = serverOnly("OtpApiError");
