import { createRequire } from "node:module";
import path from "node:path";

/** Local path of the built CDN bundle (`bun run build` at the repo root). */
export const bundlePath = (): string => {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("@k-otp/sdk-core/package.json");
  return path.join(path.dirname(pkg), "dist", "k-otp.iife.min.js");
};
