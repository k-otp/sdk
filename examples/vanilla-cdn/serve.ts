/** Serves index.html and the local k-otp.iife.min.js on http://localhost:5173. */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { bundlePath } from "./bundle.ts";

const port = Number(process.env.PORT ?? 5173);
const files: Record<string, [() => string, string]> = {
  "/": [
    () => new URL("./index.html", import.meta.url).pathname,
    "text/html; charset=utf-8",
  ],
  "/k-otp.iife.min.js": [bundlePath, "text/javascript; charset=utf-8"],
};

createServer(async (req, res) => {
  const entry = files[new URL(req.url ?? "/", "http://localhost").pathname];
  if (!entry) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(entry[0]());
    res.writeHead(200, { "content-type": entry[1] }).end(body);
  } catch {
    res
      .writeHead(500)
      .end("Build the SDK first: bun run build (repository root)");
  }
}).listen(port, () => {
  // The page origin must be listed exactly in the pk_ key's allowedOrigins.
  console.log(`http://localhost:${port}`);
});
