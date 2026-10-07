import { expect, test } from "bun:test";
import { fixture } from "../mock/contract";
import {
  assess,
  baseline,
  type ResultRow,
  type WireEvidence,
} from "./ci-policy";
import { stage } from "./common";

function evidence(target: string, variant: string) {
  const gap = baseline.targets[`${target}/${variant}`];
  const failed = Boolean(gap);
  const row: ResultRow = {
    target,
    inputVariant: variant,
    ...baseline.metadata,
    generation: stage("passed"),
    buildOrLoad: stage("passed"),
    wireContract: stage(failed ? "failed" : "passed"),
    kotlinInterop: stage("not_applicable"),
    packageConsumer: stage("passed"),
    reproducibility: stage("passed"),
  };
  const wire: WireEvidence = {
    runnerExitCode: 0,
    unexpectedRequests: [],
    cases: fixture.cases.map((item) => {
      if (item.defaultRetryProbe)
        return {
          id: item.id,
          kind: "retry-observation",
          status: "not_applicable",
          failures: [],
          received: 1,
          observationCaptured: true,
        };
      const expected = gap?.cases?.[item.id];
      return {
        id: item.id,
        status: expected ? "failed" : "passed",
        failures: expected?.failures ?? [],
        received: expected?.received ?? item.requestCount,
        observation: expected
          ? {
              exception: expected.exception ?? undefined,
              outcome: expected.outcome ?? undefined,
              diagnostic: expected.diagnostic ?? undefined,
            }
          : undefined,
      };
    }),
  };
  return { row, wire };
}

test("all candidate cases must pass; raw compatibility flags remain failed", () => {
  const good = evidence("TypeScript", "overlay");
  expect(assess(good.row, good.wire, null).validationPassed).toBe(true);
  const raw = evidence("Java", "raw");
  const verdict = assess(raw.row, raw.wire, null);
  expect(verdict.validationPassed).toBe(true);
  expect(verdict.compatibilityPassed).toBe(false);
  expect(raw.row.wireContract.status).toBe("failed");
});

test("a new failure cannot hide behind a raw negative regression", () => {
  const { row, wire } = evidence("Java", "raw");
  const first = wire.cases[0];
  if (!first) throw new Error("Missing first fixture case");
  first.status = "failed";
  first.failures = ["bearer credential differs"];
  expect(assess(row, wire, null).validationPassed).toBe(false);
});

test("installation/build failures, crashes and missing cases stay fatal", () => {
  const sample = evidence("Java", "raw");
  sample.row.buildOrLoad = stage("failed");
  expect(assess(sample.row, sample.wire, null).validationPassed).toBe(false);
  const crash = evidence("Java", "raw");
  crash.wire.runnerExitCode = 1;
  expect(assess(crash.row, crash.wire, null).validationPassed).toBe(false);
  const missing = evidence("Java", "raw");
  missing.wire.cases.pop();
  expect(assess(missing.row, missing.wire, null).validationPassed).toBe(false);
});

test("changed failure signatures and unexpected fixes need baseline review", () => {
  const sample = evidence("Java", "raw");
  const entry = sample.wire.cases.find((item) => item.status === "failed");
  if (!entry) throw new Error("Missing baseline failure");
  entry.failures = ["new unrelated failure"];
  expect(assess(sample.row, sample.wire, null).validationPassed).toBe(false);
  entry.status = "passed";
  entry.failures = [];
  expect(assess(sample.row, sample.wire, null).validationPassed).toBe(false);
});

test("required overlays cannot be added to the known failure inventory", () => {
  const sample = evidence("Ruby", "overlay");
  const modified = structuredClone(baseline);
  const gap = baseline.targets["Ruby/raw"];
  if (!gap) throw new Error("Missing Ruby baseline");
  modified.targets["Ruby/overlay"] = gap;
  expect(assess(sample.row, sample.wire, null, modified).errors).toContain(
    "a required overlay cannot allow known compatibility failures",
  );
});
