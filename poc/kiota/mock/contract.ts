import { isDeepStrictEqual } from "node:util";
import fixture from "../fixtures/contract.json";

export { fixture };
export type Case = (typeof fixture.cases)[number];
export type Observation = {
  id: string;
  response?: unknown;
  status?: number;
  headers?: Record<string, string | string[]>;
  outcome?: string;
  exception?: string;
};

function lookup(value: unknown, location: string): unknown {
  for (const key of location.split(".")) {
    if (value === null || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined ? null : value;
}

export function startContractServer() {
  const requests: {
    id: string;
    method: string;
    pathname: string;
    query: Record<string, string>;
    body: unknown;
  }[] = [];
  const violations: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const id = request.headers.get("x-poc-case") ?? "missing-case";
      const test = fixture.cases.find((value) => value.id === id);
      const query = Object.fromEntries(url.searchParams.entries());
      let body: unknown = null;
      try {
        body = request.method === "POST" ? await request.json() : null;
      } catch {
        violations.push(`${id}: invalid JSON request`);
      }
      requests.push({
        id,
        method: request.method,
        pathname: url.pathname,
        query,
        body,
      });
      const count = requests.filter((entry) => entry.id === id).length;
      if (!test) {
        violations.push(`${id}: unexpected network request`);
        return new Response("unexpected request", { status: 418 });
      }
      if (
        request.method !== test.method ||
        decodeURIComponent(url.pathname) !== `/v1${test.path}`
      )
        violations.push(`${id}: method/path differs`);
      if (
        !isDeepStrictEqual(
          query,
          Object.fromEntries(
            Object.entries(test.query).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        )
      )
        violations.push(`${id}: query differs`);
      if (!isDeepStrictEqual(body, test.request))
        violations.push(`${id}: serialized request body differs`);
      if (
        request.headers.get("authorization") !==
        `Bearer ${fixture.fakeSecretKey}`
      )
        violations.push(`${id}: bearer credential differs`);
      if (
        test.operation === "issue" &&
        typeof body === "object" &&
        body !== null &&
        request.headers.get("idempotency-key") !==
          (body as Record<string, unknown>).idempotencyKey
      )
        violations.push(`${id}: idempotency header/body mismatch`);
      if (
        test.operation === "issue" &&
        (test.request as { webOtp?: unknown }).webOtp === true &&
        request.headers.get("origin") !== "https://poc.example.com"
      )
        violations.push(`${id}: missing Origin for boolean webOtp`);
      if (typeof test.delayMs === "number") await Bun.sleep(test.delayMs);
      if ("explicitRetry" in test && count === 1)
        return Response.json(
          {
            defined: true,
            code: "SERVICE_UNAVAILABLE",
            status: 503,
            message: "explicit retry fixture",
          },
          { status: 503, headers: { "Retry-After": "0" } },
        );
      return Response.json(test.response.body, {
        status: test.response.status,
        headers: Object.fromEntries(
          Object.entries(test.response.headers).filter(
            ([, value]) => typeof value === "string",
          ),
        ) as Record<string, string>,
      });
    },
  });
  const baseUrl = `http://127.0.0.1:${server.port}/v1`;
  return { server, requests, violations, baseUrl };
}

export function evaluate(
  observations: Observation[],
  requests: ReturnType<typeof startContractServer>["requests"],
  violations: string[],
) {
  return fixture.cases.map((test) => {
    const observation = observations.find((entry) => entry.id === test.id);
    const failures = violations.filter((value) =>
      value.startsWith(`${test.id}:`),
    );
    const received = requests.filter((request) => request.id === test.id);
    if (received.length !== test.requestCount)
      failures.push(
        `request count: expected ${test.requestCount}, got ${received.length}`,
      );
    if (!observation) failures.push("missing consumer observation");
    else if ("expectedOutcome" in test) {
      if (observation.outcome !== test.expectedOutcome)
        failures.push(`expected ${test.expectedOutcome} outcome`);
    } else {
      for (const check of test.checks)
        if (
          !isDeepStrictEqual(
            lookup(observation.response, check.path),
            check.value,
          )
        )
          failures.push(`response field ${check.path} differs`);
      if (test.response.status >= 400) {
        if (observation.status !== test.response.status)
          failures.push("HTTP error status inaccessible");
        const headers = Object.fromEntries(
          Object.entries(observation.headers ?? {}).map(([key, value]) => [
            key.toLowerCase(),
            Array.isArray(value) ? value.join(",") : value,
          ]),
        );
        if (headers["x-request-id"] !== test.response.headers["X-Request-Id"])
          failures.push("X-Request-Id inaccessible");
        if (test.response.status === 429 && headers["retry-after"] !== "0")
          failures.push(
            "Retry-After inaccessible (seconds, separate from data.retryAfterMs)",
          );
      }
    }
    if (
      "explicitRetry" in test &&
      received.length === 2 &&
      !isDeepStrictEqual(received[0]?.body, received[1]?.body)
    )
      failures.push("explicit retry changed payload");
    return {
      id: test.id,
      status: failures.length ? "failed" : "passed",
      failures,
      received: received.length,
      observation,
    };
  });
}
