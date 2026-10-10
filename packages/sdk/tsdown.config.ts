import { defineConfig } from "tsdown";

const shared = {
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  clean: false,
} as const;

/**
 * One npm entry per subpath export. Every entry is built in ONE graph per
 * format, so modules shared between subpaths (the transport, `OtpApiError`,
 * the headless flow) land in shared chunks and exist once at runtime:
 * `@k-otp/sdk` and `@k-otp/sdk/react` see the same `OtpApiError` class.
 * Framework code lives only in its own entry chunk, so importing
 * `@k-otp/sdk/react` never loads Vue or Svelte (checked by `bun run size`).
 */
const entries = {
  core: "src/core/index.ts",
  headless: "src/headless/index.ts",
  contract: "src/core/contract.ts",
  testing: "src/testing/index.ts",
  server: "src/server/index.ts",
  react: "src/react/index.ts",
  vue: "src/vue/index.ts",
  svelte: "src/svelte/index.ts",
  ui: "src/ui/index.ts",
  "ui-react": "src/ui/react/index.ts",
  "ui-vue": "src/ui/vue/index.ts",
  // The runtime of the Svelte components. The components themselves are
  // `.svelte` sources copied next to it (see `copy` below) and compiled by
  // the app's Svelte 4 or 5 compiler through the "svelte" export condition.
  "ui-svelte/runtime": "src/ui/svelte/runtime.ts",
};

// Svelte itself is ESM-only, so the Svelte subpaths have no CommonJS build.
const {
  svelte: _svelte,
  "ui-svelte/runtime": _uiSvelte,
  ...cjsEntries
} = entries;

/**
 * Hooks, context and components only work in client components (Next.js
 * App Router). `"use client"` opens every JS file that contains React code
 * (`src/react`, `src/ui/react`): the `react` and `ui-react` entries and the
 * chunk with the hooks they share. Never a core chunk or a declaration file.
 */
const REACT_SOURCES = /[\\/]src[\\/](?:ui[\\/])?react[\\/]/;
const reactClientBanner = (chunk: {
  name: string;
  fileName: string;
  isEntry: boolean;
  moduleIds: string[];
}): string =>
  !/\.d\.c?ts$/.test(chunk.fileName) &&
  ((chunk.isEntry && /^(?:ui-)?react$/.test(chunk.name)) ||
    chunk.moduleIds.some((id) => REACT_SOURCES.test(id)))
    ? '"use client";'
    : "";

export default defineConfig([
  // npm entry points: ESM with .d.ts. `server.browser` is what
  // `@k-otp/sdk/server` resolves to under the "browser" export condition:
  // the same exports, whose functions throw (src/server/browser.ts), so the
  // sk_ client never ships to a browser by accident. It shares the core
  // chunks (ESM only: browsers do not `require`).
  {
    ...shared,
    entry: { ...entries, "server.browser": "src/server/browser.ts" },
    format: "esm",
    dts: { generator: "oxc" },
    outputOptions: { banner: reactClientBanner },
    // Shipped as-is: the Svelte component sources (+ their declarations and
    // the subpath index) and the optional default theme.
    copy: [
      {
        from: [
          "src/ui/svelte/*.svelte",
          "src/ui/svelte/*.svelte.d.ts",
          "src/ui/svelte/index.js",
          "src/ui/svelte/index.d.ts",
        ],
        to: "dist/ui-svelte",
      },
      { from: "src/ui/theme.css", to: "dist/ui" },
    ],
  },
  // CommonJS with .d.cts (every subpath except svelte).
  {
    ...shared,
    entry: cjsEntries,
    format: "cjs",
    dts: { generator: "oxc" },
    outputOptions: { banner: reactClientBanner },
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
    outExtensions: () => ({ js: ".min.js" }),
  },
]);
