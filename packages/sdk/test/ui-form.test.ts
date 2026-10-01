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

type Step = (input: never) => unknown;

/** A client whose next answers can be scripted; defaults succeed. */
const scripted = () => {
  const issues: IssueInput[] = [];
  const verifies: VerifyInput[] = [];
  const next = { issue: [] as Step[], verify: [] as Step[] };
  let count = 0;
  const client: OtpIssueVerifyClient = {
    issue: async (input) => {
      issues.push(input);
      const step = next.issue.shift();
      if (step) return (step as (i: IssueInput) => IssueResult)(input);
      count++;
      return issued(count);
    },
    verify: async (input) => {
      verifies.push(input);
      const step = next.verify.shift();
      if (step) return (step as (i: VerifyInput) => VerifyResult)(input);
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

  test("change number goes back to the phone step; cooldown is kept", async () => {
    const { form, phases } = setup();
    form.setPhoneNumber("01012345678");
    await form.send();
    form.setCode("12");
    form.editPhoneNumber();
    expect(form.getState()).toMatchObject({
      phase: "phone",
      issued: false,
      phoneLocked: false,
      phoneNumber: "010-1234-5678",
      code: "",
      resendIn: 30,
      focus: { target: "phone" },
    });
    form.setPhoneNumber("010-9999-8888");
    expect((await form.send()).skipped).toBe("cooldown");
    expect(phases).toEqual(["sending", "code", "phone"]);
    form.reset();
    expect(form.getState().phoneNumber).toBe("");
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

  test("subscribers are notified; the expiry countdown ticks while observed", async () => {
    const { form } = setup({ now: Date.now, resendCooldownMs: 0 });
    const seen: (number | undefined)[] = [];
    const stop = form.subscribe(() => seen.push(form.getState().expiresIn));
    form.setPhoneNumber("01012345678");
    await form.send();
    await Bun.sleep(1_100);
    stop();
    expect(seen.at(-1)).toBeLessThanOrEqual(179);
    expect(seen).toContain(180);
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
    form.configure({ allowInternational: true });
    stop();
  });

  test("WebOTP fills and verifies the code when supported", async () => {
    const globals = globalThis as Record<string, unknown>;
    const saved = {
      window: globals.window,
      navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    };
    let release!: (value: { code: string }) => void;
    globals.window = { OTPCredential: class {} };
    Object.defineProperty(globalThis, "navigator", {
      value: {
        credentials: {
          get: () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        },
      },
      configurable: true,
    });
    try {
      const { form, verifies } = setup({ webOtp: true });
      form.setPhoneNumber("01012345678");
      await form.send();
      release({ code: "123456" });
      await Bun.sleep(0);
      await Bun.sleep(0);
      expect(verifies[0]?.code).toBe("123456");
      expect(form.getState().phase).toBe("verified");
    } finally {
      globals.window = saved.window;
      if (saved.navigator) {
        Object.defineProperty(globalThis, "navigator", saved.navigator);
      }
    }
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
