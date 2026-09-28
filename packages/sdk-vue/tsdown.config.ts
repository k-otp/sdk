import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  dts: { generator: "oxc" },
  // sdk-core is a lockstep runtime dependency and Vue a peer: never inline.
  deps: { neverBundle: [/^@k-otp\/sdk-core/, /^vue($|\/)/] },
});
