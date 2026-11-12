import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const work = path.join(root, ".cache/workerd-smoke");
await mkdir(work, { recursive: true });
const fixture = path.join(root, "scripts/fixtures/workerd");
const build = await Bun.build({
  entrypoints: [path.join(fixture, "worker.mjs")],
  outdir: work,
  naming: "worker.mjs",
  target: "browser",
  conditions: ["workerd"],
  external: ["node:*", "cloudflare:*"],
});
if (!build.success)
  throw new AggregateError(build.logs, "workerd smoke bundle failed");
for (const name of ["config.capnp", "mock-api.mjs"])
  await cp(path.join(fixture, name), path.join(work, name));
const child = Bun.spawn(
  [path.join(root, "node_modules/.bin/workerd"), "test", "config.capnp"],
  {
    cwd: work,
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
