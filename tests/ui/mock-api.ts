/**
 * A scripted K-OTP API for the UI component tests: `issue` returns a 180 s
 * code, `verify` accepts `123456`, and `next.issue` / `next.verify` queue a
 * one-off response (an error envelope, a hang, ...) for the next call.
 */
import { createOtpClient, type OtpClient } from "@k-otp/sdk";
import {
  errorEnvelope,
  json,
  type RecordedRequest,
} from "../../packages/sdk/test/helpers";

export const MOCK_CODE = "123456";

type Reply = (request: RecordedRequest) => Response | Promise<Response>;

export type MockApi = {
  client: OtpClient;
  calls: RecordedRequest[];
  next: { issue: Reply[]; verify: Reply[] };
  /** Resolves once every request started so far has answered. */
  idle: () => Promise<void>;
};

export const rateLimited =
  (retryAfterMs: number): Reply =>
  () =>
    errorEnvelope(
      429,
      "TOO_MANY_REQUESTS",
      "Too many requests",
      { limit: "perKey", policy: "platform", retryAfterMs },
      { "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
    );

export const unavailable =
  (retryAfterSeconds?: number): Reply =>
  () =>
    errorEnvelope(
      503,
      "SERVICE_UNAVAILABLE",
      "Unavailable",
      undefined,
      retryAfterSeconds === undefined
        ? {}
        : { "retry-after": String(retryAfterSeconds) },
    );

export const createMockApi = (): MockApi => {
  const calls: RecordedRequest[] = [];
  const next: MockApi["next"] = { issue: [], verify: [] };
  const pending = new Set<Promise<unknown>>();
  let count = 0;
  const attempts = new Map<string, number>();

  const handle = async (request: RecordedRequest): Promise<Response> => {
    const body = (request.body ?? {}) as Record<string, string>;
    if (request.url.pathname.endsWith("/issue")) {
      const scripted = next.issue.shift();
      if (scripted) return scripted(request);
      count++;
      const issueId = `issue-${count}`;
      attempts.set(issueId, 5);
      return json(200, {
        issueId,
        queuedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:03:00.000Z",
        attemptsRemaining: 5,
      });
    }
    const scripted = next.verify.shift();
    if (scripted) return scripted(request);
    const left = attempts.get(body.issueId ?? "") ?? 0;
    if (body.code === MOCK_CODE) {
      return json(200, {
        issueId: body.issueId,
        verified: true,
        attemptsRemaining: left,
        expiresAt: "2026-01-01T00:03:00.000Z",
        verifiedAt: "2026-01-01T00:01:00.000Z",
      });
    }
    attempts.set(body.issueId ?? "", left - 1);
    return json(200, {
      issueId: body.issueId,
      verified: false,
      reasonCode: left - 1 > 0 ? "MISMATCH" : "MAX_ATTEMPTS",
      attemptsRemaining: left - 1,
      expiresAt: "2026-01-01T00:03:00.000Z",
    });
  };

  const fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    const recorded: RecordedRequest = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
      signal: request.signal,
    };
    calls.push(recorded);
    const promise = handle(recorded);
    pending.add(promise);
    try {
      return await promise;
    } finally {
      pending.delete(promise);
    }
  }) as typeof globalThis.fetch;

  return {
    client: createOtpClient({ apiKey: "pk_test_ui", fetch }),
    calls,
    next,
    idle: async () => {
      while (pending.size) await Promise.all(pending);
    },
  };
};

/** Lets pending promises, timers of 0 ms and framework updates run. */
export const flush = async (times = 5): Promise<void> => {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
