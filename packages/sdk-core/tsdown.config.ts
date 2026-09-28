import { defineConfig } from "tsdown";

const shared = {
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
} as const;

export default defineConfig([
  // npm entry points: ESM + CJS with matching .d.ts / .d.cts.
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      contract: "src/contract.ts",
      headless: "src/headless.ts",
      internal: "src/internal.ts",
    },
    format: ["esm", "cjs"],
    dts: { generator: "oxc" },
    clean: false,
  },
  // CDN bundle for <script> tags: exposes `window.KOtp`, bundles oRPC.
  {
    ...shared,
    entry: { "k-otp": "src/iife.ts" },
    format: "iife",
    globalName: "KOtp",
    platform: "browser",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    dts: false,
    clean: false,
    // The unminified bundle is already readable; skip its source map.
    sourcemap: false,
    outExtensions: () => ({ js: ".js" }),
  },
  {
    ...shared,
    entry: { "k-otp": "src/iife.ts" },
    format: "iife",
    globalName: "KOtp",
    platform: "browser",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    minify: true,
    dts: false,
    clean: false,
    outExtensions: () => ({ js: ".min.js" }),
  },
]);
