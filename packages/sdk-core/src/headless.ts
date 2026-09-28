/**
 * `@k-otp/sdk-core/headless`: framework-agnostic operation state and the
 * issue -> verify flow (loading/error/data, stale-response protection, abort,
 * idempotency key reuse, resend cooldown). The React, Vue and Svelte adapters
 * are thin wrappers around it, and plain-JS apps can use it directly (the
 * CDN bundle exposes it as `KOtp.createOtpFlow` / `KOtp.createOtpOperation`).
 * Covered by SemVer.
 *
 * Nothing here runs at import time or touches `window`; timers only start
 * after an action while someone is subscribed.
 */
import { isOtpApiError, type OtpApiError } from "./errors";
import { createIdempotencyKey } from "./idempotency";
import type { OtpRequestOptions } from "./transport";
import type {
  IssueInput,
  IssueResult,
  VerifyInput,
  VerifyReasonCode,
  VerifyResult,
} from "./types";

/** The client surface the adapters need (satisfied by both SDK clients). */
export type OtpIssueVerifyClient = {
  issue: (
    input: IssueInput,
    options?: OtpRequestOptions,
  ) => Promise<IssueResult>;
  verify: (
    input: VerifyInput,
    options?: OtpRequestOptions,
  ) => Promise<VerifyResult>;
};

export type OtpOperationStatus = "idle" | "loading" | "success" | "error";

/** Snapshot of one operation (`issue` or `verify`). Immutable. */
export type OtpOperationState<TResult> = {
  readonly status: OtpOperationStatus;
  readonly isLoading: boolean;
  /** Result of the latest successful call; cleared when a new call starts. */
  readonly data: TResult | undefined;
  /** Normalized error of the latest failed call. */
  readonly error: OtpApiError | undefined;
};

/**
 * Settled outcome of `run`. It never rejects with an API error: failures
 * resolve with `error` (and are also stored in the state). Configuration
 * mistakes (`TypeError`) still reject, exactly like the core client.
 */
export type OtpRunResult<TResult> =
  | { readonly data: TResult; readonly error: undefined }
  | { readonly data: undefined; readonly error: OtpApiError };

export type OtpOperationController<TInput, TResult> = {
  getState: () => OtpOperationState<TResult>;
  subscribe: (listener: () => void) => () => void;
  /**
   * Starts a call. A newer `run` (or `reset`/`abort`) supersedes it: its
   * outcome is still returned to its caller but no longer written to state.
   */
  run: (
    input: TInput,
    options?: OtpRequestOptions,
  ) => Promise<OtpRunResult<TResult>>;
  /** Aborts in-flight calls and returns to `idle`. */
  reset: () => void;
  /** Aborts in-flight calls (e.g. on unmount) without notifying anyone. */
  abort: () => void;
};

const IDLE: OtpOperationState<never> = Object.freeze({
  status: "idle",
  isLoading: false,
  data: undefined,
  error: undefined,
});

const LOADING: OtpOperationState<never> = Object.freeze({
  status: "loading",
  isLoading: true,
  data: undefined,
  error: undefined,
});

const createEmitter = (): {
  listeners: Set<() => void>;
  emit: () => void;
  subscribe: (listener: () => void) => () => void;
} => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** Links an optional caller signal to a fresh controller. */
const linkSignal = (
  controller: AbortController,
  signal: AbortSignal | undefined,
): (() => void) => {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const onAbort = (): void => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
};

/**
 * Wraps one async SDK operation with observable state, stale-response
 * protection and cancellation.
 */
export const createOtpOperation = <TInput, TResult>(
  execute: (input: TInput, options: OtpRequestOptions) => Promise<TResult>,
): OtpOperationController<TInput, TResult> => {
  const emitter = createEmitter();
  const inflight = new Set<AbortController>();
  let state: OtpOperationState<TResult> = IDLE;
  let generation = 0;

  const set = (next: OtpOperationState<TResult>): void => {
    state = next;
    emitter.emit();
  };

  const abortInflight = (): void => {
    generation++;
    for (const controller of inflight) controller.abort();
    inflight.clear();
  };

  const run = async (
    input: TInput,
    options: OtpRequestOptions = {},
  ): Promise<OtpRunResult<TResult>> => {
    const current = ++generation;
    const controller = new AbortController();
    const unlink = linkSignal(controller, options.signal);
    inflight.add(controller);
    set(LOADING);
    try {
      const data = await execute(input, {
        ...options,
        signal: controller.signal,
      });
      if (current === generation) {
        set({ status: "success", isLoading: false, data, error: undefined });
      }
      return { data, error: undefined };
    } catch (error) {
      if (!isOtpApiError(error)) {
        // Programmer error (e.g. TypeError for a bad key): surface it as-is.
        if (current === generation) set(IDLE);
        throw error;
      }
      if (current === generation) {
        set({ status: "error", isLoading: false, data: undefined, error });
      }
      return { data: undefined, error };
    } finally {
      inflight.delete(controller);
      unlink();
    }
  };

  return {
    getState: () => state,
    subscribe: emitter.subscribe,
    run,
    reset: () => {
      abortInflight();
      set(IDLE);
    },
    abort: () => {
      abortInflight();
      // Never leave a stale "loading" snapshot behind for a later subscriber.
      if (state.isLoading) state = IDLE;
    },
  };
};

/** Operation of an issue -> verify flow that was not started. */
export type OtpFlowSkipReason =
  /** A resend cooldown (local or server `retryAfterMs`) is active. */
  | "cooldown"
  /**
   * The same operation is already in flight (for `verify`, also while a
   * `send` is in flight, since it may replace the current `issueId`).
   */
  | "busy"
  /** `verify` was called before a successful `send`. */
  | "no-issue"
  /**
   * `verify` was called after the current code was verified or can no longer
   * be used (`EXPIRED`, `MAX_ATTEMPTS`, `REPLACED`, ...). `send` a new one.
   */
  | "terminal"
  /** `resend` was called before any `send`. */
  | "no-previous-send";

export type OtpFlowResult<TResult> =
  | (OtpRunResult<TResult> & { readonly skipped?: undefined })
  | {
      readonly data: undefined;
      readonly error: undefined;
      readonly skipped: OtpFlowSkipReason;
    };

/** Issue input without the idempotency key: the flow manages the key. */
export type OtpFlowSendInput = Omit<IssueInput, "idempotencyKey">;

export type OtpFlowOptions = {
  /**
   * Local cooldown after a successful send, in ms, before `send`/`resend`
   * may issue again. Default `30000` (30 s); `0` disables it. A server
   * `retryAfterMs` (429/503) always applies as well.
   */
  resendCooldownMs?: number;
  /** Prefix for generated idempotency keys (`createIdempotencyKey(prefix)`). */
  idempotencyKeyPrefix?: string;
  /** Custom idempotency key factory (overrides `idempotencyKeyPrefix`). */
  createIdempotencyKey?: () => string;
  /** Clock used for cooldowns (tests). Default `Date.now`. */
  now?: () => number;
};

/** Immutable snapshot of an issue -> verify flow. */
export type OtpFlowState = {
  /** State of the underlying `issue` operation. */
  readonly issueState: OtpOperationState<IssueResult>;
  /** State of the underlying `verify` operation. */
  readonly verifyState: OtpOperationState<VerifyResult>;
  /** `issueId` of the latest successful send. */
  readonly issueId: string | undefined;
  readonly expiresAt: string | undefined;
  /** From the latest send or verify result. */
  readonly attemptsRemaining: number | undefined;
  readonly verified: boolean;
  /** `reasonCode` of the latest `verified: false` result. */
  readonly reasonCode: VerifyReasonCode | undefined;
  /** Latest normalized error of either operation (cleared on success). */
  readonly error: OtpApiError | undefined;
  readonly isLoading: boolean;
  /**
   * Idempotency key of the current send attempt. It is kept after an
   * ambiguous failure (timeout, network, 5xx, 429, abort) so that the next
   * `send` with the same input retries the SAME attempt, and dropped after a
   * success or a definitive failure. Persist it if the flow must survive a
   * page reload.
   */
  readonly idempotencyKey: string | undefined;
  /** Epoch ms until which sending is blocked, if any. */
  readonly cooldownUntil: number | undefined;
  /** Remaining cooldown in ms when this snapshot was taken (ticks ~1/s). */
  readonly cooldownRemainingMs: number;
  /** `send`/`resend` would start a request now. */
  readonly canSend: boolean;
  /** `verify` would start a request now. */
  readonly canVerify: boolean;
};

export type OtpFlowController = {
  getState: () => OtpFlowState;
  subscribe: (listener: () => void) => () => void;
  /** Issues a code. Reuses the pending idempotency key for the same input. */
  send: (
    input: OtpFlowSendInput,
    options?: OtpRequestOptions,
  ) => Promise<OtpFlowResult<IssueResult>>;
  /** `send` with the input of the previous `send`. */
  resend: (options?: OtpRequestOptions) => Promise<OtpFlowResult<IssueResult>>;
  /**
   * Verifies `code` against the latest `issueId`. Skipped while a `send` is
   * in flight and after a terminal outcome (see {@link OtpFlowSkipReason}).
   */
  verify: (
    code: string,
    options?: OtpRequestOptions,
  ) => Promise<OtpFlowResult<VerifyResult>>;
  /**
   * Aborts in-flight calls and clears the flow. The cooldown is kept, since
   * server-side rate limits do not reset either.
   */
  reset: () => void;
  /** Aborts in-flight calls (e.g. on unmount) and notifies subscribers. */
  abort: () => void;
};

/** Default local resend cooldown of `createOtpFlow` (30 seconds). */
export const DEFAULT_RESEND_COOLDOWN_MS = 30_000;

/**
 * Outcome may have reached the server: retry with the same key. Every
 * `retryable` error, plus an abort (the request may already have been sent).
 */
const isAmbiguous = (error: OtpApiError): boolean =>
  error.retryable || error.code === "ABORTED";

/** Verification outcomes after which the issued code can no longer be used. */
const TERMINAL_REASONS: ReadonlySet<VerifyReasonCode> =
  new Set<VerifyReasonCode>([
    "MAX_ATTEMPTS",
    "EXPIRED",
    "REPLACED",
    "NOT_FOUND",
    "ALREADY_VERIFIED",
  ]);

/** Deterministic JSON for comparing inputs (object keys sorted). */
const fingerprint = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          // Object keys are unique, so `a === b` never happens.
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : v,
  );

/**
 * A headless issue -> verify flow: resend cooldown (local and server
 * `retryAfterMs`), idempotency key management and verification state.
 */
export const createOtpFlow = (
  client: OtpIssueVerifyClient,
  options: OtpFlowOptions = {},
): OtpFlowController => {
  const now = options.now ?? Date.now;
  const localCooldownMs = Math.max(
    0,
    options.resendCooldownMs ?? DEFAULT_RESEND_COOLDOWN_MS,
  );
  const newKey =
    options.createIdempotencyKey ??
    (() => createIdempotencyKey(options.idempotencyKeyPrefix));

  const emitter = createEmitter();
  const issueOp = createOtpOperation<IssueInput, IssueResult>((input, o) =>
    client.issue(input, o),
  );
  const verifyOp = createOtpOperation<VerifyInput, VerifyResult>((input, o) =>
    client.verify(input, o),
  );

  let generation = 0;
  let pending: { key: string; fingerprint: string } | undefined;
  let lastInput: OtpFlowSendInput | undefined;
  let issued: IssueResult | undefined;
  let verifyResult: VerifyResult | undefined;
  let lastError: OtpApiError | undefined;
  let cooldownUntil: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const remaining = (): number =>
    cooldownUntil === undefined ? 0 : Math.max(0, cooldownUntil - now());

  /** The current code was verified or can no longer be used. */
  const isTerminal = (): boolean =>
    verifyResult !== undefined &&
    (verifyResult.verified ||
      (verifyResult.reasonCode !== undefined &&
        TERMINAL_REASONS.has(verifyResult.reasonCode)));

  const build = (): OtpFlowState => {
    const issue = issueOp.getState();
    const verify = verifyOp.getState();
    const cooldownRemainingMs = remaining();
    const verified = verifyResult?.verified === true;
    const reasonCode = verifyResult?.verified
      ? undefined
      : verifyResult?.reasonCode;
    return {
      issueState: issue,
      verifyState: verify,
      issueId: issued?.issueId,
      expiresAt: issued?.expiresAt,
      attemptsRemaining:
        verifyResult?.attemptsRemaining ?? issued?.attemptsRemaining,
      verified,
      reasonCode,
      error: lastError,
      isLoading: issue.isLoading || verify.isLoading,
      idempotencyKey: pending?.key,
      cooldownUntil: cooldownRemainingMs > 0 ? cooldownUntil : undefined,
      cooldownRemainingMs,
      canSend: !issue.isLoading && cooldownRemainingMs === 0,
      canVerify:
        issued !== undefined &&
        !verify.isLoading &&
        !issue.isLoading &&
        !isTerminal(),
    };
  };

  let snapshot = build();

  const stopTicker = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const tick = (): void => {
    timer = undefined;
    snapshot = build();
    emitter.emit();
    scheduleTicker();
  };

  /** Refreshes `cooldownRemainingMs` about once a second while observed. */
  function scheduleTicker(): void {
    if (timer !== undefined || emitter.listeners.size === 0) return;
    const ms = remaining();
    if (ms <= 0) return;
    timer = setTimeout(tick, ms % 1000 || 1000);
  }

  const notify = (): void => {
    snapshot = build();
    emitter.emit();
    scheduleTicker();
  };

  const startCooldown = (ms: number | undefined): void => {
    if (!ms || ms <= 0) return;
    const until = now() + ms;
    if (cooldownUntil === undefined || until > cooldownUntil) {
      cooldownUntil = until;
      stopTicker();
    }
  };

  /**
   * Awaits an operation run. A rejection (a programmer error such as a
   * TypeError) is rethrown after publishing a fresh snapshot, so subscribers
   * never keep a stale "loading" state.
   */
  const settle = async <T>(promise: Promise<T>): Promise<T> => {
    try {
      return await promise;
    } catch (error) {
      notify();
      throw error;
    }
  };

  const skip = <T>(reason: OtpFlowSkipReason): OtpFlowResult<T> => ({
    data: undefined,
    error: undefined,
    skipped: reason,
  });

  const send: OtpFlowController["send"] = async (input, requestOptions) => {
    if (issueOp.getState().isLoading) return skip("busy");
    if (remaining() > 0) return skip("cooldown");
    const current = generation;
    const print = fingerprint(input);
    // Same input after an ambiguous failure: retry the same attempt.
    if (pending?.fingerprint !== print) {
      pending = { key: newKey(), fingerprint: print };
    }
    const attempt = pending;
    lastInput = input;
    const promise = issueOp.run(
      { ...input, idempotencyKey: attempt.key },
      requestOptions,
    );
    notify();
    const result = await settle(promise);
    if (current !== generation) return result;
    if (result.error) {
      lastError = result.error;
      if (!isAmbiguous(result.error) && pending === attempt) {
        pending = undefined;
      }
      startCooldown(result.error.retryAfterMs);
    } else {
      lastError = undefined;
      if (pending === attempt) pending = undefined;
      issued = result.data;
      verifyResult = undefined;
      verifyOp.reset();
      startCooldown(localCooldownMs);
    }
    notify();
    return result;
  };

  const verify: OtpFlowController["verify"] = async (code, requestOptions) => {
    if (!issued) return skip("no-issue");
    if (verifyOp.getState().isLoading || issueOp.getState().isLoading) {
      return skip("busy");
    }
    if (isTerminal()) return skip("terminal");
    const current = generation;
    const target = issued;
    const promise = verifyOp.run(
      { issueId: target.issueId, code },
      requestOptions,
    );
    notify();
    const result = await settle(promise);
    // A newer send replaced the code (and aborted this call): drop the outcome.
    if (current !== generation || issued !== target) return result;
    if (result.error) {
      lastError = result.error;
    } else {
      lastError = undefined;
      verifyResult = result.data;
    }
    notify();
    return result;
  };

  const abort = (): void => {
    generation++;
    issueOp.abort();
    verifyOp.abort();
    // Subscribers (e.g. a "cancel" button) must see isLoading flip back.
    // After an unmount nobody is subscribed, so this only refreshes the snapshot.
    notify();
  };

  return {
    getState: () => {
      // Unobserved readers (no ticker running) still get a fresh cooldown.
      if (emitter.listeners.size === 0 && snapshot.cooldownRemainingMs > 0) {
        snapshot = build();
      }
      return snapshot;
    },
    subscribe: (listener) => {
      const unsubscribe = emitter.subscribe(listener);
      scheduleTicker();
      return () => {
        unsubscribe();
        if (emitter.listeners.size === 0) stopTicker();
      };
    },
    send,
    resend: (requestOptions) =>
      lastInput
        ? send(lastInput, requestOptions)
        : Promise.resolve(skip("no-previous-send")),
    verify,
    reset: () => {
      generation++;
      issueOp.reset();
      verifyOp.reset();
      pending = undefined;
      lastInput = undefined;
      issued = undefined;
      verifyResult = undefined;
      lastError = undefined;
      notify();
    },
    abort,
  };
};
