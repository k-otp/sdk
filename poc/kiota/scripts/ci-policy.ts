import { isDeepStrictEqual } from "node:util";
import baselineJson from "../fixtures/known-baseline-gaps.json";
import { fixture } from "../mock/contract";
import { config, type Stage, type StageResult } from "./common";

export type ResultRow = Record<Stage, StageResult> & {
  target: string;
  inputVariant: string;
  kiotaVersion?: string | null;
  specSha256?: string;
  fixtureSha256?: string;
};
type Signature = {
  failures: string[];
  received: number;
  exception: string | null;
  outcome: string | null;
  diagnostic: string | null;
};
type Gap = {
  reason: string;
  cases?: Record<string, Signature>;
  examples?: unknown[];
};
export type Baseline = {
  metadata: { kiotaVersion: string; specSha256: string; fixtureSha256: string };
  targets: Record<string, Gap>;
};
export const baseline: Baseline = baselineJson;
export type WireEvidence = {
  runnerExitCode: number;
  unexpectedRequests: string[];
  cases: {
    id: string;
    kind?: string;
    status: string;
    failures: string[];
    received: number;
    observationCaptured?: boolean;
    observation?: { exception?: string; outcome?: string; diagnostic?: string };
  }[];
};

// CI success means the candidate contracts passed and baseline regressions were
// reproduced precisely. A failed SDK compatibility stage never becomes passed.
export function assess(
  row: ResultRow,
  wire: WireEvidence | null,
  examples: unknown[] | null,
  known: Baseline = baseline,
) {
  const errors: string[] = [];
  const key = `${row.target}/${row.inputVariant}`;
  const target = config.targets.find((item) => item.target === row.target);
  const comparison = row.target === "ExistingTypeScript";
  const unsupported = row.target === "Swift";
  const http = row.target === "HTTP";
  const gap = known.targets[key];
  if (!target && !comparison) errors.push("unknown target");
  if (!["raw", "overlay"].includes(row.inputVariant))
    errors.push("unknown variant");
  if (gap && target?.required && row.inputVariant === "overlay")
    errors.push("a required overlay cannot allow known compatibility failures");
  if (row.specSha256 !== known.metadata.specSha256)
    errors.push("baseline spec hash changed");
  if (row.fixtureSha256 !== known.metadata.fixtureSha256)
    errors.push("baseline fixture hash changed");
  if (!comparison && row.kiotaVersion !== known.metadata.kiotaVersion)
    errors.push("baseline Kiota build changed");

  const wireStatus = unsupported ? "not_applicable" : gap ? "failed" : "passed";
  const expected: Record<Stage, string> = {
    generation: unsupported
      ? "unsupported"
      : comparison
        ? "not_applicable"
        : "passed",
    buildOrLoad: unsupported || http ? "not_applicable" : "passed",
    wireContract: wireStatus,
    kotlinInterop: row.target === "Kotlin" ? wireStatus : "not_applicable",
    packageConsumer:
      unsupported || http || comparison ? "not_applicable" : "passed",
    reproducibility: unsupported || comparison ? "not_applicable" : "passed",
  };
  for (const stage of config.stages as Stage[]) {
    if (row[stage]?.status !== expected[stage])
      errors.push(
        `${stage}: expected ${expected[stage]}, got ${row[stage]?.status ?? "missing"}`,
      );
  }

  if (http) {
    if (
      !examples ||
      !gap?.examples ||
      !isDeepStrictEqual(examples, gap.examples)
    )
      errors.push("HTTP example diagnostics or operation inventory changed");
  } else if (!unsupported) {
    if (!wire) errors.push("missing wire evidence");
    else {
      if (wire.runnerExitCode !== 0)
        errors.push("consumer crashed or did not finish");
      if (wire.unexpectedRequests.length)
        errors.push("unexpected HTTP requests");
      const ids = wire.cases.map((item) => item.id);
      if (
        ids.length !== fixture.cases.length ||
        new Set(ids).size !== ids.length ||
        fixture.cases.some((item) => !ids.includes(item.id))
      )
        errors.push("missing, duplicate or unrecognized contract cases");
      for (const test of fixture.cases) {
        const actual = wire.cases.find((item) => item.id === test.id);
        if (!actual) continue;
        if (test.defaultRetryProbe) {
          if (
            actual.kind !== "retry-observation" ||
            !actual.observationCaptured ||
            actual.received < 1
          )
            errors.push("default retry observation was not captured");
          continue;
        }
        const allowed = gap?.cases?.[test.id];
        if (actual.status !== (allowed ? "failed" : "passed"))
          errors.push(
            `${test.id}: unexpected compatibility result; review the baseline or fix the regression`,
          );
        if (allowed) {
          const observation = actual.observation;
          const signature: Signature = {
            failures: [...actual.failures].sort(),
            received: actual.received,
            exception: observation?.exception ?? null,
            outcome: observation?.outcome ?? null,
            diagnostic: observation?.diagnostic ?? null,
          };
          if (!isDeepStrictEqual(signature, allowed))
            errors.push(`${test.id}: known failure changed`);
        } else if (
          actual.failures.length ||
          actual.received !== test.requestCount
        )
          errors.push(`${test.id}: new failure or changed request count`);
      }
      for (const id of Object.keys(gap?.cases ?? {})) {
        if (!fixture.cases.some((item) => item.id === id))
          errors.push(`baseline has an unknown case ${id}`);
      }
    }
  }
  return {
    mode: unsupported
      ? "unsupported-discovery"
      : gap
        ? "baseline-regression"
        : "candidate-contract",
    compatibilityPassed: row.wireContract.status === "passed",
    validationPassed: errors.length === 0,
    expectedGap: gap?.reason ?? null,
    errors,
  };
}
