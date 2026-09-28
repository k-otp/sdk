import { afterEach, describe, expect, test } from "bun:test";
import {
  createIdempotencyKey,
  createOtpClient,
  DEFAULT_BASE_URL,
  isOtpApiError,
  type OtpApiError,
  type OtpOperation,
  type OtpRequestEndInfo,
} from "../src/index";
import {
  errorEnvelope,
  hangUntilAborted,
  issueOutput,
  json,
  mockFetch,
  verifyOutput,
} from "./helpers";

const issueInput = {
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey: "signup-0001",
};

const rejection = async (promise: Promise<unknown>): Promise<OtpApiError> => {
  try {
    await promise;
  } catch (error) {
    if (isOtpApiError(error)) return error;
    throw error;
  }
  throw new Error("expected the promise to reject");
};

describe("createOtpClient", () => {
  test("defaults to the production base URL", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    await client.issue(issueInput);
    expect(DEFAULT_BASE_URL).toBe("https://api.k-otp.dev/v1");
    expect(calls[0]?.url.href).toBe("https://api.k-otp.dev/v1/issue");
  });

  test("creation performs no I/O", () => {
    const { fetch, calls } = mockFetch(() => json(200, {}));
    createOtpClient({ apiKey: "pk_test", fetch });
    expect(calls).toHaveLength(0);
  });

  test("rejects a missing apiKey synchronously", () => {
    expect(() => createOtpClient({ apiKey: "  " })).toThrow(TypeError);
  });

  test("resolves a lazy (async) apiKey per request", async () => {
    const { fetch, calls } = mockFetch(() => json(200, verifyOutput));
    let n = 0;
    const client = createOtpClient({
      apiKey: async () => `pk_rotated_${++n}`,
      fetch,
    });
    await client.verify({ issueId: "i", code: "123456" });
    await client.verify({ issueId: "i", code: "123456" });
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([
      "Bearer pk_rotated_1",
      "Bearer pk_rotated_2",
    ]);
  });
});

describe("issue", () => {
  test("POSTs the body and the Idempotency-Key header", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({
      baseUrl: "http://localhost:8788/v1/",
      apiKey: "pk_test",
      fetch,
      headers: { "x-app-version": "1.2.3", Authorization: "Bearer evil" },
    });

    const result = await client.issue({
      ...issueInput,
      idempotencyKey: "  signup-0001  ",
      channel: "sms",
      templateVariables: { name: "Kim" },
    });

    expect(result).toEqual(issueOutput);
    const call = calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.href).toBe("http://localhost:8788/v1/issue");
    expect(call?.headers.get("authorization")).toBe("Bearer pk_test");
    expect(call?.headers.get("idempotency-key")).toBe("signup-0001");
    expect(call?.headers.get("x-app-version")).toBe("1.2.3");
    expect(call?.headers.get("content-type")).toContain("application/json");
    expect(call?.body).toEqual({
      phoneNumber: "01012345678",
      purpose: "signup",
      idempotencyKey: "signup-0001",
      channel: "sms",
      templateVariables: { name: "Kim" },
    });
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["too long", "k".repeat(129)],
    ["contains spaces", "a b"],
    ["non-ASCII", "키-0001"],
  ])("rejects a %s idempotency key before any request", async (_, key) => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const error = await rejection(
      client.issue({ ...issueInput, idempotencyKey: key as string }),
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("accepts a 128-character key", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    await client.issue({ ...issueInput, idempotencyKey: "k".repeat(128) });
    expect(calls).toHaveLength(1);
  });

  test("402 carries payment-required data", async () => {
    const { fetch } = mockFetch(() =>
      errorEnvelope(402, "PAYMENT_REQUIRED", "Insufficient credit", {
        code: "INSUFFICIENT_CREDIT",
      }),
    );
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const error = await rejection(client.issue(issueInput));
    expect(error.code).toBe("PAYMENT_REQUIRED");
    expect(error.status).toBe(402);
    expect(error.data).toEqual({ code: "INSUFFICIENT_CREDIT" });
    expect(error.retryable).toBe(false);
  });

  test("409 when a key is reused with a different payload", async () => {
    const { fetch } = mockFetch(() =>
      errorEnvelope(409, "CONFLICT", "Idempotency key reused"),
    );
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const error = await rejection(client.issue(issueInput));
    expect(error.code).toBe("CONFLICT");
    expect(error.status).toBe(409);
  });
});

describe("verify", () => {
  test("POSTs issueId and code", async () => {
    const { fetch, calls } = mockFetch(() => json(200, verifyOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const result = await client.verify({ issueId: "abc", code: "123456" });
    expect(result.verified).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe("/v1/verify");
    expect(calls[0]?.body).toEqual({ issueId: "abc", code: "123456" });
    expect(calls[0]?.headers.get("idempotency-key")).toBeNull();
  });

  test("verification failures resolve (HTTP 200) with a reasonCode", async () => {
    const { fetch } = mockFetch(() =>
      json(200, {
        issueId: "abc",
        verified: false,
        reasonCode: "MISMATCH",
        attemptsRemaining: 3,
        expiresAt: issueOutput.expiresAt,
      }),
    );
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const result = await client.verify({ issueId: "abc", code: "000000" });
    expect(result.verified).toBe(false);
    expect(result.reasonCode).toBe("MISMATCH");
  });
});

describe("timeouts, aborts and network failures", () => {
  test("times out with TIMEOUT (status 0)", async () => {
    const { fetch } = mockFetch((request) => hangUntilAborted(request.signal));
    const client = createOtpClient({ apiKey: "pk_test", fetch, timeoutMs: 20 });
    const error = await rejection(client.issue(issueInput));
    expect(error.code).toBe("TIMEOUT");
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  test("per-call timeoutMs overrides the client default", async () => {
    const { fetch } = mockFetch((request) => hangUntilAborted(request.signal));
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch,
      timeoutMs: 60_000,
    });
    const error = await rejection(
      client.verify({ issueId: "a", code: "123456" }, { timeoutMs: 10 }),
    );
    expect(error.code).toBe("TIMEOUT");
  });

  test("a caller signal aborts with ABORTED", async () => {
    const { fetch } = mockFetch((request) => hangUntilAborted(request.signal));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const controller = new AbortController();
    const pending = client.issue(issueInput, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const error = await rejection(pending);
    expect(error.code).toBe("ABORTED");
    expect(error.retryable).toBe(false);
  });

  test("an already-aborted signal never reaches fetch", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const error = await rejection(
      client.issue(issueInput, { signal: AbortSignal.abort() }),
    );
    expect(error.code).toBe("ABORTED");
    expect(calls).toHaveLength(0);
  });

  test("fetch failures become NETWORK_ERROR", async () => {
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    const error = await rejection(client.issue(issueInput));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});

describe("telemetry hooks", () => {
  test("report start/end with status and request id", async () => {
    const { fetch } = mockFetch(() =>
      json(200, issueOutput, { "x-request-id": "req_123" }),
    );
    const events: unknown[] = [];
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch,
      hooks: {
        onRequestStart: (op) => events.push(["start", op]),
        onRequestEnd: (op, ok, status, info) =>
          events.push(["end", op, ok, status, info?.requestId]),
      },
    });
    await client.issue(issueInput);
    expect(events).toEqual([
      ["start", "issue"],
      ["end", "issue", true, 200, "req_123"],
    ]);
  });

  test("report failures with the normalized error", async () => {
    const { fetch } = mockFetch(() =>
      errorEnvelope(403, "FORBIDDEN", "Origin not allowed"),
    );
    const ends: [OtpOperation, boolean, number?, OtpRequestEndInfo?][] = [];
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch,
      hooks: { onRequestEnd: (...args) => ends.push(args) },
    });
    await rejection(client.verify({ issueId: "a", code: "123456" }));
    expect(ends[0]?.[0]).toBe("verify");
    expect(ends[0]?.[1]).toBe(false);
    expect(ends[0]?.[2]).toBe(403);
    expect(ends[0]?.[3]?.error?.code).toBe("FORBIDDEN");
    expect(ends[0]?.[3]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("status is undefined when no response was received", async () => {
    const { fetch } = mockFetch((request) => hangUntilAborted(request.signal));
    let status: number | undefined = -1;
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch,
      timeoutMs: 5,
      hooks: { onRequestEnd: (_op, _ok, s) => (status = s) },
    });
    await rejection(client.issue(issueInput));
    expect(status).toBeUndefined();
  });

  test("hook exceptions never change SDK behavior", async () => {
    const { fetch } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch,
      hooks: {
        onRequestStart: () => {
          throw new Error("boom");
        },
        onRequestEnd: () => {
          throw new Error("boom");
        },
      },
    });
    expect(await client.issue(issueInput)).toEqual(issueOutput);
  });

  test("hooks are not called for client-side validation failures", async () => {
    const started: string[] = [];
    const client = createOtpClient({
      apiKey: "pk_test",
      fetch: mockFetch(() => json(200, {})).fetch,
      hooks: { onRequestStart: (op) => started.push(op) },
    });
    await rejection(client.issue({ ...issueInput, idempotencyKey: "" }));
    expect(started).toEqual([]);
  });
});

describe("secret keys in browsers", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  test("sk_ is refused when window/document exist", () => {
    g.window = g;
    g.document = {};
    expect(() => createOtpClient({ apiKey: "sk_live_x" })).toThrow(
      /Refusing to use an sk_ secret key in a browser/,
    );
  });

  test("lazy sk_ keys are refused per request in browsers", async () => {
    g.window = g;
    g.document = {};
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const client = createOtpClient({ apiKey: () => "sk_live_x", fetch });
    const error = await client.issue(issueInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  test("the escape hatch allows it explicitly", () => {
    g.window = g;
    g.document = {};
    expect(() =>
      createOtpClient({
        apiKey: "sk_test_x",
        dangerouslyAllowSecretKeyInBrowser: true,
      }),
    ).not.toThrow();
  });

  test("sk_ is allowed on servers (no document)", () => {
    expect(() => createOtpClient({ apiKey: "sk_test_x" })).not.toThrow();
  });
});

describe("createIdempotencyKey", () => {
  test("returns a UUID v4, optionally prefixed", () => {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(createIdempotencyKey()).toMatch(uuid);
    const prefixed = createIdempotencyKey("signup");
    expect(prefixed.startsWith("signup-")).toBe(true);
    expect(prefixed.slice("signup-".length)).toMatch(uuid);
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });

  test("falls back to getRandomValues outside secure contexts", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: original.getRandomValues.bind(original) },
    });
    try {
      expect(createIdempotencyKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: original,
      });
    }
  });

  test("rejects prefixes that make the key invalid", () => {
    expect(() => createIdempotencyKey("has space")).toThrow(/visible ASCII/);
  });
});
