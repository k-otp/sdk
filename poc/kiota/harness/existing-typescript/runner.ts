import { OtpApiError } from "../../../../packages/sdk/src/core/errors";
import {
  createOtpServerClient,
  type OtpServerClient,
} from "../../../../packages/sdk/src/server/client";

type TestCase = {
  id: string;
  operation: string;
  request: Record<string, unknown>;
  query: Record<string, unknown>;
  pathValue?: string;
  timeoutMs?: number;
  explicitRetry?: boolean;
};
const fixturePath = process.env.POC_FIXTURE;
const base = process.env.POC_BASE_URL;
const resultPath = process.env.POC_WIRE_RESULT;
if (!fixturePath || !base || !resultPath)
  throw new Error("Fixture, mock URL and result path required");
const fixture = (await Bun.file(fixturePath).json()) as {
  fakeSecretKey: string;
  cases: TestCase[];
};
const observations: Record<string, unknown>[] = [];
for (const test of fixture.cases) {
  const customFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== new URL(base).origin)
      throw new Error("Unexpected external network destination");
    request.headers.set("X-Poc-Case", test.id);
    request.headers.set("Origin", "https://poc.example.com");
    return fetch(request);
  };
  const client = createOtpServerClient({
    apiKey: fixture.fakeSecretKey,
    baseUrl: base,
    fetch: customFetch,
    timeoutMs: test.timeoutMs ?? 10000,
    headers: { Origin: "https://poc.example.com" },
  });
  const call = async () => {
    switch (test.operation) {
      case "issue":
        return client.issue(
          test.request as Parameters<OtpServerClient["issue"]>[0],
        );
      case "verify":
        return client.verify(
          test.request as Parameters<OtpServerClient["verify"]>[0],
        );
      case "status":
        return client.getStatus(
          test.query as Parameters<OtpServerClient["getStatus"]>[0],
        );
      case "issues":
        return client.listIssues(test.query);
      case "issueDetail":
        return client.getIssue({ issueId: test.pathValue ?? "" });
      case "creditLedger":
        return client.listCreditLedger(test.query);
      case "balance":
        return client.getBalance();
      case "templates":
        return client.listTemplates();
      case "templateDetail":
        return client.getTemplate({ templateId: test.pathValue ?? "" });
      default:
        throw new Error("Unknown operation");
    }
  };
  const observation: Record<string, unknown> = { id: test.id };
  try {
    try {
      observation.response = await call();
    } catch (error) {
      if (
        test.explicitRetry &&
        error instanceof OtpApiError &&
        error.status === 503
      )
        observation.response = await call();
      else throw error;
    }
  } catch (error) {
    if (test.timeoutMs) observation.outcome = "unknown";
    else if (error instanceof TypeError)
      observation.outcome = "configuration_error";
    else if (error instanceof OtpApiError) {
      const underlying = error.cause as { defined?: boolean } | undefined;
      observation.response = {
        defined: underlying?.defined,
        code: error.code,
        status: error.status,
        message: error.message,
        data: error.data,
      };
      observation.status = error.status;
      observation.headers = {
        "X-Request-Id": error.requestId,
        "Retry-After": undefined,
      };
    } else observation.exception = String(error);
  }
  observations.push(observation);
}
await Bun.write(resultPath, JSON.stringify(observations));
