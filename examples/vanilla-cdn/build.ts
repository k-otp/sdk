/** Copies index.html and the CDN bundle into dist/ (a deployable static site). */
import { copyFile, mkdir } from "node:fs/promises";
import { bundlePath } from "./bundle.ts";

const out = new URL("./dist/", import.meta.url);
await mkdir(out, { recursive: true });
await copyFile(
  new URL("./index.html", import.meta.url),
  new URL("index.html", out),
);
await copyFile(bundlePath(), new URL("k-otp.iife.min.js", out));
console.log(`built ${out.pathname}`);
