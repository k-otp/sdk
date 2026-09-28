import { describe, expect, test } from "bun:test";
import { createOtpClient, OtpApiError } from "../src/index";
import { createOtpFlow, createOtpOperation } from "../src/internal";
import {
  errorEnvelope,
  hangUntilAborted,
  issueOutput,
  json,
  mockFetch,
  verifyOutput,
} from "./helpers";

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const apiError = (code: "SERVICE_UNAVAILABLE" | "BAD_REQUEST") =>
  new OtpApiError({
    code,
    status: code === "BAD_REQUEST" ? 400 : 503,
    message: code,
  });

describe("createOtpOperation", () => {
  test("idle -> loading -> success, notifying subscribers", async () => {
    const op = createOtpOperation(async (n: number) => n * 2);
    const seen: string[] = [];
    op.subscribe(() => seen.push(op.getState().status));
    expect(op.getState()).toEqual({
      status: "idle",
      isLoading: false,
      data: undefined,
      error: undefined,
    });
    const promise = op.run(21);
    expect(op.getState().isLoading).toBe(true);
    expect(await promise).toEqual({ data: 42, error: undefined });
    expect(op.getState()).toEqual({
      status: "success",
      isLoading: false,
      data: 42,
      error: undefined,
    });
    expect(seen).toEqual(["loading", "success"]);
  });

  test("API errors resolve with the normalized error and are stored", async () => {
    const error = apiError("SERVICE_UNAVAILABLE");
    const op = createOtpOperation(async () => {
      throw error;
    });
    const result = await op.run(undefined);
    expect(result).toEqual({ data: undefined, error });
    expect(op.getState().status).toBe("error");
    expect(op.getState().error).toBe(error);
  });

  test("configuration errors (TypeError) reject and leave the state idle", async () => {
    const op = createOtpOperation(async () => {
      throw new TypeError("apiKey is required");
    });
    const error = await op.run(undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(op.getState().status).toBe("idle");
  });

  test("ignores results of superseded calls", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const op = createOtpOperation(() => {
      const next = queue.shift();
      if (!next) throw new Error("unexpected call");
      return next.promise;
    });
    const a = op.run(undefined);
    const b = op.run(undefined);
    second.resolve("second");
    await b;
    first.resolve("first");
    expect(await a).toEqual({ data: "first", error: undefined });
    expect(op.getState().data).toBe("second");
  });

  test("reset aborts in-flight calls and returns to idle", async () => {
    const { fetch, calls } = mockFetch((r) => hangUntilAborted(r.signal));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const op = createOtpOperation(
      (input: { issueId: string; code: string }, o) => client.verify(input, o),
    );
    const promise = op.run({ issueId: "i", code: "123456" });
    await Bun.sleep(0);
    op.reset();
    const result = await promise;
    expect(result.error?.code).toBe("ABORTED");
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(op.getState().status).toBe("idle");
  });

  test("abort cancels without writing the outcome to state", async () => {
    const { fetch } = mockFetch((r) => hangUntilAborted(r.signal));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const op = createOtpOperation(
      (input: { issueId: string; code: string }, o) => client.verify(input, o),
    );
    const promise = op.run({ issueId: "i", code: "123456" });
    op.abort();
    expect((await promise).error?.code).toBe("ABORTED");
    expect(op.getState().status).toBe("idle");
  });

  test("honors the caller's AbortSignal", async () => {
    const { fetch } = mockFetch((r) => hangUntilAborted(r.signal));
    const client = createOtpClient({ apiKey: "pk_test", fetch });
    const op = createOtpOperation(
      (input: { issueId: string; code: string }, o) => client.verify(input, o),
    );
    const controller = new AbortController();
    const promise = op.run(
      { issueId: "i", code: "1" },
      { signal: controller.signal },
    );
    controller.abort();
    expect((await promise).error?.code).toBe("ABORTED");
    expect(op.getState().error?.code).toBe("ABORTED");
  });
});

describe("createOtpFlow", () => {
  const sendInput = { phoneNumber: "01012345678", purpose: "signup" };

  const setup = (
    handler: Parameters<typeof mockFetch>[0],
    options: Parameters<typeof createOtpFlow>[1] = {},
  ) => {
    const { fetch, calls } = mockFetch(handler);
    let n = 0;
    const flow = createOtpFlow(createOtpClient({ apiKey: "pk_test", fetch }), {
      createIdempotencyKey: () => `key-${++n}`,
      ...options,
    });
    const keys = () =>
      calls
        .filter((c) => c.url.pathname.endsWith("/issue"))
        .map((c) => c.headers.get("idempotency-key"));
    return { flow, calls, keys };
  };

  test("send -> verify happy path", async () => {
    const { flow, calls } = setup((r) =>
      r.url.pathname.endsWith("/issue")
        ? json(200, issueOutput)
        : json(200, verifyOutput),
    );
    const sent = await flow.send(sendInput);
    expect(sent.data).toEqual(issueOutput);
    let state = flow.getState();
    expect(state.issueId).toBe(issueOutput.issueId);
    expect(state.canVerify).toBe(true);
    expect(state.idempotencyKey).toBeUndefined();
    const verified = await flow.verify("123456");
    expect(verified.data).toEqual(verifyOutput);
    state = flow.getState();
    expect(state.verified).toBe(true);
    expect(state.canVerify).toBe(false);
    expect(state.attemptsRemaining).toBe(4);
    expect(calls[1]?.body).toEqual({
      issueId: issueOutput.issueId,
      code: "123456",
    });
  });

  test("reuses the idempotency key after ambiguous failures of the same input", async () => {
    const responses = [
      () => errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy"),
      () => Promise.reject(new TypeError("fetch failed")),
      () => json(200, issueOutput),
      () => json(200, issueOutput),
    ];
    const { flow, keys } = setup(() => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    });
    expect((await flow.send(sendInput)).error?.code).toBe(
      "SERVICE_UNAVAILABLE",
    );
    expect(flow.getState().idempotencyKey).toBe("key-1");
    expect((await flow.send(sendInput)).error?.code).toBe("NETWORK_ERROR");
    expect((await flow.send(sendInput)).data).toEqual(issueOutput);
    expect(flow.getState().idempotencyKey).toBeUndefined();
    // A deliberate new send after a success is a new attempt.
    await flow.resend();
    expect(keys()).toEqual(["key-1", "key-1", "key-1", "key-2"]);
  });

  test("mints a new key when the input changes or after a definitive failure", async () => {
    const responses = [
      () => errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy"),
      () =>
        errorEnvelope(402, "PAYMENT_REQUIRED", "no credit", {
          code: "INSUFFICIENT_CREDIT",
        }),
      () => json(200, issueOutput),
    ];
    const { flow, keys } = setup(() => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    });
    await flow.send(sendInput);
    const payment = await flow.send({
      ...sendInput,
      phoneNumber: "01099998888",
    });
    expect(payment.error?.code).toBe("PAYMENT_REQUIRED");
    expect(payment.error?.data).toEqual({ code: "INSUFFICIENT_CREDIT" });
    expect(flow.getState().idempotencyKey).toBeUndefined();
    await flow.send({ ...sendInput, phoneNumber: "01099998888" });
    expect(keys()).toEqual(["key-1", "key-2", "key-3"]);
  });

  test("input comparison ignores object key order", async () => {
    const responses = [
      () => errorEnvelope(503, "SERVICE_UNAVAILABLE", "busy"),
      () => json(200, issueOutput),
    ];
    const { flow, keys } = setup(() => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    });
    await flow.send({ ...sendInput, templateVariables: { a: "1", b: "2" } });
    await flow.send({
      templateVariables: { b: "2", a: "1" },
      purpose: "signup",
      phoneNumber: "01012345678",
    });
    expect(keys()).toEqual(["key-1", "key-1"]);
  });

  test("applies the local cooldown after a successful send", async () => {
    let clock = 1_000_000;
    const { flow, calls } = setup(() => json(200, issueOutput), {
      resendCooldownMs: 30_000,
      now: () => clock,
    });
    await flow.send(sendInput);
    let state = flow.getState();
    expect(state.canSend).toBe(false);
    expect(state.cooldownRemainingMs).toBe(30_000);
    expect(state.cooldownUntil).toBe(1_030_000);
    expect(await flow.resend()).toEqual({
      data: undefined,
      error: undefined,
      skipped: "cooldown",
    });
    clock += 30_000;
    state = flow.getState();
    expect(state.canSend).toBe(true);
    expect(state.cooldownRemainingMs).toBe(0);
    expect((await flow.resend()).data).toEqual(issueOutput);
    expect(calls).toHaveLength(2);
  });

  test("applies the server retryAfterMs (429) as a cooldown and keeps the key", async () => {
    let clock = 0;
    const { flow } = setup(
      () =>
        errorEnvelope(429, "TOO_MANY_REQUESTS", "slow down", undefined, {
          "retry-after": "12",
        }),
      { now: () => clock },
    );
    const result = await flow.send(sendInput);
    expect(result.error?.retryAfterMs).toBe(12_000);
    const state = flow.getState();
    expect(state.cooldownRemainingMs).toBe(12_000);
    expect(state.canSend).toBe(false);
    expect(state.error?.code).toBe("TOO_MANY_REQUESTS");
    expect(state.idempotencyKey).toBe("key-1");
    clock = 12_000;
    expect(flow.getState().canSend).toBe(true);
  });

  test("skips verify before any send and send while busy", async () => {
    const { flow } = setup((r) => hangUntilAborted(r.signal));
    expect(await flow.verify("123456")).toEqual({
      data: undefined,
      error: undefined,
      skipped: "no-issue",
    });
    expect((await flow.resend()).skipped).toBe("no-previous-send");
    const first = flow.send(sendInput);
    expect(flow.getState().isLoading).toBe(true);
    expect(flow.getState().canSend).toBe(false);
    expect((await flow.send(sendInput)).skipped).toBe("busy");
    flow.abort();
    expect((await first).error?.code).toBe("ABORTED");
  });

  test("terminal verify reasons disable verify until a new send", async () => {
    const { flow } = setup((r) =>
      r.url.pathname.endsWith("/issue")
        ? json(200, issueOutput)
        : json(200, {
            ...verifyOutput,
            verified: false,
            reasonCode: "EXPIRED",
            verifiedAt: undefined,
            attemptsRemaining: 0,
          }),
    );
    await flow.send(sendInput);
    await flow.verify("123456");
    let state = flow.getState();
    expect(state.verified).toBe(false);
    expect(state.reasonCode).toBe("EXPIRED");
    expect(state.canVerify).toBe(false);
    expect(state.error).toBeUndefined();
    await flow.resend();
    state = flow.getState();
    expect(state.reasonCode).toBeUndefined();
    expect(state.verify.status).toBe("idle");
    expect(state.canVerify).toBe(true);
  });

  test("reset clears the flow but keeps the cooldown", async () => {
    let clock = 0;
    const { flow } = setup(() => json(200, issueOutput), {
      resendCooldownMs: 5_000,
      now: () => clock,
    });
    await flow.send(sendInput);
    flow.reset();
    const state = flow.getState();
    expect(state.issueId).toBeUndefined();
    expect(state.issue.status).toBe("idle");
    expect(state.cooldownRemainingMs).toBe(5_000);
    clock = 5_000;
    expect(flow.getState().canSend).toBe(true);
  });

  test("ticks cooldownRemainingMs while subscribed", async () => {
    const { flow } = setup(() => json(200, issueOutput), {
      resendCooldownMs: 120,
    });
    const updates: number[] = [];
    const unsubscribe = flow.subscribe(() =>
      updates.push(flow.getState().cooldownRemainingMs),
    );
    await flow.send(sendInput);
    await Bun.sleep(200);
    unsubscribe();
    expect(updates.at(-1)).toBe(0);
    expect(flow.getState().canSend).toBe(true);
  });

  test("getState returns a stable snapshot between changes", async () => {
    const { flow } = setup(() => json(200, issueOutput));
    const unsubscribe = flow.subscribe(() => {});
    expect(flow.getState()).toBe(flow.getState());
    await flow.send(sendInput);
    expect(flow.getState()).toBe(flow.getState());
    unsubscribe();
  });

  test("results that settle after reset are ignored", async () => {
    const gate = deferred<Response>();
    const { flow } = setup(() => gate.promise);
    const pending = flow.send(sendInput);
    flow.reset();
    gate.resolve(json(200, issueOutput));
    await pending;
    expect(flow.getState().issueId).toBeUndefined();
  });

  test("uses a prefixed random key by default", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const flow = createOtpFlow(createOtpClient({ apiKey: "pk_test", fetch }), {
      idempotencyKeyPrefix: "signup",
    });
    await flow.send(sendInput);
    expect(calls[0]?.headers.get("idempotency-key")).toMatch(
      /^signup-[0-9a-f-]{36}$/,
    );
  });

  test("validation failures of the key surface as BAD_REQUEST without a request", async () => {
    const { fetch, calls } = mockFetch(() => json(200, issueOutput));
    const flow = createOtpFlow(createOtpClient({ apiKey: "pk_test", fetch }), {
      createIdempotencyKey: () => "has spaces",
    });
    const result = await flow.send(sendInput);
    expect(result.error?.code).toBe("BAD_REQUEST");
    expect(calls).toHaveLength(0);
    expect(flow.getState().idempotencyKey).toBeUndefined();
    expect(apiError("BAD_REQUEST").retryable).toBe(false);
  });
});
