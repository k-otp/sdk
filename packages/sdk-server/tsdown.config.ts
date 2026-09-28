import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  dts: { generator: "oxc" },
  // @k-otp/sdk-core is a runtime dependency (lockstep version), never inlined.
  deps: { neverBundle: [/^@k-otp\/sdk-core/] },
});
