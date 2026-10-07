import { expect, test } from "bun:test";
import { fixture } from "../mock/contract";
import { baseline, type ResultRow, type WireEvidence } from "./ci-policy";
import { config, stage } from "./common";
import { assessPreview } from "./preview-evidence";
import { previewPackages } from "./preview-package";

function sample() {
  const context = {
    sourceCommit: "current",
    runId: "42",
    runAttempt: "1",
    specSha256: baseline.metadata.specSha256,
    fixtureSha256: baseline.metadata.fixtureSha256,
    actionCommit: config.actionCommit,
  };
  const row: ResultRow & Record<string, unknown> = {
    ...context,
    ...baseline.metadata,
    target: "Java",
    inputVariant: "overlay",
    generation: stage("passed"),
    buildOrLoad: stage("passed"),
    wireContract: stage("passed"),
    kotlinInterop: stage("not_applicable"),
    packageConsumer: stage("passed"),
    reproducibility: stage("passed"),
    previewPackage: {
      ...previewPackages.Java,
      channel: "release",
      profile: "preview",
      sourceHash: "source",
    },
    packageArtifacts: { "sdk.jar": "hash" },
  };
  const wire: WireEvidence = {
    runnerExitCode: 0,
    unexpectedRequests: [],
    cases: fixture.cases.map((item) => ({
      id: item.id,
      status: item.defaultRetryProbe ? "not_applicable" : "passed",
      kind: item.defaultRetryProbe ? "retry-observation" : undefined,
      observationCaptured: !!item.defaultRetryProbe,
      received: item.defaultRetryProbe ? 1 : item.requestCount,
      failures: [],
    })),
  };
  const observations = fixture.cases.map((item) => ({
    id: item.id,
    requestId: item.response.headers["X-Request-Id"],
    retryAfterMs:
      (item.response.body as { data?: { retryAfterMs?: number } }).data
        ?.retryAfterMs ??
      (item.response.headers["Retry-After"] !== undefined
        ? Number(item.response.headers["Retry-After"]) * 1000
        : undefined),
  }));
  return { context, row, wire, observations };
}

test("a preview needs a current artifact, all contracts and the public error view", () => {
  const s = sample();
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(true);
});
test("old commits, wrong package contents and source changes cannot reuse a pass", () => {
  const s = sample();
  s.row.sourceCommit = "old";
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
  s.row.sourceCommit = "current";
  s.row.packageArtifacts = {};
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
  s.row.packageArtifacts = { "sdk.jar": "hash" };
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "changed").passed,
  ).toBe(false);
});
test("normalized requestId and retryAfterMs are real public contract fields", () => {
  const s = sample();
  const error = s.observations.find((item) => item.id === "error-429");
  if (!error) throw new Error("Missing fixture");
  error.retryAfterMs = 0;
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
  error.retryAfterMs = 1500;
  error.requestId = "wrong";
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
});
test("consumer crashes and missing cases cannot pass the preview gate", () => {
  const s = sample();
  s.wire.runnerExitCode = 1;
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
  s.wire.runnerExitCode = 0;
  s.wire.cases.pop();
  expect(
    assessPreview(s.row, s.wire, s.observations, s.context, "source").passed,
  ).toBe(false);
});
