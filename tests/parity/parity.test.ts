/**
 * Adapter parity: identical mocked API responses must produce equivalent
 * outputs (results, state snapshots, normalized errors, requests sent) in the
 * React, Vue and Svelte adapters, and errors must equal what sdk-core itself
 * rejects with.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  createOtpClient,
  isOtpApiError,
  OtpApiError,
  type OtpClientOptions,
} from "@k-otp/sdk-core";
import {
  errorEnvelope,
  hangUntilAborted,
  issueOutput,
  json,
  mockFetch,
  type RecordedRequest,
  verifyOutput,
} from "../../packages/sdk-core/test/helpers";
import { type Driver, drivers, type Harness } from "./drivers";

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

const NOW = 1_000_000;
const issueInput = {
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey: "parity-key-1",
};
const sendInput = { phoneNumber: "01012345678", purpose: "signup" };

/** JSON-able view of any value, with errors reduced to their public shape. */
const normalize = (value: unknown): unknown => {
  if (isOtpApiError(value)) {
    return {
      otpApiError: value.toJSON(),
      retryable: value.retryable,
      instanceOfCoreClass: value instanceof OtpApiError,
    };
  }
  if (value instanceof Error)
    return { thrown: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
};

const summarize = (calls: RecordedRequest[]) =>
  calls.map((c) => ({
    method: c.method,
    path: c.url.pathname,
    authorization: c.headers.get("authorization"),
    idempotencyKey: c.headers.get("idempotency-key"),
    body: c.body,
    aborted: c.signal.aborted,
  }));

/** A mock API answering requests in order with `handlers`. */
const mockApi = (handlers: Handler[]) => {
  const queue = [...handlers];
  return mockFetch((request) => {
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${request.url.pathname}`);
    return next(request);
  });
};

let mounted: Harness[] = [];
afterEach(() => {
  for (const harness of mounted) harness.unmount();
  mounted = [];
});

type Setup = { handlers: Handler[]; client?: Partial<OtpClientOptions> };

const mount = (driver: Driver, setup: Setup) => {
  const { fetch, calls } = mockApi(setup.handlers);
  const client = createOtpClient({
    apiKey: "pk_test_parity",
    baseUrl: "http://localhost:8788/v1",
    fetch,
    ...setup.client,
  });
  let n = 0;
  const harness = driver.mount(client, {
    now: () => NOW,
    resendCooldownMs: 30_000,
    createIdempotencyKey: () => `flow-key-${++n}`,
  });
  mounted.push(harness);
  return { harness, calls };
};

/** Runs `scenario` against every adapter and asserts identical traces. */
const parity = async (
  scenario: (driver: Driver) => Promise<unknown>,
): Promise<unknown> => {
  const traces: Record<string, unknown> = {};
  for (const driver of drivers) {
    traces[driver.name] = normalize(await scenario(driver));
  }
  expect(traces.vue).toEqual(traces.react);
  expect(traces.svelte).toEqual(traces.react);
  return traces.react;
};

describe("parity: operations", () => {
  test("issue: loading -> success, same request on the wire", async () => {
    const trace = (await parity(async (driver) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const { harness, calls } = mount(driver, {
        handlers: [
          async () => {
            await gate;
            return json(200, issueOutput);
          },
        ],
      });
      const idle = harness.snapshot();
      const promise = harness.start((api) => api.issue(issueInput));
      const loading = harness.snapshot();
      release();
      const result = await harness.settle(promise);
      return {
        idle: idle.issue,
        loading: { issue: loading.issue, any: loading.loading },
        result,
        final: harness.snapshot().issue,
        calls: summarize(calls),
      };
    })) as Record<string, unknown>;
    expect(trace.loading).toEqual({
      issue: {
        status: "loading",
        isLoading: true,
        data: undefined,
        error: undefined,
      },
      any: true,
    });
    expect(trace.result).toEqual({ data: issueOutput, error: undefined });
    expect(trace.final).toEqual({
      status: "success",
      isLoading: false,
      data: issueOutput,
      error: undefined,
    });
    expect(trace.calls).toEqual([
      {
        method: "POST",
        path: "/v1/issue",
        authorization: "Bearer pk_test_parity",
        idempotencyKey: "parity-key-1",
        body: issueInput,
        aborted: false,
      },
    ]);
  });

  test("verify: success and verified:false are results, not errors", async () => {
    const mismatch = {
      ...verifyOutput,
      verified: false,
      reasonCode: "MISMATCH",
      verifiedAt: undefined,
      attemptsRemaining: 3,
    };
    const trace = (await parity(async (driver) => {
      const { harness } = mount(driver, {
        handlers: [() => json(200, mismatch), () => json(200, verifyOutput)],
      });
      const input = { issueId: issueOutput.issueId, code: "000000" };
      const first = await harness.run((api) => api.verify(input));
      const afterFirst = harness.snapshot().verify;
      const second = await harness.run((api) => api.verify(input));
      return { first, afterFirst, second, final: harness.snapshot().verify };
    })) as Record<string, { data?: unknown; status?: string }>;
    expect(trace.first?.data).toEqual(JSON.parse(JSON.stringify(mismatch)));
    expect(trace.afterFirst?.status).toBe("success");
    expect(trace.final?.data).toEqual(verifyOutput);
  });

  const errorCases: [string, Setup, OtpApiError["code"]][] = [
    [
      "400 BAD_REQUEST envelope",
      { handlers: [() => errorEnvelope(400, "BAD_REQUEST", "Invalid phone")] },
      "BAD_REQUEST",
    ],
    [
      "401 UNAUTHORIZED",
      { handlers: [() => errorEnvelope(401, "UNAUTHORIZED", "Unknown key")] },
      "UNAUTHORIZED",
    ],
    [
      "402 PAYMENT_REQUIRED with data",
      {
        handlers: [
          () =>
            errorEnvelope(402, "PAYMENT_REQUIRED", "Insufficient credit", {
              code: "INSUFFICIENT_CREDIT",
            }),
        ],
      },
      "PAYMENT_REQUIRED",
    ],
    [
      "403 FORBIDDEN (Origin not allowed) with request id",
      {
        handlers: [
          () =>
            errorEnvelope(403, "FORBIDDEN", "Origin not allowed", undefined, {
              "x-request-id": "req_123",
            }),
        ],
      },
      "FORBIDDEN",
    ],
    [
      "409 CONFLICT",
      { handlers: [() => errorEnvelope(409, "CONFLICT", "Key reused")] },
      "CONFLICT",
    ],
    [
      "429 with Retry-After",
      {
        handlers: [
          () =>
            errorEnvelope(429, "TOO_MANY_REQUESTS", "Slow down", undefined, {
              "retry-after": "7",
            }),
        ],
      },
      "TOO_MANY_REQUESTS",
    ],
    [
      "500 INTERNAL_SERVER_ERROR",
      { handlers: [() => errorEnvelope(500, "INTERNAL_SERVER_ERROR", "Oops")] },
      "INTERNAL_SERVER_ERROR",
    ],
    [
      "503 non-JSON gateway page",
      {
        handlers: [
          () =>
            new Response("<html>Bad gateway</html>", {
              status: 503,
              headers: { "content-type": "text/html" },
            }),
        ],
      },
      "SERVICE_UNAVAILABLE",
    ],
    [
      "network failure",
      { handlers: [() => Promise.reject(new TypeError("fetch failed"))] },
      "NETWORK_ERROR",
    ],
    [
      "timeout",
      {
        handlers: [(request) => hangUntilAborted(request.signal)],
        client: { timeoutMs: 20 },
      },
      "TIMEOUT",
    ],
  ];

  test.each(errorCases)(
    "issue error %s: identical normalized error in every adapter and core",
    async (_name, setup, code) => {
      const trace = (await parity(async (driver) => {
        const { harness, calls } = mount(driver, setup);
        const result = await harness.run((api) => api.issue(issueInput));
        const snapshot = harness.snapshot();
        return {
          result,
          issue: snapshot.issue,
          error: snapshot.error,
          loading: snapshot.loading,
          calls: summarize(calls).length,
        };
      })) as { result: { error: unknown }; issue: { error: unknown } };

      // The adapters surface exactly what sdk-core rejects with.
      const { fetch } = mockApi(setup.handlers);
      const coreError = await createOtpClient({
        apiKey: "pk_test_parity",
        baseUrl: "http://localhost:8788/v1",
        fetch,
        ...setup.client,
      })
        .issue(issueInput)
        .catch((e: unknown) => e);
      expect(trace.result.error).toEqual(normalize(coreError));
      expect(trace.issue.error).toEqual(normalize(coreError));
      expect((coreError as OtpApiError).code).toBe(code);
    },
  );

  test("client-side idempotency key validation: BAD_REQUEST, no request", async () => {
    const trace = (await parity(async (driver) => {
      const { harness, calls } = mount(driver, { handlers: [] });
      const result = await harness.run((api) =>
        api.issue({ ...issueInput, idempotencyKey: "  " }),
      );
      return { result, calls: calls.length };
    })) as { result: { error: { otpApiError: unknown } }; calls: number };
    expect(trace.calls).toBe(0);
    expect(trace.result.error.otpApiError).toEqual({
      name: "OtpApiError",
      code: "BAD_REQUEST",
      status: 400,
      message: "idempotencyKey is required for issue requests",
    });
  });

  test("stale responses from superseded calls are ignored", async () => {
    const trace = (await parity(async (driver) => {
      let releaseFirst!: () => void;
      const first = new Promise<void>((r) => {
        releaseFirst = r;
      });
      const { harness } = mount(driver, {
        handlers: [
          async () => {
            await first;
            return json(200, { ...issueOutput, issueId: "first" });
          },
          () => json(200, { ...issueOutput, issueId: "second" }),
        ],
      });
      const a = harness.start((api) => api.issue(issueInput));
      const b = harness.start((api) =>
        api.issue({ ...issueInput, idempotencyKey: "parity-key-2" }),
      );
      const second = await harness.settle(b);
      releaseFirst();
      const firstResult = await harness.settle(a);
      return {
        firstResult,
        second,
        state: harness.snapshot().issue,
      };
    })) as {
      firstResult: { data: { issueId: string } };
      state: { data: { issueId: string } };
    };
    expect(trace.firstResult.data.issueId).toBe("first");
    expect(trace.state.data.issueId).toBe("second");
  });

  test("reset clears data/error; combined loading/error", async () => {
    const trace = await parity(async (driver) => {
      const { harness } = mount(driver, {
        handlers: [
          () => errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy"),
          (request) => hangUntilAborted(request.signal),
        ],
      });
      await harness.run((api) => api.issue(issueInput));
      const afterError = harness.snapshot();
      const verifying = harness.start((api) =>
        api.verify({ issueId: "i", code: "123456" }),
      );
      const whileVerifying = harness.snapshot();
      await harness.run(async (api) => api.reset());
      const aborted = await harness.settle(verifying);
      const afterReset = harness.snapshot();
      return {
        combinedAfterError: {
          loading: afterError.loading,
          error: afterError.error,
        },
        whileVerifying: {
          loading: whileVerifying.loading,
          error: whileVerifying.error,
        },
        aborted,
        afterReset: {
          issue: afterReset.issue,
          verify: afterReset.verify,
          loading: afterReset.loading,
          error: afterReset.error,
        },
      };
    });
    const t = trace as {
      whileVerifying: { loading: boolean };
      aborted: { error: { otpApiError: { code: string } } };
      afterReset: { issue: { status: string }; error: unknown };
    };
    expect(t.whileVerifying.loading).toBe(true);
    expect(t.aborted.error.otpApiError.code).toBe("ABORTED");
    expect(t.afterReset.issue.status).toBe("idle");
    expect(t.afterReset.error).toBeUndefined();
  });

  test("unmount aborts in-flight requests", async () => {
    const trace = await parity(async (driver) => {
      const { harness, calls } = mount(driver, {
        handlers: [(request) => hangUntilAborted(request.signal)],
      });
      const pending = harness.start((api) => api.issue(issueInput));
      await Bun.sleep(0);
      harness.unmount();
      const result = await pending;
      return { result, aborted: calls.map((c) => c.signal.aborted) };
    });
    expect(trace).toMatchObject({
      aborted: [true],
      result: { error: { otpApiError: { code: "ABORTED" } } },
    });
  });
});

describe("parity: issue -> verify flow", () => {
  test("key reuse after an ambiguous failure, verify, local cooldown", async () => {
    const trace = (await parity(async (driver) => {
      const { harness, calls } = mount(driver, {
        handlers: [
          () => errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy"),
          () => json(200, issueOutput),
          () =>
            json(200, {
              ...verifyOutput,
              verified: false,
              reasonCode: "MISMATCH",
              verifiedAt: undefined,
              attemptsRemaining: 4,
            }),
          () => json(200, { ...verifyOutput, attemptsRemaining: 3 }),
        ],
      });
      const steps: unknown[] = [];
      const step = async (fn: Parameters<Harness["run"]>[0]) => {
        const result = await harness.run(fn);
        steps.push({ result, state: harness.snapshot().flow });
      };
      await step((api) => api.send(sendInput));
      await step((api) => api.send(sendInput));
      await step((api) => api.verifyCode("000000"));
      await step((api) => api.verifyCode("123456"));
      await step((api) => api.resend());
      return { steps, calls: summarize(calls) };
    })) as {
      steps: {
        result: Record<string, unknown>;
        state: Record<string, unknown>;
      }[];
      calls: { idempotencyKey: string | null; path: string }[];
    };
    const [failed, sent, mismatch, verified, skipped] = trace.steps;
    expect(failed?.state.idempotencyKey).toBe("flow-key-1");
    expect(failed?.state.error).toMatchObject({
      otpApiError: { code: "SERVICE_UNAVAILABLE" },
    });
    expect(sent?.state).toMatchObject({
      issueId: issueOutput.issueId,
      idempotencyKey: undefined,
      canSend: false,
      cooldownRemainingMs: 30_000,
      canVerify: true,
    });
    expect(mismatch?.state).toMatchObject({
      reasonCode: "MISMATCH",
      attemptsRemaining: 4,
      verified: false,
      canVerify: true,
    });
    expect(verified?.state).toMatchObject({ verified: true, canVerify: false });
    expect(skipped?.result).toEqual({
      data: undefined,
      error: undefined,
      skipped: "cooldown",
    });
    expect(trace.calls.map((c) => [c.path, c.idempotencyKey])).toEqual([
      ["/v1/issue", "flow-key-1"],
      ["/v1/issue", "flow-key-1"],
      ["/v1/verify", null],
      ["/v1/verify", null],
    ]);
  });

  test("429 retryAfterMs becomes the cooldown; 402 drops the key", async () => {
    const trace = (await parity(async (driver) => {
      const { harness, calls } = mount(driver, {
        handlers: [
          () =>
            errorEnvelope(402, "PAYMENT_REQUIRED", "No credit", {
              code: "OVERDRAFT_LIMIT_EXCEEDED",
            }),
          () =>
            errorEnvelope(429, "TOO_MANY_REQUESTS", "Slow down", {
              retryAfterMs: 45_000,
            }),
        ],
      });
      const payment = await harness.run((api) => api.send(sendInput));
      const afterPayment = harness.snapshot().flow;
      const limited = await harness.run((api) => api.send(sendInput));
      const afterLimit = harness.snapshot().flow;
      const skipped = await harness.run((api) => api.send(sendInput));
      return {
        payment,
        afterPayment,
        limited,
        afterLimit,
        skipped,
        keys: calls.map((c) => c.headers.get("idempotency-key")),
      };
    })) as Record<string, Record<string, unknown>> & { keys: string[] };
    expect(trace.afterPayment?.idempotencyKey).toBeUndefined();
    expect(trace.afterPayment?.canSend).toBe(true);
    expect(trace.payment?.error).toMatchObject({
      otpApiError: { data: { code: "OVERDRAFT_LIMIT_EXCEEDED" } },
    });
    expect(trace.afterLimit).toMatchObject({
      idempotencyKey: "flow-key-2",
      cooldownRemainingMs: 45_000,
      cooldownUntil: NOW + 45_000,
      canSend: false,
    });
    expect(trace.skipped?.skipped).toBe("cooldown");
    expect(trace.keys).toEqual(["flow-key-1", "flow-key-2"]);
  });

  test("reset clears the flow but keeps the cooldown", async () => {
    const trace = (await parity(async (driver) => {
      const { harness } = mount(driver, {
        handlers: [() => json(200, issueOutput)],
      });
      await harness.run((api) => api.send(sendInput));
      await harness.run(async (api) => api.resetFlow());
      return harness.snapshot().flow;
    })) as Record<string, unknown>;
    expect(trace).toMatchObject({
      issueId: undefined,
      canVerify: false,
      cooldownRemainingMs: 30_000,
    });
  });
});
