import { createRequire } from "node:module";

/**
 * Local path of the built CDN bundle (`bun run build` at the repo root),
 * resolved through the `@k-otp/sdk/k-otp.iife.min.js` package export.
 */
export const bundlePath = (): string =>
  createRequire(import.meta.url).resolve("@k-otp/sdk/k-otp.iife.min.js");
