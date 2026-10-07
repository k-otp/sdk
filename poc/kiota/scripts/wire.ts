import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  evaluate,
  type Observation,
  startContractServer,
} from "../mock/contract";
import { command, json, redact, root } from "./common";

const out = process.env.POC_TARGET_DIR;
if (!out) throw new Error("POC_TARGET_DIR is required");
const argv = process.argv.slice(2);
if (!argv.length)
  throw new Error("Pass the real consumer command after wire.ts");
const mock = startContractServer();
const resultFile = path.join(out, "reports/consumer-observations.json");
try {
  await mkdir(path.dirname(resultFile), { recursive: true });
  await rm(resultFile, { force: true });
  const runner = await command(
    argv,
    path.join(out, "logs/wire-consumer.txt"),
    path.join(out, "consumer"),
    {
      POC_BASE_URL: mock.baseUrl,
      POC_FIXTURE: path.join(root, "poc/kiota/fixtures/contract.json"),
      POC_WIRE_RESULT: resultFile,
    },
    180_000,
  );
  let observations: Observation[] = [];
  try {
    if (await Bun.file(resultFile).exists())
      observations = await Bun.file(resultFile).json();
  } catch {
    mock.violations.push("missing-case: malformed consumer observations");
  }
  await Bun.write(resultFile, redact(JSON.stringify(observations, null, 2)));
  const cases = evaluate(observations, mock.requests, mock.violations);
  const contractCases = cases.filter(
    (entry) => entry.kind !== "retry-observation",
  );
  await json(path.join(out, "reports/wire-cases.json"), {
    runnerExitCode: runner.exitCode,
    cases,
    unexpectedRequests: mock.violations.filter((entry) =>
      entry.startsWith("missing-case"),
    ),
  });
  await Bun.write(
    path.join(out, "reports/http-requests.json"),
    redact(JSON.stringify(mock.requests, null, 2)),
  );
  await json(
    path.join(out, "reports/default-retry.json"),
    cases.filter((entry) => entry.id === "probe-default-verify-429"),
  );
  console.log(
    `${contractCases.filter((test) => test.status === "passed").length}/${contractCases.length} wire cases passed`,
  );
  for (const test of cases.filter((test) => test.status === "failed"))
    console.log(`${test.id}: ${test.failures.join("; ")}`);
  process.exitCode =
    runner.exitCode === 0 &&
    contractCases.every((test) => test.status === "passed") &&
    cases
      .filter((entry) => entry.kind === "retry-observation")
      .every((entry) => entry.observationCaptured) &&
    mock.violations.every((v) => !v.startsWith("missing-case"))
      ? 0
      : 1;
} finally {
  await mock.server.stop(true);
}
