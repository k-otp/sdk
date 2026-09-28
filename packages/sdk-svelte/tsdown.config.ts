import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  // Svelte itself is ESM-only, so the adapter is too.
  format: ["esm"],
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  dts: { generator: "oxc" },
  // sdk-core is a lockstep runtime dependency and Svelte a peer: never inline.
  deps: { neverBundle: [/^@k-otp\/sdk-core/, /^svelte($|\/)/] },
});
