import {
  AnonymousAuthenticationProvider,
  type RequestConfiguration,
} from "@microsoft/kiota-abstractions";
import { DefaultRequestAdapter } from "@microsoft/kiota-bundle";
import {
  CustomFetchHandler,
  HttpClient,
} from "@microsoft/kiota-http-fetchlibrary";
import type { IssuePostRequestBody } from "./generated/issue";
import { createKOtpApiClient } from "./generated/kOtpApiClient";
import type { VerifyPostRequestBody } from "./generated/verify";

type TestCase = {
  id: string;
  operation: string;
  request: Record<string, unknown>;
  query: Record<string, unknown>;
  pathValue?: string;
  timeoutMs?: number;
  explicitRetry?: boolean;
  defaultRetryProbe?: boolean;
};
type ApiError = {
  responseStatusCode?: number;
  responseHeaders?: Headers | Record<string, string[]>;
  additionalData?: Record<string, unknown>;
  defined?: boolean;
  code?: string;
  status?: number;
  message?: string;
  data?: unknown;
};
const fixturePath = process.env.POC_FIXTURE;
const baseUrl = process.env.POC_BASE_URL;
const resultPath = process.env.POC_WIRE_RESULT;
if (!fixturePath || !baseUrl || !resultPath)
  throw new Error("Fixture, base URL and result path required");
const fixture = (await Bun.file(fixturePath).json()) as {
  fakeSecretKey: string;
  cases: TestCase[];
};
const base = new URL(baseUrl);
if (base.hostname !== "127.0.0.1" || !fixture.fakeSecretKey.startsWith("sk_"))
  throw new TypeError("Secret key and loopback URL required");
const observations: Record<string, unknown>[] = [];
for (const test of fixture.cases) {
  const guardedFetch = async (request: string, init: RequestInit) => {
    const url = new URL(request);
    if (url.origin !== base.origin)
      throw new Error("Unexpected external network destination");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${fixture.fakeSecretKey}`);
    return fetch(request, {
      ...init,
      headers,
      signal: AbortSignal.timeout(test.timeoutMs ?? 10000),
    });
  };
  const adapter = new DefaultRequestAdapter(
    new AnonymousAuthenticationProvider(),
    undefined,
    undefined,
    test.defaultRetryProbe
      ? new HttpClient(guardedFetch)
      : new HttpClient(guardedFetch, new CustomFetchHandler(guardedFetch)),
  );
  adapter.baseUrl = base.href;
  const client = createKOtpApiClient(adapter);
  const config: RequestConfiguration<Record<string, unknown>> = {
    headers: { "X-Poc-Case": test.id },
  };
  const call = async () => {
    switch (test.operation) {
      case "issue": {
        const key = String(test.request.idempotencyKey ?? "").trim();
        if (!/^[!-~]{1,128}$/.test(key))
          throw new TypeError("Invalid idempotency key before HTTP");
        const body = { ...test.request } as IssuePostRequestBody;
        config.headers = {
          ...config.headers,
          "Idempotency-Key": key,
          Origin: "https://poc.example.com",
        };
        return client.issue.post(body, config);
      }
      case "verify":
        return client.verify.post(
          test.request as VerifyPostRequestBody,
          config,
        );
      case "status":
        return client.status.get({ ...config, queryParameters: test.query });
      case "issues":
        return client.issues.get({ ...config, queryParameters: test.query });
      case "issueDetail":
        return client.issues.byIssueId(test.pathValue ?? "").get(config);
      case "creditLedger":
        return client.creditLedger.get({
          ...config,
          queryParameters: test.query,
        });
      case "balance":
        return client.balance.get(config);
      case "templates":
        return client.templates.get(config);
      case "templateDetail":
        return client.templates.byTemplateId(test.pathValue ?? "").get(config);
      default:
        throw new Error("Unknown operation");
    }
  };
  const observation: Record<string, unknown> = { id: test.id };
  try {
    try {
      observation.response = await call();
    } catch (error) {
      if (test.explicitRetry && (error as ApiError).responseStatusCode === 503)
        observation.response = await call();
      else throw error;
    }
  } catch (cause) {
    const error = cause as ApiError;
    if (test.timeoutMs) observation.outcome = "unknown";
    else if (
      cause instanceof TypeError &&
      ["issue-invalid-idempotency", "issue-missing-idempotency"].includes(
        test.id,
      )
    )
      observation.outcome = "configuration_error";
    else {
      observation.response = {
        defined: error.defined,
        code: error.code,
        status: error.status,
        message: error.message,
        data: error.data ?? error.additionalData?.data,
      };
      observation.status = error.responseStatusCode;
      observation.headers =
        error.responseHeaders instanceof Headers
          ? Object.fromEntries(error.responseHeaders)
          : error.responseHeaders;
      observation.exception = cause instanceof Error ? cause.name : "non-Error";
    }
  }
  observations.push(observation);
}
await Bun.write(resultPath, JSON.stringify(observations));
