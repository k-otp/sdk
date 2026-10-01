/**
 * The OTP form state machine: phone input -> send -> code input -> verify,
 * derived from the headless `createOtpFlow` (which keeps owning the
 * idempotency keys, the resend cooldown and the 429/503 retry hints).
 *
 * The React, Vue and Svelte components all wrap one `createOtpForm`
 * controller, so the three behave identically; it also works on its own for
 * plain-JS or custom-element UIs.
 *
 * SSR-safe: creating a controller performs no I/O, starts no timer and does
 * not touch `window`. Timers only run after an action while someone is
 * subscribed; WebOTP is feature-detected when a code was sent.
 */
import type { OtpApiError } from "../core/errors";
import type {
  IssueResult,
  VerifyReasonCode,
  VerifyResult,
} from "../core/types";
import {
  createOtpFlow,
  type OtpFlowController,
  type OtpFlowOptions,
  type OtpFlowResult,
  type OtpFlowSendInput,
  type OtpFlowSkipReason,
  type OtpFlowState,
  type OtpIssueVerifyClient,
} from "../headless";
import {
  DEFAULT_OTP_CODE_LENGTH,
  isOtpCodeComplete,
  sanitizeOtpCode,
} from "./code";
import { otpSecondsLeft } from "./countdown";
import {
  type OtpMessageKey,
  type OtpMessageParams,
  otpErrorMessageKey,
  otpPhoneErrorMessageKey,
  otpReasonMessageKey,
  otpSkipMessageKey,
} from "./messages";
import {
  formatOtpPhoneInput,
  maskOtpPhoneNumber,
  type OtpPhoneNumber,
  parseOtpPhoneNumber,
} from "./phone";
import { receiveWebOtp } from "./webotp";

/**
 * - `phone`: entering the number (also after "change number").
 * - `sending`: `issue` in flight (first send or resend).
 * - `code`: a code was sent and can be entered.
 * - `verifying`: `verify` in flight.
 * - `verified`: done.
 * - `failed`: the current code can no longer be used (expired, too many
 *   attempts, replaced, ...); a new code can be requested.
 */
export type OtpFormPhase =
  | "phone"
  | "sending"
  | "code"
  | "verifying"
  | "verified"
  | "failed";

/** Where focus should move after a phase change. */
export type OtpFormFocusTarget = "phone" | "code" | "message";

export type OtpFormMessageTone = "info" | "success" | "error";

/** The message to show in the live region (translate `key` with `params`). */
export type OtpFormMessage = {
  readonly key: OtpMessageKey;
  readonly params: OtpMessageParams;
  readonly tone: OtpFormMessageTone;
};

/** Which operation produced `error`. */
export type OtpFormOperation = "send" | "verify";

/** Settings that can change after creation (read when they are used). */
export type OtpFormConfig = {
  /** Purpose label sent with `issue` (1-64 characters), e.g. `"signup"`. */
  purpose: string;
  /** Other `issue` fields: `channel`, `templateId`, `metadata`, ... */
  issue?: Omit<OtpFlowSendInput, "phoneNumber" | "purpose"> | undefined;
  /** Verify as soon as every digit is entered. Default `true`. */
  autoSubmit?: boolean | undefined;
  /** Use WebOTP after a send when the browser supports it. Default `true`. */
  webOtp?: boolean | undefined;
  /** Clear the code after a wrong code (`MISMATCH`). Default `true`. */
  clearCodeOnMismatch?: boolean | undefined;
  /** Accept non-Korean E.164 numbers. Default `false`. */
  allowInternational?: boolean | undefined;
  /** A code was sent (`issue` succeeded). */
  onSent?: ((result: IssueResult) => void) | undefined;
  /** The code was verified (`verified: true`). */
  onVerified?: ((result: VerifyResult) => void) | undefined;
  /** `issue` or `verify` failed with an API error. */
  onError?:
    | ((error: OtpApiError, operation: OtpFormOperation) => void)
    | undefined;
  onPhaseChange?:
    | ((phase: OtpFormPhase, previous: OtpFormPhase) => void)
    | undefined;
};

export type OtpFormOptions = OtpFlowOptions &
  OtpFormConfig & {
    /** Digits in a code. Default 6 (the API issues 6-digit codes). */
    codeLength?: number | undefined;
    /** Initial phone input. */
    defaultPhoneNumber?: string | undefined;
    /** Use this flow instead of creating one from the client. */
    flow?: OtpFlowController | undefined;
  };

/** Immutable snapshot of the form. */
export type OtpFormState = {
  readonly phase: OtpFormPhase;
  /** The phone input as displayed. */
  readonly phoneNumber: string;
  /** Parsed phone input (`phone.value` is what gets sent). */
  readonly phone: OtpPhoneNumber;
  /** Phone validation message, shown once a send was attempted. */
  readonly phoneError: OtpMessageKey | undefined;
  /** Phone input is locked because a code was sent to it. */
  readonly phoneLocked: boolean;
  readonly code: string;
  readonly codeLength: number;
  readonly codeComplete: boolean;
  /** Code validation message, shown once a verify was attempted. */
  readonly codeError: OtpMessageKey | undefined;
  /** A code was sent for the current number (the code step is shown). */
  readonly issued: boolean;
  /** Masked number the code was sent to (`010-****-5678`). */
  readonly sentTo: string | undefined;
  /** `send` would start a request now (valid number, no cooldown, idle). */
  readonly canSend: boolean;
  /** `verify` would start a request now (complete code, usable issue). */
  readonly canVerify: boolean;
  /** The send button does nothing now (in flight, cooldown, verified). */
  readonly sendDisabled: boolean;
  /** The verify button does nothing now. */
  readonly verifyDisabled: boolean;
  /** Seconds until a new code can be requested (local or server cooldown). */
  readonly resendIn: number;
  /** Seconds until `verify` may be retried after a 429/503 retry hint. */
  readonly retryIn: number;
  /** Seconds until the current code expires, when a code was sent. */
  readonly expiresIn: number | undefined;
  readonly expired: boolean;
  readonly attemptsRemaining: number | undefined;
  readonly verified: boolean;
  readonly reasonCode: VerifyReasonCode | undefined;
  readonly error: OtpApiError | undefined;
  readonly errorOperation: OtpFormOperation | undefined;
  /** The last send failed ambiguously; sending again retries the same key. */
  readonly retryPending: boolean;
  readonly isLoading: boolean;
  /** Live-region message for the current state, if any. */
  readonly message: OtpFormMessage | undefined;
  /** Latest focus request; apply it when `seq` changes. */
  readonly focus:
    | { readonly target: OtpFormFocusTarget; readonly seq: number }
    | undefined;
  /** The underlying flow snapshot. */
  readonly flow: OtpFlowState;
};

/** Outcome of a form action: the flow result, or `invalid` input. */
export type OtpFormActionResult<T> =
  | OtpFlowResult<T>
  | {
      readonly data: undefined;
      readonly error: undefined;
      readonly skipped: "invalid";
    };

export type OtpFormController = {
  getState: () => OtpFormState;
  subscribe: (listener: () => void) => () => void;
  /**
   * Updates the phone input. Formats as you type (`010-1234-5678`) unless
   * `format: false` (pass `false` while the caret is not at the end).
   * Ignored while the number is locked.
   */
  setPhoneNumber: (value: string, options?: { format?: boolean }) => void;
  /** Updates the code (sanitized); verifies when complete and `autoSubmit`. */
  setCode: (value: string) => void;
  /** Validates the number and sends (or resends) a code. */
  send: () => Promise<OtpFormActionResult<IssueResult>>;
  /** Verifies the entered code. */
  verify: () => Promise<OtpFormActionResult<VerifyResult>>;
  /** Form submit: `send` in the phone step, `verify` in the code step. */
  submit: () => Promise<
    OtpFormActionResult<IssueResult> | OtpFormActionResult<VerifyResult>
  >;
  /** Back to the phone step (keeps the number, unlocks it). */
  editPhoneNumber: () => void;
  /** Clears everything (the cooldowns are kept, like the flow's). */
  reset: () => void;
  /** Aborts in-flight requests and WebOTP (e.g. on unmount). */
  abort: () => void;
  /** Updates callbacks and settings without re-creating the form. */
  configure: (config: Partial<OtpFormConfig>) => void;
  /** The headless flow behind the form. */
  readonly flow: OtpFlowController;
};

const TERMINAL_REASONS: ReadonlySet<VerifyReasonCode> = new Set([
  "MAX_ATTEMPTS",
  "EXPIRED",
  "REPLACED",
  "NOT_FOUND",
  "ALREADY_VERIFIED",
]);

const invalid = <T>(): OtpFormActionResult<T> => ({
  data: undefined,
  error: undefined,
  skipped: "invalid",
});

/** Local epoch ms of expiry, anchored on the server's own issue duration. */
const localExpiry = (
  result: Pick<IssueResult, "expiresAt" | "queuedAt">,
  now: number,
): number | undefined => {
  const expires = Date.parse(result.expiresAt);
  const queued = Date.parse(result.queuedAt);
  if (Number.isNaN(expires)) return undefined;
  // `expiresAt - queuedAt` is immune to a skewed client clock.
  if (!Number.isNaN(queued) && expires > queued) return now + expires - queued;
  return expires;
};

/**
 * Creates the OTP form controller:
 *
 * ```ts
 * const form = createOtpForm(createOtpClient({ apiKey: "pk_..." }), {
 *   purpose: "signup",
 *   onVerified: (result) => console.log(result.issueId),
 * });
 * form.setPhoneNumber("01012345678");
 * await form.send();
 * form.setCode("123456"); // verifies automatically
 * ```
 */
export const createOtpForm = (
  client: OtpIssueVerifyClient,
  options: OtpFormOptions,
): OtpFormController => {
  const now = options.now ?? Date.now;
  const flow = options.flow ?? createOtpFlow(client, options);
  const codeLength =
    Number.isInteger(options.codeLength) && (options.codeLength ?? 0) > 0
      ? (options.codeLength as number)
      : DEFAULT_OTP_CODE_LENGTH;
  const config: OtpFormConfig = { ...options };

  const listeners = new Set<() => void>();
  let phoneNumber = formatOtpPhoneInput(options.defaultPhoneNumber ?? "");
  let code = "";
  let showPhoneError = false;
  let showCodeError = false;
  let lastSkip: OtpFlowSkipReason | undefined;
  let errorOperation: OtpFormOperation | undefined;
  /** Phone of the latest send attempt (the code was sent to it if issued). */
  let attemptPhone: OtpPhoneNumber | undefined;
  let expiresAt: number | undefined;
  let focus: OtpFormState["focus"];
  let focusSeq = 0;
  let version = 0;
  let unsubscribeFlow: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let webOtp: AbortController | undefined;
  let lastPhase: OtpFormPhase = "phone";
  let snapshot: OtpFormState | undefined;
  let snapshotKey: readonly unknown[] = [];

  const parsePhone = (): OtpPhoneNumber =>
    parseOtpPhoneNumber(phoneNumber, {
      allowInternational: config.allowInternational === true,
    });

  const expiresInSeconds = (f: OtpFlowState): number | undefined =>
    f.issueId === undefined || expiresAt === undefined
      ? undefined
      : otpSecondsLeft(expiresAt - now());

  const derivePhase = (f: OtpFlowState, expired: boolean): OtpFormPhase => {
    if (f.verified) return "verified";
    if (f.verifyState.isLoading) return "verifying";
    if (f.issueState.isLoading) return "sending";
    if (f.issueId === undefined) return "phone";
    if (expired || (f.reasonCode && TERMINAL_REASONS.has(f.reasonCode))) {
      return "failed";
    }
    return "code";
  };

  const deriveMessage = (
    f: OtpFlowState,
    phase: OtpFormPhase,
    expired: boolean,
  ): OtpFormMessage | undefined => {
    if (f.error) {
      return {
        key: otpErrorMessageKey(f.error, errorOperation),
        params: {},
        tone: "error",
      };
    }
    if (f.reasonCode && phase !== "verifying" && phase !== "sending") {
      return {
        key: otpReasonMessageKey(f.reasonCode),
        params: { attempts: f.attemptsRemaining },
        tone: "error",
      };
    }
    if (phase === "failed" && expired) {
      return { key: "reason.EXPIRED", params: {}, tone: "error" };
    }
    if (lastSkip && lastSkip !== "busy") {
      return { key: otpSkipMessageKey(lastSkip), params: {}, tone: "info" };
    }
    switch (phase) {
      case "sending":
        return { key: "status.sending", params: {}, tone: "info" };
      case "code":
        return {
          key: "status.sent",
          params: { phone: sentTo(f) },
          tone: "info",
        };
      case "verifying":
        return { key: "status.verifying", params: {}, tone: "info" };
      case "verified":
        return { key: "status.verified", params: {}, tone: "success" };
      default:
        return undefined;
    }
  };

  const sentTo = (f: OtpFlowState): string | undefined =>
    f.issueId !== undefined && attemptPhone
      ? maskOtpPhoneNumber(attemptPhone.input, { allowInternational: true })
      : undefined;

  const build = (f: OtpFlowState): OtpFormState => {
    const phone = parsePhone();
    const expiresIn = expiresInSeconds(f);
    const expired = expiresIn === 0 && !f.verified;
    const phase = derivePhase(f, expired);
    const codeComplete = isOtpCodeComplete(code, codeLength);
    const issued = f.issueId !== undefined;
    const busy = f.isLoading;
    const resendIn = otpSecondsLeft(f.cooldownRemainingMs);
    const retryIn = otpSecondsLeft(f.verifyCooldownRemainingMs);
    const sendDisabled =
      busy || resendIn > 0 || phase === "verified" || !f.canSend;
    const verifyDisabled =
      !issued || busy || retryIn > 0 || !f.canVerify || phase !== "code";
    return {
      phase,
      phoneNumber,
      phone,
      phoneError:
        showPhoneError && !phone.valid && phone.error
          ? otpPhoneErrorMessageKey(phone.error)
          : undefined,
      phoneLocked: issued || phase === "sending",
      code,
      codeLength,
      codeComplete,
      codeError:
        showCodeError && !codeComplete ? "code.error.incomplete" : undefined,
      issued,
      sentTo: sentTo(f),
      canSend: !sendDisabled && phone.valid,
      canVerify: !verifyDisabled && codeComplete,
      sendDisabled,
      verifyDisabled,
      resendIn,
      retryIn,
      expiresIn,
      expired,
      attemptsRemaining: f.attemptsRemaining,
      verified: f.verified,
      reasonCode: f.reasonCode,
      error: f.error,
      errorOperation: f.error ? errorOperation : undefined,
      retryPending: f.idempotencyKey !== undefined,
      isLoading: busy,
      message: deriveMessage(f, phase, expired),
      focus,
      flow: f,
    };
  };

  /** The snapshot, rebuilt only when an input of it changed. */
  const current = (): OtpFormState => {
    const f = flow.getState();
    const key = [f, version, expiresInSeconds(f)];
    if (
      !snapshot ||
      key.length !== snapshotKey.length ||
      key.some((value, i) => value !== snapshotKey[i])
    ) {
      snapshot = build(f);
      snapshotKey = key;
    }
    return snapshot;
  };

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  /** Ticks the expiry countdown once a second while observed. */
  const scheduleTimer = (state: OtpFormState): void => {
    if (timer !== undefined || listeners.size === 0) return;
    if (expiresAt === undefined || !state.expiresIn || state.verified) return;
    const left = expiresAt - now();
    timer = setTimeout(
      () => {
        timer = undefined;
        refresh();
      },
      left % 1000 || 1000,
    );
  };

  /** Rebuilds, reports a phase change and notifies subscribers. */
  function refresh(): void {
    const state = current();
    if (state.phase !== lastPhase) {
      const previous = lastPhase;
      lastPhase = state.phase;
      config.onPhaseChange?.(state.phase, previous);
    }
    for (const listener of [...listeners]) listener();
    scheduleTimer(state);
  }

  const touch = (): void => {
    version++;
    refresh();
  };

  const requestFocus = (target: OtpFormFocusTarget): void => {
    focus = { target, seq: ++focusSeq };
  };

  const stopWebOtp = (): void => {
    webOtp?.abort();
    webOtp = undefined;
  };

  const startWebOtp = (issueId: string): void => {
    stopWebOtp();
    if (config.webOtp === false) return;
    const controller = new AbortController();
    webOtp = controller;
    void receiveWebOtp({ signal: controller.signal, length: codeLength }).then(
      (received) => {
        if (
          !received ||
          controller.signal.aborted ||
          flow.getState().issueId !== issueId
        ) {
          return;
        }
        setCode(received);
      },
    );
  };

  const send: OtpFormController["send"] = async () => {
    const phone = parsePhone();
    if (!phone.valid || !phone.value) {
      showPhoneError = true;
      requestFocus("phone");
      touch();
      return invalid();
    }
    lastSkip = undefined;
    attemptPhone = phone;
    const promise = flow.send({
      ...config.issue,
      purpose: config.purpose,
      phoneNumber: phone.value,
    });
    // The flow is already "loading" synchronously.
    touch();
    const result = await promise;
    if (result.skipped) {
      lastSkip = result.skipped;
    } else if (result.error) {
      errorOperation = "send";
      config.onError?.(result.error, "send");
    } else {
      showCodeError = false;
      code = "";
      expiresAt = localExpiry(result.data, now());
      requestFocus("code");
      startWebOtp(result.data.issueId);
      config.onSent?.(result.data);
    }
    touch();
    return result;
  };

  const verify: OtpFormController["verify"] = async () => {
    if (!isOtpCodeComplete(code, codeLength)) {
      showCodeError = true;
      requestFocus("code");
      touch();
      return invalid();
    }
    lastSkip = undefined;
    const promise = flow.verify(code);
    touch();
    const result = await promise;
    if (result.skipped) {
      lastSkip = result.skipped;
    } else if (result.error) {
      errorOperation = "verify";
      config.onError?.(result.error, "verify");
    } else if (result.data.verified) {
      stopWebOtp();
      requestFocus("message");
      config.onVerified?.(result.data);
    } else if (result.data.reasonCode === "MISMATCH") {
      if (config.clearCodeOnMismatch !== false) code = "";
      requestFocus("code");
    } else {
      requestFocus("message");
    }
    touch();
    return result;
  };

  function setCode(value: string): void {
    const next = sanitizeOtpCode(value, codeLength);
    if (next === code) return;
    code = next;
    if (showCodeError && isOtpCodeComplete(code, codeLength)) {
      showCodeError = false;
    }
    touch();
    if (
      config.autoSubmit !== false &&
      isOtpCodeComplete(code, codeLength) &&
      current().phase === "code" &&
      flow.getState().canVerify
    ) {
      void verify();
    }
  }

  const clearIssue = (): void => {
    stopWebOtp();
    flow.reset();
    attemptPhone = undefined;
    expiresAt = undefined;
    code = "";
    showCodeError = false;
    lastSkip = undefined;
    errorOperation = undefined;
  };

  return {
    getState: current,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!unsubscribeFlow) unsubscribeFlow = flow.subscribe(refresh);
      scheduleTimer(current());
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeFlow?.();
          unsubscribeFlow = undefined;
          stopTimer();
        }
      };
    },
    setPhoneNumber: (value, setOptions = {}) => {
      const f = flow.getState();
      if (f.issueId !== undefined || f.issueState.isLoading) return;
      const next =
        setOptions.format === false ? value : formatOtpPhoneInput(value);
      if (next === phoneNumber) return;
      phoneNumber = next;
      lastSkip = undefined;
      touch();
    },
    setCode,
    send,
    verify,
    submit: () => {
      const { phase } = current();
      if (phase === "code") return verify();
      if (phase === "phone" || phase === "failed") return send();
      return Promise.resolve({
        data: undefined,
        error: undefined,
        skipped: "busy",
      });
    },
    editPhoneNumber: () => {
      clearIssue();
      requestFocus("phone");
      touch();
    },
    reset: () => {
      clearIssue();
      phoneNumber = "";
      showPhoneError = false;
      touch();
    },
    abort: () => {
      stopWebOtp();
      flow.abort();
    },
    configure: (next) => {
      // Only `allowInternational` changes the snapshot; the rest is read
      // when it is used, so frameworks may call this on every render.
      const relevant =
        "allowInternational" in next &&
        Boolean(next.allowInternational) !== Boolean(config.allowInternational);
      Object.assign(config, next);
      if (relevant) touch();
    },
    flow,
  };
};
