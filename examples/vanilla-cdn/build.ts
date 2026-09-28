/** Copies index.html and the CDN bundle into dist/ (a deployable static site). */
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundlePath } from "./bundle.ts";

const out = new URL("./dist/", import.meta.url);
await mkdir(out, { recursive: true });
await copyFile(
  new URL("./index.html", import.meta.url),
  new URL("index.html", out),
);
try {
  await copyFile(bundlePath(), new URL("k-otp.iife.min.js", out));
} catch {
  console.error("Build the SDK first: bun run build (repository root)");
  process.exit(1);
}
console.log(`built ${fileURLToPath(out)}`);
