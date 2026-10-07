import {
  KotpApiError,
  KotpClient,
  KotpTransportError,
} from "kotp-kiota-poc-typescript";

const fixture = await Bun.file(process.env.POC_FIXTURE ?? "").json();
const observations = [];
for (const test of fixture.cases) {
  const client = new KotpClient({
    apiKey: fixture.fakeSecretKey,
    baseUrl: process.env.POC_BASE_URL,
    timeoutMs: test.timeoutMs ?? 10000,
  });
  const options = {
    headers: { "X-Poc-Case": test.id },
    origin: "https://poc.example.com",
    retry503: test.explicitRetry === true,
  };
  const observation: Record<string, unknown> = { id: test.id };
  try {
    switch (test.operation) {
      case "issue":
        observation.response = await client.issue(test.request, options);
        break;
      case "verify":
        observation.response = await client.verify(test.request, options);
        break;
      case "status":
        observation.response = await client.status(test.query.issueId, options);
        break;
      case "issues":
        observation.response = await client.issues(test.query, options);
        break;
      case "issueDetail":
        observation.response = await client.issueDetail(
          test.pathValue,
          options,
        );
        break;
      case "creditLedger":
        observation.response = await client.creditLedger(test.query, options);
        break;
      case "balance":
        observation.response = await client.balance(options);
        break;
      case "templates":
        observation.response = await client.templates(options);
        break;
      case "templateDetail":
        observation.response = await client.templateDetail(
          test.pathValue,
          options,
        );
        break;
      default:
        throw new Error("Unknown fixture operation");
    }
  } catch (error) {
    if (error instanceof KotpApiError)
      Object.assign(observation, {
        status: error.status,
        headers: error.headers,
        response: error.envelope,
        exception: error.name,
        requestId: error.requestId,
        retryAfterMs: error.retryAfterMs,
      });
    else if (error instanceof KotpTransportError)
      observation.outcome = error.outcome;
    else if (error instanceof TypeError)
      observation.outcome = "configuration_error";
    else throw error;
  }
  observations.push(observation);
}
await Bun.write(
  process.env.POC_WIRE_RESULT ?? "",
  JSON.stringify(observations),
);
