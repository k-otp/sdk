import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import config from "../targets.json";

export { config };
export const root = path.resolve(import.meta.dir, "../../..");
export const outputRoot = path.resolve(
  root,
  process.env.POC_OUTPUT ?? ".cache/kiota-poc/runs",
);
export const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export type Status =
  | "passed"
  | "failed"
  | "blocked"
  | "unsupported"
  | "not_run"
  | "not_applicable";
export type Stage =
  | "generation"
  | "buildOrLoad"
  | "wireContract"
  | "kotlinInterop"
  | "packageConsumer"
  | "reproducibility";
export type Target = (typeof config.targets)[number];
export const stage = (status: Status, detail = "") => ({ status, detail });
export type StageResult = ReturnType<typeof stage>;

export function redact(value: string): string {
  return value
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/sk_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/("(?:code|phoneNumber)"\s*:\s*")[0-9+ -]+"/g, '$1[REDACTED]"');
}

export async function json(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`);
}

export async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(location)));
    else if (entry.isFile()) result.push(location);
  }
  return result.sort();
}

export async function command(
  argv: string[],
  log: string,
  cwd = root,
  env: Record<string, string> = {},
  timeoutMs = 600_000,
) {
  await mkdir(path.dirname(log), { recursive: true });
  let output: string;
  let exitCode: number;
  try {
    const proc = Bun.spawn(argv, {
      cwd,
      env: {
        ...process.env,
        KIOTA_OFFLINE_ENABLED: "true",
        KIOTA_CLI_TELEMETRY_OPTOUT: "true",
        KIOTA_TUTORIAL_ENABLED: "false",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    output = redact(`${stdout}${stderr}`);
    exitCode = code;
  } catch (error) {
    output = redact(String(error));
    exitCode = 127;
  }
  await Bun.write(log, `${JSON.stringify(argv)}\n${output}`);
  return { exitCode, output, log };
}

export async function codeManifest(directory: string, extension: string) {
  const entries = (await files(directory)).filter((f) => f.endsWith(extension));
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (file) => [
        path.relative(directory, file).split(path.sep).join("/"),
        sha256(await Bun.file(file).bytes()),
      ]),
    ),
  );
}
