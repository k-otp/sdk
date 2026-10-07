import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config, files, root, sha256 } from "../poc/kiota/scripts/common";
import {
  assessPreview,
  previewSourceHash,
} from "../poc/kiota/scripts/preview-evidence";
import { previewPackages } from "../poc/kiota/scripts/preview-package";
import catalog from "../sdks/packages.json";

const mode = process.argv[2];
const directory = path.resolve(process.argv[3] ?? ".cache/sdk-release");
async function run(argv: string[]) {
  const child = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`${argv[0]} failed: ${stderr || stdout}`);
  return stdout.trim();
}
async function ghJson(argv: string[]) {
  return JSON.parse(await run(["gh", ...argv]));
}
async function json(file: string, value: unknown) {
  await Bun.write(file, JSON.stringify(value, null, 2) + "\n");
}

export function validateReleaseRun(
  runInfo: Record<string, unknown>,
  commit: string,
  workflowId: number,
) {
  if (
    runInfo.head_sha !== commit ||
    runInfo.head_branch !== "main" ||
    runInfo.workflow_id !== workflowId ||
    !["push", "workflow_dispatch"].includes(String(runInfo.event)) ||
    runInfo.status !== "completed" ||
    runInfo.conclusion !== "success"
  )
    throw new Error(
      "Release requires a successful main-branch SDK run at the checked-out commit",
    );
}
export function releaseAssetName(target: string, relative: string) {
  if (
    relative.split(/[\\/]/).some((part) => part === "..") ||
    path.isAbsolute(relative)
  )
    throw new Error("Unsafe artifact path");
  const basename = path.basename(relative);
  if (target === "Go") {
    if (!basename.endsWith(".zip")) return null;
    return `kotp-sdk-go-${catalog.version}.zip`;
  }
  if (target === "PHP") return `kotp-sdk-php-${catalog.version}.zip`;
  return basename;
}

if (import.meta.main) {
  if (mode === "collect") {
    const artifactRoot = path.resolve(
      process.argv[4] ?? ".cache/kiota-poc/runs",
    );
    const runId = process.argv[5];
    if (!runId || !/^\d+$/.test(runId))
      throw new Error("A successful main SDK run ID is required");
    const commit = await run(["git", "rev-parse", "HEAD"]);
    const workflow = await ghJson([
      "api",
      "repos/k-otp/sdk/actions/workflows/kiota-poc.yml",
    ]);
    const runInfo = await ghJson([
      "api",
      `repos/k-otp/sdk/actions/runs/${runId}`,
    ]);
    validateReleaseRun(runInfo, commit, workflow.id);
    const specSha256 = sha256(
      await Bun.file(path.join(root, config.spec)).bytes(),
    );
    const fixtureSha256 = sha256(
      await Bun.file(
        path.join(root, "poc/kiota/fixtures/contract.json"),
      ).bytes(),
    );
    const context = {
      sourceCommit: commit,
      runId,
      runAttempt: String(runInfo.run_attempt),
      specSha256,
      fixtureSha256,
      actionCommit: config.actionCommit,
    };
    const index = {
      version: catalog.version,
      tag: `server-sdk-v${catalog.version}`,
      sourceCommit: commit,
      runId,
      runAttempt: context.runAttempt,
      specSha256,
      fixtureSha256,
      kiotaVersion: config.kiotaBuild,
      packages: [] as Array<Record<string, unknown>>,
      assets: {} as Record<string, string>,
    };
    await mkdir(directory, { recursive: true });
    for (const [target, coordinate] of Object.entries(previewPackages)) {
      const base = path.join(artifactRoot, `${target}-preview`);
      const row = await Bun.file(path.join(base, "reports/result.json")).json();
      const wire = await Bun.file(
        path.join(base, "reports/wire-cases.json"),
      ).json();
      const observations = await Bun.file(
        path.join(base, "reports/consumer-observations.json"),
      ).json();
      const assessment = assessPreview(
        row,
        wire,
        observations,
        context,
        await previewSourceHash(target),
      );
      if (!assessment.passed)
        throw new Error(`${target}: ${assessment.errors.join("; ")}`);
      const packaged = path.join(base, "packages");
      const actualFiles = (await files(packaged))
        .map((file) => path.relative(packaged, file))
        .sort();
      if (
        JSON.stringify(actualFiles) !==
        JSON.stringify(Object.keys(row.packageArtifacts).sort())
      )
        throw new Error(`${target}: artifact inventory differs`);
      const names: string[] = [];
      for (const relative of actualFiles) {
        const asset = releaseAssetName(target, relative);
        const source = path.join(packaged, relative);
        const digest = sha256(await Bun.file(source).bytes());
        if (digest !== row.packageArtifacts[relative])
          throw new Error(`${target}: artifact hash differs`);
        // Kotlin shares the Java package; both consumer proofs are required.
        if (!asset || target === "Kotlin") continue;
        if (index.assets[asset])
          throw new Error(`Duplicate release asset ${asset}`);
        await cp(source, path.join(directory, asset));
        index.assets[asset] = digest;
        names.push(asset);
      }
      await cp(
        path.join(base, "reports/result.json"),
        path.join(directory, `${target}-validation.json`),
      );
      index.packages.push({
        target,
        ...coordinate,
        sourceHash: row.previewPackage.sourceHash,
        wireCases: wire.cases.filter(
          (item: { status: string }) => item.status === "passed",
        ).length,
        artifacts: names,
      });
    }
    // Do not ship a differently built tarball under an already-published npm
    // version. The npm release must include this public subpath first.
    const npm = await fetch(
      `https://registry.npmjs.org/%40k-otp%2Fsdk/${previewPackages.TypeScript?.version}`,
    );
    if (!npm.ok)
      throw new Error(
        "Publish the npm SDK release before releasing the language packages",
      );
    const published = (await npm.json()) as {
      exports?: Record<string, unknown>;
    };
    if (!published.exports?.["./kiota"])
      throw new Error("The npm version has not published the Kiota subpath");
    await json(path.join(directory, "index.json"), index);
    const checksums =
      Object.entries(index.assets)
        .map(([name, hash]) => `${hash}  ${name}`)
        .join("\n") + "\n";
    await Bun.write(path.join(directory, "SHA256SUMS"), checksums);
    await Bun.write(
      path.join(directory, "release-notes.md"),
      `K-OTP server SDKs ${catalog.version}\n\nServer clients for all nine public API operations, with idempotency validation, preserved JSON error details, disabled automatic retries, and an explicit single issue retry after HTTP 503.\n\n${index.packages.map((item) => `- ${item.target}: ${item.package} ${item.version}`).join("\n")}\n\n[Installation and language guides](https://github.com/k-otp/sdk/tree/${index.tag}/sdks) · [Build and consumer validation](https://github.com/k-otp/sdk/actions/runs/${runId})\n\nEach SDK and the Kotlin/JVM consumer passed all 28 HTTP contracts. See index.json for package coordinates, source commit and artifact hashes. npm is published through the existing Trusted Publishing workflow; other registries require publisher account setup. Native packages are available as the attached release assets. Go is available at github.com/k-otp/sdk/sdks/go@v${catalog.version}.\n`,
    );
    console.log(
      `Validated ${index.packages.length} SDK consumers and ${Object.keys(index.assets).length} release assets at ${commit}`,
    );
  } else if (mode === "publish") {
    if (process.env.GITHUB_REF !== "refs/heads/main")
      throw new Error("Publishing runs only from the main workflow");
    const index = await Bun.file(path.join(directory, "index.json")).json();
    if (
      index.version !== catalog.version ||
      index.sourceCommit !== (await run(["git", "rev-parse", "HEAD"]))
    )
      throw new Error("Release index does not match the checked-out source");
    for (const [name, digest] of Object.entries(index.assets))
      if (sha256(await Bun.file(path.join(directory, name)).bytes()) !== digest)
        throw new Error(`Release asset ${name} changed`);
    // Go's module proxy reads a tagged source tree. Generate a snapshot at a
    // separate commit so the editable main branch keeps generation in .cache.
    const goDir = path.join(directory, "go-source");
    await run([
      "python3",
      path.join(root, "scripts/extract-go-module.py"),
      path.join(directory, `kotp-sdk-go-${catalog.version}.zip`),
      goDir,
      "github.com/k-otp/sdk/sdks/go",
      catalog.version,
    ]);
    const goTag = `sdks/go/v${catalog.version}`;
    const refs = await ghJson([
      "api",
      "repos/k-otp/sdk/git/matching-refs/tags/sdks/go/",
    ]);
    if (
      !refs.some((ref: { ref: string }) => ref.ref === `refs/tags/${goTag}`)
    ) {
      const baseCommit = await ghJson([
        "api",
        `repos/k-otp/sdk/git/commits/${index.sourceCommit}`,
      ]);
      const tree = [];
      for (const file of await files(goDir))
        tree.push({
          path: `sdks/go/${path.relative(goDir, file)}`,
          mode: "100644",
          type: "blob",
          content: await readFile(file, "utf8"),
        });
      const treeFile = path.join(directory, "go-tree.json");
      await json(treeFile, { base_tree: baseCommit.tree.sha, tree });
      const createdTree = await ghJson([
        "api",
        "--method",
        "POST",
        "repos/k-otp/sdk/git/trees",
        "--input",
        treeFile,
      ]);
      const commitFile = path.join(directory, "go-commit.json");
      await json(commitFile, {
        message: `release: Go SDK ${catalog.version} from ${index.sourceCommit}`,
        tree: createdTree.sha,
        parents: [index.sourceCommit],
      });
      const createdCommit = await ghJson([
        "api",
        "--method",
        "POST",
        "repos/k-otp/sdk/git/commits",
        "--input",
        commitFile,
      ]);
      const refFile = path.join(directory, "go-ref.json");
      await json(refFile, {
        ref: `refs/tags/${goTag}`,
        sha: createdCommit.sha,
      });
      await ghJson([
        "api",
        "--method",
        "POST",
        "repos/k-otp/sdk/git/refs",
        "--input",
        refFile,
      ]);
    }
    const goRef = await ghJson([
      "api",
      `repos/k-otp/sdk/git/ref/tags/${goTag}`,
    ]);
    if (goRef.object.type !== "commit")
      throw new Error("Unexpected Go release tag type");
    const goCommit = await ghJson([
      "api",
      `repos/k-otp/sdk/git/commits/${goRef.object.sha}`,
    ]);
    const goTree = await ghJson([
      "api",
      `repos/k-otp/sdk/git/trees/${goCommit.tree.sha}?recursive=1`,
    ]);
    const expectedGo: Record<string, string> = {};
    for (const file of await files(goDir)) {
      const bytes = await Bun.file(file).bytes();
      expectedGo[`sdks/go/${path.relative(goDir, file)}`] =
        new Bun.CryptoHasher("sha1")
          .update(`blob ${bytes.byteLength}\0`)
          .update(bytes)
          .digest("hex");
    }
    const actualGo = goTree.tree.filter(
      (item: { path: string; type: string }) =>
        item.type === "blob" && item.path.startsWith("sdks/go/"),
    );
    if (
      goTree.truncated ||
      actualGo.length !== Object.keys(expectedGo).length ||
      actualGo.some(
        (item: { path: string; sha: string }) =>
          expectedGo[item.path] !== item.sha,
      )
    )
      throw new Error(
        "The Go release tag differs from the verified module artifact",
      );
    index.goTag = goTag;
    index.goTagCommit = goRef.object.sha;
    await json(path.join(directory, "index.json"), index);
    const releases = await ghJson(["api", "repos/k-otp/sdk/releases"]);
    const existing = releases.find(
      (release: { tag_name: string }) => release.tag_name === index.tag,
    );
    if (existing && !existing.draft)
      throw new Error(
        "This release is already published; do not replace its assets",
      );
    if (existing && existing.target_commitish !== index.sourceCommit)
      throw new Error(
        "An existing release draft points at another source commit",
      );
    if (!existing)
      await run([
        "gh",
        "release",
        "create",
        index.tag,
        "--target",
        index.sourceCommit,
        "--draft",
        "--title",
        `K-OTP server SDKs ${index.version}`,
        "--notes-file",
        path.join(directory, "release-notes.md"),
      ]);
    const assets = [
      ...Object.keys(index.assets),
      "index.json",
      "SHA256SUMS",
      ...Object.keys(previewPackages).map(
        (target) => `${target}-validation.json`,
      ),
    ];
    await run([
      "gh",
      "release",
      "upload",
      index.tag,
      ...assets.map((name) => path.join(directory, name)),
      "--clobber",
    ]);
    await run([
      "gh",
      "release",
      "edit",
      index.tag,
      "--draft=false",
      "--latest=false",
    ]);
    console.log(
      `Published https://github.com/k-otp/sdk/releases/tag/${index.tag}`,
    );
  } else
    throw new Error(
      "Usage: release-sdks.ts collect <out> <artifact-root> <SDK-run-id> | publish <out>",
    );
}
