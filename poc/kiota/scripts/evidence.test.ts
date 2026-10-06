import { expect, test } from "bun:test";
import { type EvidenceContext, identityIssues } from "./evidence";

const context: EvidenceContext = {
  sourceCommit: "current-commit",
  runId: "current-run",
  runAttempt: "2",
  specSha256: "current-spec",
  fixtureSha256: "current-fixture",
  actionCommit: "pinned-action",
};
const evidence = { ...context, target: "Java", inputVariant: "overlay" };

test("a prior successful artifact cannot satisfy the current run", () => {
  expect(
    identityIssues(
      { ...evidence, runId: "previous-run", sourceCommit: "previous-commit" },
      context,
      "Java",
      "overlay",
    ),
  ).toEqual([
    "evidence sourceCommit does not match this run",
    "evidence runId does not match this run",
  ]);
});

test("an artifact from another variant or fixture is rejected", () => {
  expect(
    identityIssues(
      { ...evidence, inputVariant: "raw", fixtureSha256: "old-fixture" },
      context,
      "Java",
      "overlay",
    ),
  ).toHaveLength(2);
});

test("identity must be complete even if all stage flags say passed", () => {
  expect(identityIssues({}, context, "Java", "overlay")).toHaveLength(8);
  expect(identityIssues(evidence, context, "Java", "overlay")).toEqual([]);
});
