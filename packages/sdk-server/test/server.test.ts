import { afterEach, describe, expect, test } from "bun:test";
import {
  errorEnvelope,
  hangUntilAborted,
  issueOutput,
  json,
  mockFetch,
  type RecordedRequest,
  verifyOutput,
} from "../../sdk-core/test/helpers";
import {
  createOtpServerClient,
  type GetTemplateResult,
  isOtpApiError,
  type OtpApiError,
  OtpApiError as OtpApiErrorClass,
  type OtpOperation,
  paginatePages,
} from "../src/index";

const BASE = "https://api.test/v1";
const ISSUE_ID = issueOutput.issueId;

const rejection = async (promise: Promise<unknown>): Promise<OtpApiError> => {
  try {
    await promise;
  } catch (error) {
    if (isOtpApiError(error)) return error;
    throw error;
  }
  throw new Error("expected the promise to reject");
};

const statusOutput = {
  issueId: ISSUE_ID,
  messageId: "m_1",
  purpose: "signup",
  templateId: "otp_default_kr",
  verificationStatus: "issued",
  deliveryStatus: "delivered",
  overallStatus: "delivered",
  expiresAt: issueOutput.expiresAt,
  attemptsUsed: 0,
  maxAttempts: 5,
  attemptsRemaining: 5,
  createdAt: issueOutput.queuedAt,
  updatedAt: issueOutput.queuedAt,
};

const dashboardIssue = (n: number) => ({
  issueId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  purpose: "signup",
  templateId: "otp_default_kr",
  channel: "sms",
  verificationStatus: "verified",
  deliveryStatus: "delivered",
  overallStatus: "verified",
  billingStatus: "debited",
  debitedAmount: 1,
  currency: "CREDIT",
  attemptsUsed: 1,
  maxAttempts: 5,
  attemptsRemaining: 4,
  createdAt: issueOutput.queuedAt,
  updatedAt: issueOutput.queuedAt,
});

const ledgerEntry = (n: number) => ({
  ledgerId: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  entryType: "debit",
  amountDelta: -1,
  balanceAfter: 100 - n,
  currency: "CREDIT",
  createdAt: issueOutput.queuedAt,
});

const templateDetail: GetTemplateResult = {
  templateId: "otp_login_kr",
  name: "Login",
  channelSupport: ["alimtalk", "sms"],
  body: "[K-OTP] 로그인 인증번호는 #{code}입니다.",
  variables: { required: [], properties: {}, additionalProperties: false },
};

/** Routes by method + pathname, like the real API. */
const api = (request: RecordedRequest): Response => {
  const route = `${request.method} ${request.url.pathname}`;
  switch (route) {
    case "POST /v1/issue":
      return json(200, issueOutput);
    case "POST /v1/verify":
      return json(200, verifyOutput);
    case "GET /v1/status":
      return json(200, statusOutput);
    case `GET /v1/issues/${ISSUE_ID}`:
      return json(200, dashboardIssue(1));
    case "GET /v1/balance":
      return json(200, {
        appId: "app_1",
        balance: 42,
        currency: "CREDIT",
        updatedAt: issueOutput.queuedAt,
      });
    case "GET /v1/templates":
      return json(200, {
        defaultTemplateId: "otp_default_kr",
        templates: [],
        note: "",
      });
    case "GET /v1/templates/otp_login_kr":
      return json(200, templateDetail);
    case "GET /v1/issues": {
      const cursor = request.url.searchParams.get("cursor");
      if (!cursor)
        return json(200, {
          items: [dashboardIssue(1), dashboardIssue(2)],
          nextCursor: "c2",
        });
      if (cursor === "c2")
        return json(200, { items: [dashboardIssue(3)], nextCursor: "c3" });
      return json(200, { items: [] });
    }
    case "GET /v1/credit-ledger": {
      const cursor = request.url.searchParams.get("cursor");
      return cursor
        ? json(200, { items: [ledgerEntry(2)] })
        : json(200, { items: [ledgerEntry(1)], nextCursor: "l2" });
    }
    default:
      return errorEnvelope(404, "NOT_FOUND", `no route ${route}`);
  }
};

const setup = () => {
  const { fetch, calls } = mockFetch(api);
  const client = createOtpServerClient({
    baseUrl: BASE,
    apiKey: "sk_test_1",
    fetch,
  });
  return { client, calls };
};

describe("operations", () => {
  test("issue sends body + Idempotency-Key with the sk_ key", async () => {
    const { client, calls } = setup();
    const result = await client.issue({
      phoneNumber: "01012345678",
      purpose: "login",
      idempotencyKey: "login-1",
    });
    expect(result).toEqual(issueOutput);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk_test_1");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("login-1");
    expect(calls[0]?.body).toMatchObject({ idempotencyKey: "login-1" });
  });

  test("issue rejects a blank idempotency key before any request", async () => {
    const { client, calls } = setup();
    const error = await rejection(
      client.issue({ phoneNumber: "010", purpose: "x", idempotencyKey: " " }),
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(calls).toHaveLength(0);
  });

  test("verify", async () => {
    const { client, calls } = setup();
    expect(await client.verify({ issueId: ISSUE_ID, code: "123456" })).toEqual(
      verifyOutput,
    );
    expect(calls[0]?.url.pathname).toBe("/v1/verify");
  });

  test("getStatus -> GET /status?issueId=", async () => {
    const { client, calls } = setup();
    const result = await client.getStatus({ issueId: ISSUE_ID });
    expect(result.overallStatus).toBe("delivered");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url.pathname).toBe("/v1/status");
    expect(calls[0]?.url.searchParams.get("issueId")).toBe(ISSUE_ID);
    expect(calls[0]?.body).toBeUndefined();
  });

  test("listIssues sends filters as query parameters", async () => {
    const { client, calls } = setup();
    const page = await client.listIssues({
      limit: 2,
      verificationStatus: "verified",
      createdFrom: "2026-09-01T00:00:00Z",
      createdTo: "2026-09-30T00:00:00Z",
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("c2");
    const query = Object.fromEntries(calls[0]?.url.searchParams ?? []);
    expect(query).toEqual({
      limit: "2",
      verificationStatus: "verified",
      createdFrom: "2026-09-01T00:00:00Z",
      createdTo: "2026-09-30T00:00:00Z",
    });
  });

  test("listIssues without input sends no query", async () => {
    const { client, calls } = setup();
    await client.listIssues();
    expect(calls[0]?.url.search).toBe("");
  });

  test("getIssue -> GET /issues/{issueId}", async () => {
    const { client, calls } = setup();
    const issue = await client.getIssue({ issueId: ISSUE_ID });
    expect(issue.billingStatus).toBe("debited");
    expect(calls[0]?.url.pathname).toBe(`/v1/issues/${ISSUE_ID}`);
    expect(calls[0]?.url.search).toBe("");
  });

  test("path parameters are URL-encoded", async () => {
    const { client, calls } = setup();
    await rejection(client.getTemplate({ templateId: "a/b c" }));
    expect(calls[0]?.url.pathname).toBe("/v1/templates/a%2Fb%20c");
  });

  test("listCreditLedger", async () => {
    const { client, calls } = setup();
    const page = await client.listCreditLedger({ entryType: "debit" });
    expect(page.items[0]?.amountDelta).toBe(-1);
    expect(calls[0]?.url.pathname).toBe("/v1/credit-ledger");
    expect(calls[0]?.url.searchParams.get("entryType")).toBe("debit");
  });

  test("getBalance", async () => {
    const { client, calls } = setup();
    expect((await client.getBalance()).balance).toBe(42);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url.pathname).toBe("/v1/balance");
    expect(calls[0]?.url.search).toBe("");
  });

  test("listTemplates / getTemplate", async () => {
    const { client, calls } = setup();
    expect((await client.listTemplates()).defaultTemplateId).toBe(
      "otp_default_kr",
    );
    expect(await client.getTemplate({ templateId: "otp_login_kr" })).toEqual(
      templateDetail,
    );
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v1/templates",
      "/v1/templates/otp_login_kr",
    ]);
  });

  test("errors use the core error model", async () => {
    const { client } = setup();
    const error = await rejection(
      client.getIssue({ issueId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    );
    expect(error).toBeInstanceOf(OtpApiErrorClass);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
  });

  test("hooks report server operation names", async () => {
    const { fetch } = mockFetch(api);
    const ops: OtpOperation[] = [];
    const client = createOtpServerClient({
      baseUrl: BASE,
      apiKey: "sk_test_1",
      fetch,
      hooks: { onRequestEnd: (op) => ops.push(op) },
    });
    await client.getStatus({ issueId: ISSUE_ID });
    await client.getBalance();
    await client.listTemplates();
    expect(ops).toEqual(["status", "balance", "listTemplates"]);
  });

  test("timeouts apply to server operations", async () => {
    const { fetch } = mockFetch((request) => hangUntilAborted(request.signal));
    const client = createOtpServerClient({
      apiKey: "sk_test_1",
      fetch,
      timeoutMs: 10,
    });
    const error = await rejection(client.getBalance());
    expect(error.code).toBe("TIMEOUT");
  });
});

describe("pagination", () => {
  test("iterateIssues follows nextCursor and keeps filters", async () => {
    const { client, calls } = setup();
    const ids: string[] = [];
    for await (const issue of client.iterateIssues({
      limit: 2,
      verificationStatus: "verified",
    })) {
      ids.push(issue.issueId);
    }
    expect(ids).toHaveLength(3);
    expect(calls.map((c) => c.url.searchParams.get("cursor"))).toEqual([
      null,
      "c2",
      "c3",
    ]);
    for (const call of calls) {
      expect(call.url.searchParams.get("limit")).toBe("2");
      expect(call.url.searchParams.get("verificationStatus")).toBe("verified");
    }
  });

  test("iterateCreditLedger", async () => {
    const { client } = setup();
    const entries = [];
    for await (const entry of client.iterateCreditLedger()) entries.push(entry);
    expect(entries.map((e) => e.balanceAfter)).toEqual([99, 98]);
  });

  test("maxPages stops early", async () => {
    const { client, calls } = setup();
    const ids = [];
    for await (const issue of client.iterateIssues({}, { maxPages: 1 }))
      ids.push(issue);
    expect(ids).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  test("stops when the consumer breaks", async () => {
    const { client, calls } = setup();
    for await (const _ of client.iterateIssues()) break;
    expect(calls).toHaveLength(1);
  });

  test("a non-advancing cursor fails instead of looping", async () => {
    const pages = paginatePages(
      async () => ({ items: [1], nextCursor: "same" }),
      {} as { cursor?: string },
    );
    const error = await (async () => {
      for await (const _ of pages) {
        // drain
      }
    })().catch((e: unknown) => e);
    expect(isOtpApiError(error)).toBe(true);
  });

  test("errors propagate out of the iterator", async () => {
    const { fetch } = mockFetch(() => errorEnvelope(403, "FORBIDDEN", "scope"));
    const client = createOtpServerClient({ apiKey: "sk_test_1", fetch });
    const error = await (async () => {
      for await (const _ of client.iterateIssues()) {
        // drain
      }
    })().catch((e: unknown) => e);
    expect(isOtpApiError(error) && error.code).toBe("FORBIDDEN");
  });
});

describe("key guards", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  test("refuses pk_ public keys at construction", () => {
    expect(() => createOtpServerClient({ apiKey: "pk_live_1" })).toThrow(
      /requires an sk_ secret key/,
    );
  });

  test("refuses lazily resolved pk_ keys before any request", async () => {
    const { fetch, calls } = mockFetch(api);
    const client = createOtpServerClient({
      apiKey: async () => "pk_live_1",
      fetch,
    });
    const error = await client.getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  test("refuses to run in a browser", () => {
    g.window = g;
    g.document = {};
    expect(() => createOtpServerClient({ apiKey: "sk_test_1" })).toThrow(
      /must not run in a browser/,
    );
    expect(() =>
      createOtpServerClient({
        apiKey: "sk_test_1",
        dangerouslyAllowBrowser: true,
      }),
    ).not.toThrow();
  });
});
