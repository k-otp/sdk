import { expect, test } from "bun:test";
import { releaseAssetName, validateReleaseRun } from "../release-sdks";

test("SDK publishing rejects failed, PR, stale and unrelated workflow evidence", () => {
  const run = {
    head_sha: "current",
    head_branch: "main",
    workflow_id: 7,
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  expect(() => validateReleaseRun(run, "current", 7)).not.toThrow();
  for (const patch of [
    { head_sha: "old" },
    { head_branch: "feature" },
    { workflow_id: 8 },
    { event: "pull_request" },
    { status: "in_progress" },
    { conclusion: "failure" },
  ])
    expect(() =>
      validateReleaseRun({ ...run, ...patch }, "current", 7),
    ).toThrow();
});
test("release assets use safe public names and skip Go proxy metadata", () => {
  expect(
    releaseAssetName("Go", "github.com/k-otp/sdk/sdks/go/@v/v0.1.0.zip"),
  ).toBe("kotp-sdk-go-0.1.0.zip");
  expect(releaseAssetName("Go", "v0.1.0.mod")).toBeNull();
  expect(() => releaseAssetName("Python", "../secret.whl")).toThrow();
});
