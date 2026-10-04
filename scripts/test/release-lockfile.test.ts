/**
 * `scripts/release-lockfile.sh` against a throwaway git remote holding a
 * dependency-free workspace, where the release branch's bun.lock drifted the
 * way Sampo's `bun update --lockfile-only` drifted it for 1.1.0 (catalog
 * entry rewritten, frozen install rejected). Bun resolves nothing from a
 * registry here (the catalog entry is unused), so the test runs offline.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "..", "release-lockfile.sh");
const RELEASE_BRANCH = "sampo/release";

const root = mkdtempSync(path.join(tmpdir(), "release-lockfile-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const origin = path.join(root, "origin.git");
const seed = path.join(root, "seed");
const work = path.join(root, "work");
writeFileSync(path.join(root, "gitconfig"), "");

const env = {
  ...process.env,
  // Ignore the developer's git config (signing, hooks, default branch).
  GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // Fail instead of reaching a registry.
  BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/",
  TMPDIR: root,
  RUNNER_TEMP: "",
};

function run(cmd: string[], cwd: string) {
  const result = Bun.spawnSync(cmd, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

function ok(cmd: string[], cwd: string): string {
  const result = run(cmd, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${result.output}`);
  }
  return result.output.trim();
}

const show = (ref: string) => ok(["git", "show", `${ref}:bun.lock`], origin);
const frozen = (cwd: string) =>
  run(["bun", "install", "--frozen-lockfile", "--lockfile-only"], cwd);

function writeWorkspace(dir: string, version: string) {
  mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "ws",
      private: true,
      workspaces: {
        packages: ["packages/*"],
        catalog: { "left-pad": "^1.3.0" },
      },
    }),
  );
  writeFileSync(
    path.join(dir, "packages", "a", "package.json"),
    JSON.stringify({ name: "a", version }),
  );
}

// main: version 1.0.0 with a matching lockfile.
ok(["git", "init", "--quiet", "--bare", "-b", "main", origin], root);
ok(["git", "init", "--quiet", "-b", "main", seed], root);
writeWorkspace(seed, "1.0.0");
ok(["bun", "install", "--lockfile-only"], seed);
ok(["git", "add", "."], seed);
ok(["git", "commit", "--quiet", "-m", "main"], seed);
ok(["git", "remote", "add", "origin", origin], seed);
ok(["git", "push", "--quiet", "origin", "main"], seed);
const mainLock = show("main");

// Release branch: Sampo's version bump plus a drifted catalog entry.
ok(["git", "switch", "--quiet", "-c", RELEASE_BRANCH], seed);
writeWorkspace(seed, "1.1.0");
const driftedLock = mainLock
  .replace('"version": "1.0.0"', '"version": "1.1.0"')
  .replace('"left-pad": "^1.3.0"', '"left-pad": "^1.3.1"');
expect(driftedLock).not.toBe(mainLock);
writeFileSync(path.join(seed, "bun.lock"), `${driftedLock}\n`);
ok(["git", "commit", "--quiet", "-am", "chore(release): bump"], seed);
ok(["git", "push", "--quiet", "origin", RELEASE_BRANCH], seed);
const releaseHead = ok(["git", "rev-parse", RELEASE_BRANCH], origin);

ok(["git", "clone", "--quiet", origin, work], root);

describe("release-lockfile.sh", () => {
  test("the drifted release lockfile fails the frozen install", () => {
    const result = frozen(seed);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("catalog");
  });

  test("rebuilds the release lockfile from main's with only the bump", () => {
    const result = run([SCRIPT], work);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain(
      `Pushed the rebuilt bun.lock to ${RELEASE_BRANCH}`,
    );

    expect(ok(["git", "rev-parse", `${RELEASE_BRANCH}~1`], origin)).toBe(
      releaseHead,
    );
    expect(
      ok(
        ["git", "log", "-1", "--format=%an <%ae>%n%s", RELEASE_BRANCH],
        origin,
      ),
    ).toBe(
      "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>\n" +
        "chore(release): keep only the version bumps in bun.lock",
    );
    expect(show(RELEASE_BRANCH)).toBe(
      mainLock.replace('"version": "1.0.0"', '"version": "1.1.0"'),
    );

    ok(["git", "fetch", "--quiet", "origin"], seed);
    ok(["git", "reset", "--quiet", "--hard", `origin/${RELEASE_BRANCH}`], seed);
    expect(frozen(seed).exitCode).toBe(0);
  });

  test("leaves the caller's checkout on main, clean, without worktrees", () => {
    expect(ok(["git", "branch", "--show-current"], work)).toBe("main");
    expect(ok(["git", "status", "--porcelain"], work)).toBe("");
    expect(
      ok(["git", "worktree", "list", "--porcelain"], work).split("\n\n"),
    ).toHaveLength(1);
  });

  test("does nothing when the lockfile already records only the bumps", () => {
    const before = ok(["git", "rev-parse", RELEASE_BRANCH], origin);
    const result = run([SCRIPT], work);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("already records only the version bumps");
    expect(ok(["git", "rev-parse", RELEASE_BRANCH], origin)).toBe(before);
  });

  test("does nothing without a release branch", () => {
    const result = run([SCRIPT, "no/such-branch"], work);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("No no/such-branch branch on origin");
  });
});
