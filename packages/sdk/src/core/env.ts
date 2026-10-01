/**
 * `true` in a browser page (both `window` and `document` exist). Web and
 * Service Workers are intentionally NOT detected: edge runtimes such as
 * Cloudflare Workers expose worker-like globals too, and legitimately use
 * `sk_` keys there.
 */
export const isBrowser = (): boolean =>
  typeof (globalThis as { window?: unknown }).window !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";
