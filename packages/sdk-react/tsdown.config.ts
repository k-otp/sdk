import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  dts: { generator: "oxc" },
  // Hooks and context only work in client components (Next.js App Router).
  banner: { js: '"use client";' },
  // sdk-core is a lockstep runtime dependency and React a peer: never inline.
  deps: { neverBundle: [/^@k-otp\/sdk-core/, /^react($|\/)/] },
});
