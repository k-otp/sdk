import type { ITtscLintConfig } from "@ttsc/lint";

// Type-aware rules only. Style/format is owned by Biome (`bun run lint`).
export default {
  ignores: ["**/dist/**", "**/node_modules/**", "**/src/**/generated/**"],
  rules: {
    "typescript/await-thenable": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-for-in-array": "error",
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
  },
} satisfies ITtscLintConfig;
