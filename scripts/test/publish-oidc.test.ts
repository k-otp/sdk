/**
 * Release recovery decisions of `scripts/publish-oidc.sh`, run against a
 * throwaway copy of the script with stubbed `curl`, `git` and `gh` on PATH
 * (the real `node` parses the manifests). Nothing touches npm or GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "1.2.3";
const PACKAGE = "@k-otp/sdk";
const ALL_TAGS = [`v${VERSION}`];

const root = mkdtempSync(path.join(tmpdir(), "publish-oidc-"));
const bin = path.join(root, "bin");
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(path.join(root, "scripts"), { recursive: true });
writeFileSync(
  path.join(root, "scripts", "publish-oidc.sh"),
  await Bun.file(path.join(import.meta.dir, "..", "publish-oidc.sh")).text(),
);
const packageDir = path.join(root, "packages", "sdk");
mkdirSync(packageDir, { recursive: true });
writeFileSync(
  path.join(packageDir, "package.json"),
  JSON.stringify({ name: PACKAGE, version: VERSION }),
);

const stub = (name: string, body: string) => {
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, name);
  writeFileSync(
    file,
    `#!/usr/bin/env bash\necho "${name} $*" >>"$STUB_LOG"\n${body}\n`,
  );
  chmodSync(file, 0o755);
};

// `$STUB_COUNT <name>` bumps and prints a per-command call counter.
const counter = `count() { local f="$STUB_LOG.$1"; local n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$f"; echo "$n"; }`;
const has = `has() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }`;

stub(
  "curl",
  `if [[ "\${STUB_NPM_PUBLISHED:-1}" == 1 ]]; then
  printf '{"versions":{"${VERSION}":{}}}\\n200'
else
  printf '{}\\n404'
fi`,
);
stub(
  "git",
  `${counter}
${has}
[[ "$1" == "-C" ]] && shift 2
case "$1" in
  ls-remote)
    [[ "$(count ls-remote)" -le "\${STUB_LS_REMOTE_FAILS:-0}" ]] && exit 128
    tag="\${@: -1}"; tag="\${tag#refs/tags/}"
    has "$STUB_REMOTE_TAGS" "$tag" && exit 0
    exit 2 ;;
  rev-parse)
    tag="\${@: -1}"; tag="\${tag#refs/tags/}"
    has "$STUB_LOCAL_TAGS" "$tag" && exit 0
    exit 1 ;;
  push|tag) exit 0 ;;
  log) echo "deadbeef" ;;
  *) exit 1 ;;
esac`,
);
stub(
  "gh",
  `${counter}
if [[ "$1" == "api" ]]; then
  status="\${STUB_GH_STATUS:-200}"
  [[ "$(count gh-api)" -le "\${STUB_GH_FAILS:-0}" ]] && status=502
  echo "HTTP/2.0 $status X"
  [[ "$status" == 200 ]]
fi`,
);

// Only the publish path below uses these: `bun pm pack` writes a tarball into
// --destination and prints its path; `npm publish` answers per STUB_NPM_PUBLISH.
stub(
  "bun",
  `if [[ "$1" == "pm" && "$2" == "pack" ]]; then
  dest="$4"; file="$dest/k-otp-sdk-${VERSION}.tgz"; : >"$file"; echo "$file"
fi
exit 0`,
);
stub(
  "npm",
  `case "\${STUB_NPM_PUBLISH:-ok}" in
  conflict)
    echo "npm error code E409" >&2
    echo 'npm error 409 Conflict - PUT https://registry.npmjs.org/@k-otp%2fsdk - Cannot publish over previously staged version "${VERSION}".' >&2
    exit 1 ;;
  fail)
    echo "npm error code E500" >&2
    exit 1 ;;
esac
exit 0`,
);

type Env = Record<string, string>;

const run = (args: string[], env: Env = {}) => {
  const log = path.join(root, `log-${crypto.randomUUID()}`);
  writeFileSync(log, "");
  const result = Bun.spawnSync(
    ["bash", path.join(root, "scripts", "publish-oidc.sh"), ...args],
    {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        RUNNER_TEMP: root,
        GH_TOKEN: "stub",
        PUBLISH_OIDC_RETRY_DELAY: "0",
        STUB_LOG: log,
        STUB_REMOTE_TAGS: ALL_TAGS.join(" "),
        STUB_LOCAL_TAGS: ALL_TAGS.join(" "),
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = result.stdout.toString();
  const calls = readFileSync(log, "utf8");
  return {
    exitCode: result.exitCode,
    stdout,
    calls: calls.split("\n").filter(Boolean),
    output: (key: string) =>
      stdout.match(new RegExp(`^${key}=(\\w+)$`, "m"))?.[1],
  };
};

describe("publish-oidc.sh --check", () => {
  test("a finished release needs nothing", () => {
    const r = run(["--check"]);
    expect(r.exitCode).toBe(0);
    expect(r.output("should_publish")).toBe("false");
    expect(r.output("needs_finalize")).toBe("false");
  });

  test("an unpublished version publishes without looking at tags", () => {
    const r = run(["--check"], { STUB_NPM_PUBLISHED: "0" });
    expect(r.output("should_publish")).toBe("true");
    expect(r.output("needs_finalize")).toBe("false");
    expect(r.calls.some((c) => c.includes("ls-remote"))).toBe(false);
  });

  test("a missing release tag needs finalizing", () => {
    const r = run(["--check"], { STUB_REMOTE_TAGS: "" });
    expect(r.exitCode).toBe(0);
    expect(r.output("needs_finalize")).toBe("true");
    expect(r.stdout).toContain(`v${VERSION} is published`);
  });

  test("a second publishable package must be listed in PACKAGE_DIRS", () => {
    const extra = path.join(root, "packages", "extra");
    mkdirSync(extra, { recursive: true });
    writeFileSync(
      path.join(extra, "package.json"),
      JSON.stringify({ name: "@k-otp/extra", version: VERSION }),
    );
    try {
      const r = run(["--check"]);
      expect(r.exitCode).toBe(1);
    } finally {
      rmSync(extra, { recursive: true, force: true });
    }
  });

  test("a missing GitHub Release (HTTP 404) needs finalizing", () => {
    const r = run(["--check"], { STUB_GH_STATUS: "404" });
    expect(r.output("needs_finalize")).toBe("true");
  });

  test("transient lookup failures are retried", () => {
    const r = run(["--check"], {
      STUB_LS_REMOTE_FAILS: "2",
      STUB_GH_FAILS: "2",
      STUB_GH_STATUS: "404",
    });
    expect(r.exitCode).toBe(0);
    expect(r.output("needs_finalize")).toBe("true");
  });

  test("a tag lookup that keeps failing warns and does not finalize", () => {
    const r = run(["--check"], { STUB_LS_REMOTE_FAILS: "99" });
    expect(r.exitCode).toBe(0);
    expect(r.output("should_publish")).toBe("false");
    expect(r.output("needs_finalize")).toBe("false");
    expect(r.stdout).toContain("::warning::Could not look up tag");
    expect(r.calls.filter((c) => c.includes("ls-remote"))).toHaveLength(3);
  });

  test("a Release lookup that keeps failing warns and does not finalize", () => {
    const r = run(["--check"], { STUB_GH_FAILS: "99" });
    expect(r.exitCode).toBe(0);
    expect(r.output("needs_finalize")).toBe("false");
    expect(r.stdout).toContain("::warning::Could not look up the v1.2.3");
    expect(r.calls.filter((c) => c.startsWith("gh api"))).toHaveLength(3);
  });
});

describe("publish-oidc.sh recovery", () => {
  test("only the GitHub Release missing: no commit lookup, Release created", () => {
    const r = run([], { STUB_GH_STATUS: "404" });
    expect(r.exitCode).toBe(0);
    expect(r.calls.some((c) => / (log|cat-file) /.test(c))).toBe(false);
    expect(r.calls.some((c) => c.startsWith("git tag"))).toBe(false);
    expect(r.calls).toContain(`gh release create v${VERSION} --generate-notes`);
  });

  test("recovery creates and pushes only the vX.Y.Z tag", () => {
    const r = run([], { STUB_LOCAL_TAGS: "" });
    expect(r.exitCode).toBe(0);
    const tags = r.calls.filter((c) => / tag /.test(c));
    expect(tags).toEqual([`git -C ${root} tag v${VERSION} deadbeef`]);
    expect(r.calls).toContain(
      `git -C ${root} push origin refs/tags/v${VERSION}`,
    );
  });

  test("an existing Release is not recreated", () => {
    const r = run([]);
    expect(r.exitCode).toBe(0);
    expect(r.calls.some((c) => c.startsWith("gh release create"))).toBe(false);
  });
});

describe("publish-oidc.sh publish", () => {
  test("publishes an unpublished version", () => {
    const r = run([], { STUB_NPM_PUBLISHED: "0" });
    expect(r.exitCode).toBe(0);
    expect(r.calls.some((c) => c.startsWith("npm publish"))).toBe(true);
  });

  test("a version npm already accepted (409, still in review) is not a failure", () => {
    const r = run([], {
      STUB_NPM_PUBLISHED: "0",
      STUB_NPM_PUBLISH: "conflict",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("already submitted to npm");
  });

  test("any other publish error fails the run", () => {
    const r = run([], { STUB_NPM_PUBLISHED: "0", STUB_NPM_PUBLISH: "fail" });
    expect(r.exitCode).not.toBe(0);
  });
});
