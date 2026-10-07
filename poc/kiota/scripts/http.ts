import path from "node:path";
import { files, json } from "./common";

const out = process.env.POC_TARGET_DIR;
if (!out) throw new Error("POC_TARGET_DIR required");
const checks = [];
for (const file of (await files(path.join(out, "generated"))).filter((f) =>
  f.endsWith(".http"),
)) {
  const text = await Bun.file(file).text();
  const operation = /^(GET|POST)\s+(\S+)\s+HTTP\/1\.1$/m.exec(text);
  const failures: string[] = [];
  if (!operation) failures.push("missing HTTP method/path");
  if (!/^Authorization:\s*\{\{bearerAuth\}\}$/m.test(text))
    failures.push("missing credential placeholder");
  if (operation?.[1] === "POST") {
    const body = text
      .slice(text.indexOf("\n\n{", text.indexOf(operation[0])) + 2)
      .split("\n###")[0]
      ?.trim();
    try {
      const value = JSON.parse(body ?? "");
      if (operation[2]?.includes("/issue") && !value.idempotencyKey)
        failures.push("missing body idempotency key");
      if (operation[2]?.includes("/verify") && typeof value.code !== "string")
        failures.push("OTP sample must be a string");
    } catch {
      failures.push(
        "example request body is not valid JSON (generation is preserved verbatim)",
      );
    }
  }
  checks.push({
    file: path.relative(out, file),
    operation: operation?.slice(1),
    status: failures.length ? "failed" : "passed",
    failures,
  });
}
await json(path.join(out, "reports/http-examples.json"), checks);
console.log(
  `${checks.length} request examples; ${checks.filter((c) => c.status === "failed").length} failed inspections`,
);
process.exitCode =
  checks.length === 9 && checks.every((c) => c.status === "passed") ? 0 : 1;
