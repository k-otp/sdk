import path from "node:path";
import { fixture } from "../mock/contract";
import { assess, type ResultRow, type WireEvidence } from "./ci-policy";
import { config, files, root, sha256 } from "./common";
import { type EvidenceContext, identityIssues } from "./evidence";
import { previewPackages, previewRoot } from "./preview-package";

export async function previewSourceHash(target: string) {
  const language = config.targets.find(
    (item) => item.target === target,
  )?.harness;
  if (!language) throw new Error("Unknown preview target");
  const directory = path.join(
    previewRoot,
    language === "kotlin-consumer" ? "java" : language,
  );
  const manifest: Record<string, string> = {};
  for (const file of await files(directory))
    manifest[path.relative(previewRoot, file)] = sha256(
      await Bun.file(file).bytes(),
    );
  if (target === "Kotlin")
    for (const file of await files(path.join(previewRoot, "kotlin")))
      manifest[path.relative(previewRoot, file)] = sha256(
        await Bun.file(file).bytes(),
      );
  for (const file of await files(
    path.join(
      root,
      "poc/kiota/consumers",
      language === "kotlin-consumer" ? "kotlin" : language,
    ),
  ))
    manifest[path.relative(root, file)] = sha256(await Bun.file(file).bytes());
  manifest["packages.json"] = sha256(
    await Bun.file(path.join(previewRoot, "packages.json")).bytes(),
  );
  manifest["harness.ts"] = sha256(
    await Bun.file(path.join(root, "poc/kiota/scripts/harness.ts")).bytes(),
  );
  manifest["preview-package.ts"] = sha256(
    await Bun.file(
      path.join(root, "poc/kiota/scripts/preview-package.ts"),
    ).bytes(),
  );
  return sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
}

type PreviewRow = ResultRow &
  Record<string, unknown> & {
    previewPackage?: {
      version?: string;
      entry?: string;
      channel?: string;
      profile?: string;
      sourceHash?: string;
    };
    packageArtifacts?: Record<string, string>;
  };
type PublicErrorObservation = {
  id: string;
  requestId?: string;
  retryAfterMs?: number;
};
export function assessPreview(
  row: PreviewRow,
  wire: WireEvidence | null,
  observations: PublicErrorObservation[],
  context: EvidenceContext,
  sourceHash: string,
) {
  const errors = [
    ...identityIssues(row, context, row.target, "overlay"),
    ...assess(row, wire, null).errors,
  ];
  const expected = previewPackages[row.target];
  if (!expected) errors.push("Unknown preview package");
  for (const [key, value] of Object.entries({
    ...expected,
    channel: "release",
    profile: "preview",
    sourceHash,
  }))
    if (
      row.previewPackage?.[
        key as keyof NonNullable<PreviewRow["previewPackage"]>
      ] !== value
    )
      errors.push(`Preview package ${key} differs`);
  if (!row.packageArtifacts || !Object.keys(row.packageArtifacts).length)
    errors.push("No packaged artifact recorded");
  for (const item of fixture.cases.filter(
    (item) => !item.defaultRetryProbe && item.response.status >= 400,
  )) {
    const observation = observations.find((value) => value.id === item.id);
    if (!observation) {
      errors.push(`${item.id}: missing public error observation`);
      continue;
    }
    const requestId = item.response.headers["X-Request-Id"];
    if (observation.requestId !== requestId)
      errors.push(`${item.id}: public requestId differs`);
    const data = (item.response.body as { data?: { retryAfterMs?: number } })
      .data;
    const seconds = item.response.headers["Retry-After"];
    const retryAfterMs =
      typeof data?.retryAfterMs === "number"
        ? data.retryAfterMs
        : seconds !== undefined
          ? Number(seconds) * 1000
          : null;
    if ((observation.retryAfterMs ?? null) !== retryAfterMs)
      errors.push(`${item.id}: public retryAfterMs differs`);
  }
  return { passed: errors.length === 0, errors };
}
