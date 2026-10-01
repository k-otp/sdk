import { describe, expect, mock, test } from "bun:test";
import type {
  IssueInput,
  IssueResult,
  VerifyInput,
  VerifyResult,
} from "../src/core";
import { OtpApiError } from "../src/core";
import type { OtpIssueVerifyClient } from "../src/headless";
import {
  createOtpForm,
  createOtpTranslator,
  getOtpFormParts,
  type OtpFormOptions,
  type OtpFormPhase,
} from "../src/ui";

const issued = (n = 1): IssueResult => ({
  issueId: `issue-${n}`,
  queuedAt: "2026-01-01T00:00:00.000Z",
  // 180 s after queuedAt, whatever the client clock says.
  expiresAt: "2026-01-01T00:03:00.000Z",
  attemptsRemaining: 5,
});

const verified = (input: VerifyInput, ok: boolean): VerifyResult => ({
  issueId: input.issueId,
  verified: ok,
  ...(ok ? { verifiedAt: "2026-01-01T00:01:00.000Z" } : {}),
  ...(ok ? {} : { reasonCode: "MISMATCH" as const }),
  attemptsRemaining: ok ? 5 : 4,
  expiresAt: "2026-01-01T00:03:00.000Z",
});

type Step = (input: never, options: { signal?: AbortSignal }) => unknown;

/** A client whose next answers can be scripted; defaults succeed. */
const scripted = () => {
  const issues: IssueInput[] = [];
  const verifies: VerifyInput[] = [];
  const next = { issue: [] as Step[], verify: [] as Step[] };
  let count = 0;
  const client: OtpIssueVerifyClient = {
    issue: async (input, options = {}) => {
      issues.push(input);
      const step = next.issue.shift();
      if (step) {
        return (step as (i: IssueInput, o: typeof options) => IssueResult)(
          input,
          options,
        );
      }
      count++;
      return issued(count);
    },
    verify: async (input, options = {}) => {
      verifies.push(input);
      const step = next.verify.shift();
      if (step) {
        return (step as (i: VerifyInput, o: typeof options) => VerifyResult)(
          input,
          options,
        );
      }
      return verified(input, input.code === "123456");
    },
  };
  return { client, issues, verifies, next };
};

const apiError = (
  code: OtpApiError["code"],
  status: number,
  retryAfterMs?: number,
) =>
  (() => {
    throw new OtpApiError({ code, status, message: code, retryAfterMs });
  }) as Step;

/** Hangs until the request is aborted, then rejects like the SDK does. */
const hang = ((_input: unknown, options: { signal?: AbortSignal }) =>
  new Promise((_, reject) => {
    options.signal?.addEventListener("abort", () =>
      reject(
        new OtpApiError({ code: "ABORTED", status: 0, message: "aborted" }),
      ),
    );
  })) as Step;

/** Answers with `value` once `release()` is called (ignores aborts). */
const deferred = <T>(value: () => T) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const step = (async () => {
    await gate;
    return value();
  }) as Step;
  return { step, release: () => release() };
};

/** Lets pending promise callbacks run. */
const microtasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Runs `fn` with WebOTP available; `get` answers credential requests. */
const withWebOtp = async (
  get: (options: unknown) => Promise<unknown>,
  fn: () => Promise<void>,
): Promise<void> => {
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    window: globals.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  globals.window = { OTPCredential: class {} };
  Object.defineProperty(globalThis, "navigator", {
    value: { credentials: { get } },
    configurable: true,
  });
  try {
    await fn();
  } finally {
    globals.window = saved.window;
    if (saved.navigator) {
      Object.defineProperty(globalThis, "navigator", saved.navigator);
    }
  }
};

const setup = (options: Partial<OtpFormOptions> = {}) => {
  let clock = 1_000_000;
  const api = scripted();
  const phases: OtpFormPhase[] = [];
  const form = createOtpForm(api.client, {
    purpose: "signup",
    now: () => clock,
    onPhaseChange: (phase) => phases.push(phase),
    webOtp: false,
    ...options,
  });
  return {
    ...api,
    form,
    phases,
    tick: (ms: number) => {
      clock += ms;
    },
  };
};

describe("createOtpForm", () => {
  test("starts in the phone phase without any I/O or timer", () => {
    const realSetTimeout = globalThis.setTimeout;
    const timers = mock();
    globalThis.setTimeout = timers as unknown as typeof setTimeout;
    try {
      const { form, issues } = setup();
      const state = form.getState();
      expect(state).toMatchObject({
        phase: "phone",
        phoneNumber: "",
        issued: false,
        canSend: false,
        canVerify: false,
        sendDisabled: false,
        verifyDisabled: true,
        resendIn: 0,
        retryIn: 0,
        expiresIn: undefined,
        message: undefined,
        focus: undefined,
        codeLength: 6,
      });
      // Snapshots are cached (useSyncExternalStore contract).
      expect(form.getState()).toBe(state);
      expect(issues).toHaveLength(0);
      expect(timers).not.toHaveBeenCalled();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("an invalid number is reported and never sent", async () => {
    const { form, issues } = setup();
    form.setPhoneNumber("02-123-4567");
    expect(form.getState().phoneError).toBeUndefined();
    const result = await form.send();
    expect(result.skipped).toBe("invalid");
    expect(issues).toHaveLength(0);
    expect(form.getState()).toMatchObject({
      phoneError: "phone.error.not-mobile",
      focus: { target: "phone", seq: 1 },
    });
    // The error follows the input once shown.
    form.setPhoneNumber("010-1234-5678");
    expect(form.getState().phoneError).toBeUndefined();
    expect(form.getState().canSend).toBe(true);
  });

  test("send: canonical number, issue fields, expiry, cooldown and focus", async () => {
    const onSent = mock();
    const { form, issues, phases } = setup({
      onSent,
      issue: { channel: "sms", templateId: "otp_signup_kr" },
      idempotencyKeyPrefix: "signup",
    });
    form.setPhoneNumber("+82 10 1234 5678");
    expect(form.getState().phoneNumber).toBe("+82 10-1234-5678");
    const sending = form.send();
    expect(form.getState().phase).toBe("sending");
    expect(form.getState().phoneLocked).toBe(true);
    const result = await sending;
    expect(result.data?.issueId).toBe("issue-1");
    expect(issues[0]).toMatchObject({
      phoneNumber: "01012345678",
      purpose: "signup",
      channel: "sms",
      templateId: "otp_signup_kr",
    });
    expect(issues[0]?.idempotencyKey).toStartWith("signup");
    expect(onSent).toHaveBeenCalledWith(issued(1));
    expect(form.getState()).toMatchObject({
      phase: "code",
      issued: true,
      sentTo: "010-****-5678",
      phoneLocked: true,
      resendIn: 30,
      expiresIn: 180,
      expired: false,
      attemptsRemaining: 5,
      sendDisabled: true,
      verifyDisabled: false,
      canVerify: false,
      focus: { target: "code", seq: 1 },
      message: {
        key: "status.sent",
        params: { phone: "010-****-5678" },
        tone: "info",
      },
    });
    // The input is locked while a code is out.
    form.setPhoneNumber("01099998888");
    expect(form.getState().phoneNumber).toBe("+82 10-1234-5678");
    expect(phases).toEqual(["sending", "code"]);
  });

  test("auto-submit verifies a complete code; MISMATCH clears it and refocuses", async () => {
    const onVerified = mock();
    const { form, verifies, phases } = setup({ onVerified });
    form.setPhoneNumber("01012345678");
    await form.send();
    form.setCode("12 34");
    expect(form.getState()).toMatchObject({
      code: "1234",
      codeComplete: false,
    });
    expect(verifies).toHaveLength(0);
    form.setCode("111111");
    expect(form.getState().phase).toBe("verifying");
    await Bun.sleep(0);
    expect(verifies[0]).toEqual({ issueId: "issue-1", code: "111111" });
    expect(form.getState()).toMatchObject({
      phase: "code",
      code: "",
      reasonCode: "MISMATCH",
      attemptsRemaining: 4,
      focus: { target: "code", seq: 2 },
      message: {
        key: "reason.MISMATCH",
        params: { attempts: 4 },
        tone: "error",
      },
    });
    form.setCode("１２３４５６");
    await Bun.sleep(0);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(form.getState()).toMatchObject({
      phase: "verified",
      verified: true,
      sendDisabled: true,
      verifyDisabled: true,
      focus: { target: "message", seq: 3 },
      message: { key: "status.verified", tone: "success" },
    });
    expect(phases).toEqual([
      "sending",
      "code",
      "verifying",
      "code",
      "verifying",
      "verified",
    ]);
  });

  test("an incomplete code is not verified", async () => {
    const { form, verifies } = setup({ autoSubmit: false });
    form.setPhoneNumber("01012345678");
    await form.send();
    form.setCode("123456");
    expect(verifies).toHaveLength(0);
    form.setCode("123");
    const result = await form.verify();
    expect(result.skipped).toBe("invalid");
    expect(form.getState().codeError).toBe("code.error.incomplete");
    expect(verifies).toHaveLength(0);
  });

  test("429 on send: server cooldown, retry pending, error message", async () => {
    const onError = mock();
    const { form, next, issues, tick } = setup({ onError });
    next.issue.push(apiError("TOO_MANY_REQUESTS", 429, 12_000));
    form.setPhoneNumber("01012345678");
    await form.send();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe("send");
    expect(form.getState()).toMatchObject({
      phase: "phone",
      issued: false,
      resendIn: 12,
      sendDisabled: true,
      canSend: false,
      retryPending: true,
      errorOperation: "send",
      message: { key: "error.TOO_MANY_REQUESTS", tone: "error" },
    });
    // The button is disabled, but a submit still reaches the flow: skipped.
    const skipped = await form.send();
    expect(skipped.skipped).toBe("cooldown");
    expect(issues).toHaveLength(1);
    tick(12_000);
    expect(form.getState().resendIn).toBe(0);
    await form.send();
    // Same input after a retryable failure: the same idempotency key.
    expect(issues[1]?.idempotencyKey).toBe(issues[0]?.idempotencyKey);
    expect(form.getState().phase).toBe("code");
  });

  test("503 on send is ambiguous: sendUncertain and the same key on retry", async () => {
    const { form, next, issues } = setup();
    next.issue.push(apiError("SERVICE_UNAVAILABLE", 503));
    form.setPhoneNumber("01012345678");
    await form.send();
    expect(form.getState()).toMatchObject({
      phase: "phone",
      retryPending: true,
      resendIn: 0,
      message: { key: "error.sendUncertain" },
    });
    expect(
      getOtpFormParts(form.getState(), {
        id: "f",
        t: createOtpTranslator({ locale: "en" }),
      }).text.sendButton,
    ).toBe("Try again");
    await form.send();
    expect(issues[1]?.idempotencyKey).toBe(issues[0]?.idempotencyKey);
  });

  test("429 and 503 on verify: retryIn countdown, verify skipped meanwhile", async () => {
    const { form, next, verifies, tick } = setup({ autoSubmit: false });
    form.setPhoneNumber("01012345678");
    await form.send();
    form.setCode("123456");
    next.verify.push(apiError("TOO_MANY_REQUESTS", 429, 4_500));
    await form.verify();
    expect(form.getState()).toMatchObject({
      phase: "code",
      retryIn: 5,
      verifyDisabled: true,
      canVerify: false,
      errorOperation: "verify",
      message: { key: "error.TOO_MANY_REQUESTS" },
    });
    expect((await form.verify()).skipped).toBe("cooldown");
    expect(form.getState().message?.key).toBe("error.TOO_MANY_REQUESTS");
    tick(4_500);
    next.verify.push(apiError("SERVICE_UNAVAILABLE", 503, 2_000));
    await form.verify();
    expect(form.getState()).toMatchObject({
      retryIn: 2,
      message: { key: "error.SERVICE_UNAVAILABLE" },
    });
    tick(2_000);
    await form.verify();
    expect(verifies).toHaveLength(3);
    expect(form.getState().phase).toBe("verified");
  });

  test.each([
    "EXPIRED",
    "MAX_ATTEMPTS",
    "REPLACED",
    "NOT_FOUND",
    "ALREADY_VERIFIED",
  ] as const)(
    "terminal reason %s moves to failed; resend starts over",
    async (reasonCode) => {
      const { form, next } = setup();
      form.setPhoneNumber("01012345678");
      await form.send();
      next.verify.push(((input: VerifyInput) => ({
        ...verified(input, false),
        reasonCode,
        attemptsRemaining: 0,
      })) as Step);
      form.setCode("000000");
      await Bun.sleep(0);
      const state = form.getState();
      expect(state).toMatchObject({
        phase: "failed",
        reasonCode,
        verifyDisabled: true,
        focus: { target: "message" },
        message: { key: `reason.${reasonCode}`, tone: "error" },
      });
      const parts = getOtpFormParts(state, {
        id: "f",
        t: createOtpTranslator(),
      });
      // In the failed phase the (re)send button is the submit button.
      expect(parts.sendButton.type).toBe("submit");
      expect(parts.verifyButton.type).toBe("button");
      expect(parts.codeSegments[0]?.readonly).toBe(true);
    },
  );

  test("local expiry, anchored on the server's issue duration", async () => {
    const { form, tick } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    tick(179_001);
    expect(form.getState()).toMatchObject({
      phase: "code",
      expiresIn: 1,
    });
    tick(1_000);
    expect(form.getState()).toMatchObject({
      phase: "failed",
      expiresIn: 0,
      expired: true,
      verifyDisabled: true,
      message: { key: "reason.EXPIRED" },
    });
    // Resending gives a fresh code and countdown.
    await form.send();
    expect(form.getState()).toMatchObject({
      phase: "code",
      expiresIn: 180,
      expired: false,
    });
  });

  test("change number: the local cooldown belongs to the number it was started for", async () => {
    const { form, phases, issues } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    expect(form.getState().resendIn).toBe(30);
    form.setCode("12");
    form.editPhoneNumber();
    expect(form.getState()).toMatchObject({
      phase: "phone",
      issued: false,
      phoneLocked: false,
      phoneNumber: "010-1234-5678",
      code: "",
      // Still the same number: its cooldown keeps running.
      resendIn: 30,
      sendDisabled: true,
      message: undefined,
      focus: { target: "phone" },
    });
    expect((await form.send()).skipped).toBe("cooldown");
    // A different number can be sent to at once.
    form.setPhoneNumber("010-9999-8888");
    expect(form.getState()).toMatchObject({ resendIn: 0, sendDisabled: false });
    form.setPhoneNumber("010-1234-5678");
    expect(form.getState().resendIn).toBe(30);
    form.setPhoneNumber("010-9999-8888");
    expect((await form.send()).data?.issueId).toBe("issue-2");
    expect(issues[1]?.phoneNumber).toBe("01099998888");
    expect(phases).toEqual(["sending", "code", "phone", "sending", "code"]);
    form.reset();
    expect(form.getState()).toMatchObject({ phoneNumber: "", resendIn: 0 });
  });

  test("a send dropped by change number keeps its idempotency key for the same input", async () => {
    const { form, next, issues } = setup();
    next.issue.push(hang);
    form.setPhoneNumber("01012345678");
    const dropped = form.send();
    form.editPhoneNumber();
    await dropped;
    await form.send();
    // The dropped request may have reached the server: same key, no 2nd SMS.
    expect(issues[1]?.idempotencyKey).toBe(issues[0]?.idempotencyKey);
    expect(form.getState().phase).toBe("code");
    // A different number gets a new key.
    form.editPhoneNumber();
    form.setPhoneNumber("01099998888");
    await form.send();
    expect(issues[2]?.idempotencyKey).not.toBe(issues[0]?.idempotencyKey);
  });

  test("a retained key is never reused for another number (send skipped by cooldown)", async () => {
    const { form, next, issues, tick } = setup({ resendCooldownMs: 0 });
    next.issue.push(apiError("SERVICE_UNAVAILABLE", 503, 60_000));
    form.setPhoneNumber("01011112222");
    await form.send();
    // The server wait blocks this send before any request goes out.
    form.setPhoneNumber("01033334444");
    expect((await form.send()).skipped).toBe("cooldown");
    form.reset();
    tick(61_000);
    form.setPhoneNumber("01033334444");
    await form.send();
    expect(issues.map((i) => i.phoneNumber)).toEqual([
      "01011112222",
      "01033334444",
    ]);
    expect(issues[1]?.idempotencyKey).not.toBe(issues[0]?.idempotencyKey);
  });

  test("a retained key is not reused when purpose or issue fields changed", async () => {
    const { form, next, issues } = setup();
    next.issue.push(apiError("TIMEOUT", 0));
    form.setPhoneNumber("01012345678");
    await form.send();
    // The settings change before "change number" (frameworks call configure
    // on every render).
    form.configure({ purpose: "login" });
    form.editPhoneNumber();
    await form.send();
    expect(issues[1]?.idempotencyKey).not.toBe(issues[0]?.idempotencyKey);
    next.issue.push(apiError("TIMEOUT", 0));
    form.editPhoneNumber();
    form.setPhoneNumber("01099998888");
    await form.send();
    form.configure({ issue: { templateId: "otp_login_kr" } });
    form.editPhoneNumber();
    await form.send();
    expect(issues[3]?.idempotencyKey).not.toBe(issues[2]?.idempotencyKey);
  });

  test("an ambiguous send keeps its key across change number", async () => {
    const { form, next, issues } = setup();
    next.issue.push(apiError("TIMEOUT", 0));
    form.setPhoneNumber("01012345678");
    await form.send();
    form.editPhoneNumber();
    await form.send();
    expect(issues[1]?.idempotencyKey).toBe(issues[0]?.idempotencyKey);
  });

  test("a send that supersedes an in-flight verify emits no onError(ABORTED)", async () => {
    const onError = mock();
    const { form, next } = setup({ onError, resendCooldownMs: 0 });
    form.setPhoneNumber("01012345678");
    await form.send();
    next.verify.push(hang);
    form.setCode("123456");
    expect(form.getState().phase).toBe("verifying");
    await form.send();
    await microtasks();
    expect(onError).not.toHaveBeenCalled();
    expect(form.getState()).toMatchObject({ phase: "code", error: undefined });
  });

  test("change number keeps a server-imposed wait (Retry-After)", async () => {
    const { form, next } = setup({ resendCooldownMs: 0 });
    form.setPhoneNumber("01012345678");
    await form.send();
    next.issue.push(apiError("TOO_MANY_REQUESTS", 429, 12_000));
    await form.send();
    form.editPhoneNumber();
    const parts = getOtpFormParts(form.getState(), {
      id: "f",
      t: createOtpTranslator({ locale: "en" }),
    });
    expect(form.getState()).toMatchObject({ resendIn: 12, issued: false });
    // Nothing was sent to this number yet: "send", not "resend".
    expect(parts.text.sendButton).toBe("Send code in 0:12");
    expect((await form.send()).skipped).toBe("cooldown");
  });

  test("a cooldown skip and a wait-and-retry error are shown only while the wait runs", async () => {
    const { form, next, tick } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    expect((await form.send()).skipped).toBe("cooldown");
    expect(form.getState().message?.key).toBe("skip.cooldown");
    tick(30_000);
    expect(form.getState().message?.key).toBe("status.sent");
    next.verify.push(apiError("TOO_MANY_REQUESTS", 429, 5_000));
    form.setCode("123456");
    await microtasks();
    expect(form.getState().message?.key).toBe("error.TOO_MANY_REQUESTS");
    tick(5_000);
    expect(form.getState().message?.key).toBe("status.sent");
  });

  test("abort() during a send drops its outcome: no onError(ABORTED), no onSent", async () => {
    const onError = mock();
    const onSent = mock();
    const { form, next } = setup({ onError, onSent });
    next.issue.push(hang);
    form.setPhoneNumber("01012345678");
    const sending = form.send();
    expect(form.getState().phase).toBe("sending");
    form.abort();
    const result = await sending;
    expect(result.error?.code).toBe("ABORTED");
    expect(onError).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(form.getState()).toMatchObject({ phase: "phone", error: undefined });
  });

  test("change number during a verify drops it: no onError, no onVerified", async () => {
    const onError = mock();
    const onVerified = mock();
    const { form, next } = setup({ onError, onVerified });
    form.setPhoneNumber("01012345678");
    await form.send();
    next.verify.push(hang);
    form.setCode("123456");
    expect(form.getState().phase).toBe("verifying");
    form.editPhoneNumber();
    await microtasks();
    expect(onError).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(form.getState().phase).toBe("phone");
  });

  test("a response that lands after reset() has no side effects", async () => {
    const onSent = mock();
    const get = mock(() => new Promise(() => {}));
    await withWebOtp(get, async () => {
      const { form, next } = setup({ onSent, webOtp: true });
      const late = deferred(() => issued(9));
      next.issue.push(late.step);
      form.setPhoneNumber("01012345678");
      const sending = form.send();
      form.reset();
      late.release();
      await sending;
      expect(onSent).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(form.getState()).toMatchObject({
        phase: "phone",
        issued: false,
        expiresIn: undefined,
        resendIn: 0,
      });
    });
  });

  test("getState() is referentially stable while unobserved, also during cooldowns", async () => {
    const { form, next, tick } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    expect(form.getState()).toBe(form.getState());
    next.issue.push(apiError("TOO_MANY_REQUESTS", 429, 40_000));
    tick(30_000);
    await form.send();
    // The flow's server cooldown is running and nobody is subscribed.
    expect(form.getState().resendIn).toBe(40);
    expect(form.getState()).toBe(form.getState());
    tick(1_000);
    const later = form.getState();
    expect(later.resendIn).toBe(39);
    expect(form.getState()).toBe(later);
  });

  test("submit dispatches by phase", async () => {
    const { form, issues, verifies } = setup({ autoSubmit: false });
    form.setPhoneNumber("01012345678");
    await form.submit();
    expect(issues).toHaveLength(1);
    form.setCode("123456");
    await form.submit();
    expect(verifies).toHaveLength(1);
    expect((await form.submit()).skipped).toBe("busy");
  });

  test("the expiry countdown and the local cooldown tick while observed", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const timers: { fn: () => void; ms: number }[] = [];
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
    try {
      const { form, tick } = setup();
      const seen: [number | undefined, number][] = [];
      const stop = form.subscribe(() =>
        seen.push([form.getState().expiresIn, form.getState().resendIn]),
      );
      form.setPhoneNumber("01012345678");
      await form.send();
      expect(seen.at(-1)).toEqual([180, 30]);
      const timer = timers.at(-1);
      expect(timer?.ms).toBe(1_000);
      tick(1_000);
      timer?.fn();
      expect(seen.at(-1)).toEqual([179, 29]);
      stop();
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });

  test("configure updates callbacks and purpose without notifying", async () => {
    const { form, issues } = setup();
    const listener = mock();
    const stop = form.subscribe(listener);
    const onSent = mock();
    form.configure({ purpose: "login", onSent });
    expect(listener).not.toHaveBeenCalled();
    form.setPhoneNumber("01012345678");
    await form.send();
    expect(issues[0]?.purpose).toBe("login");
    expect(onSent).toHaveBeenCalledTimes(1);
    // allowInternational changes the validation: subscribers are notified.
    listener.mockClear();
    form.configure({ allowInternational: true });
    expect(listener).toHaveBeenCalledTimes(1);
    form.configure({ allowInternational: true, purpose: "login" });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  test("WebOTP fills and verifies the code when supported", async () => {
    let release!: (value: { code: string }) => void;
    const get = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await withWebOtp(get, async () => {
      const onVerified = mock();
      const { form, verifies } = setup({ webOtp: true, onVerified });
      const verifiedOnce = new Promise<void>((resolve) =>
        onVerified.mockImplementation(() => resolve()),
      );
      form.setPhoneNumber("01012345678");
      await form.send();
      release({ code: "123456" });
      await verifiedOnce;
      expect(verifies[0]?.code).toBe("123456");
      expect(form.getState().phase).toBe("verified");
    });
  });
});

describe("getOtpFormParts", () => {
  test("data-* and ARIA of every part in the code phase", async () => {
    const { form } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    form.setCode("12");
    const parts = getOtpFormParts(form.getState(), {
      id: "otp",
      t: createOtpTranslator({ locale: "en" }),
    });
    expect(parts.root).toMatchObject({
      "data-k-otp": "root",
      "data-state": "code",
      "data-issued": "",
      id: "otp",
    });
    expect(parts.phoneInput).toMatchObject({
      id: "otp-phone",
      readonly: true,
      "data-disabled": "",
      "aria-describedby": "otp-phone-description",
    });
    expect(parts.phoneLabel.for).toBe("otp-phone");
    expect(parts.codeLabel.for).toBe("otp-code-0");
    expect(parts.codeInput).toMatchObject({
      role: "group",
      "aria-labelledby": "otp-code-label",
      "aria-describedby": "otp-code-description otp-countdown",
      "data-state": "code",
    });
    expect(parts.codeSegments.map((s) => s["data-state"])).toEqual([
      "filled",
      "filled",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(parts.codeSegments[0]).toMatchObject({
      autocomplete: "one-time-code",
      inputmode: "numeric",
      "aria-label": "Digit 1 of 6",
    });
    expect(parts.codeSegments[1]?.autocomplete).toBe("off");
    expect(parts.sendButton).toMatchObject({
      type: "button",
      "data-state": "cooldown",
      "aria-disabled": "true",
    });
    expect(parts.verifyButton).toMatchObject({
      type: "submit",
      "data-state": "idle",
    });
    expect(parts.countdown).toMatchObject({
      role: "timer",
      "aria-live": "off",
      "data-state": "running",
    });
    expect(parts.message).toMatchObject({
      role: "status",
      "aria-live": "polite",
      "data-state": "info",
      tabindex: -1,
    });
    expect(parts.text).toMatchObject({
      sendButton: "Resend in 0:30",
      countdown: "Code expires in 3:00",
      message: "We sent a code to 010-****-5678.",
      verifyButton: "Verify",
    });
  });
});
