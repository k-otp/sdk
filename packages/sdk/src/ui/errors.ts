/**
 * Maps an `OtpApiError` to what the OTP UI shows for it: a message key of
 * the catalog, the field it belongs to, and the facts an integrator needs to
 * diagnose it (the API's specific reason, request id, wait).
 *
 * End users only ever see catalog messages: never `error.message` (server
 * text) and never an integration detail such as a template or key problem.
 * Those errors get neutral wording and `configuration: true`, so the site
 * can log them (`onError`, `state.errorDetail`) with the `requestId`.
 */
import {
  getOtpErrorReason,
  isAmbiguousIssueError,
  type OtpApiError,
  type OtpApiErrorCode,
} from "../core/errors";
import type { OtpMessageKey, OtpMessageParams } from "./messages";

/**
 * Where an error belongs: under the phone input, under the code input, or
 * in the form's status message.
 */
export type OtpFormErrorTarget = "phone" | "code" | "form";

/** The parts of an `OtpApiError` that {@link describeOtpError} reads. */
export type OtpDescribableError = Pick<OtpApiError, "code" | "retryable"> &
  Partial<Pick<OtpApiError, "status" | "data" | "requestId" | "retryAfterMs">>;

/** What the UI shows for an error, and why. */
export type OtpErrorDetail = {
  /** Normalized SDK code (`error.code`). */
  readonly code: OtpApiErrorCode;
  /** HTTP status, `0` when no response was received. */
  readonly status: number;
  /**
   * The API's specific reason (see `getOtpErrorReason`): `data.code` of a
   * 4xx (`PHONE_NUMBER_NOT_MOBILE`, `TEST_NUMBER_REQUIRED`,
   * `TRIAL_DAILY_LIMIT_EXCEEDED`, ...) or `data.limit` of a 429 (`perPhone`,
   * ...). A reason this SDK version does not know is still reported here,
   * and shown with the message of `code`.
   */
  readonly reason: string | undefined;
  /** The operation that failed, when known. */
  readonly operation: "send" | "verify" | undefined;
  /** Where to show the message. */
  readonly target: OtpFormErrorTarget;
  /** Message key of the catalog to show (translate it with `params`). */
  readonly key: OtpMessageKey;
  /** Placeholders of `key` (e.g. `resetAt` of a daily send limit). */
  readonly params: OtpMessageParams;
  /**
   * The site's integration has to be fixed, not the end user's input: the
   * API key or its allowed origins (401/403), the wallet (402), or an
   * `issue` option or template the API does not accept. The message stays
   * neutral; log the error (with `requestId`) to diagnose it.
   */
  readonly configuration: boolean;
  /**
   * A send may have reached the API (timeout, network, 5xx, unreadable
   * response): sending again reuses the same idempotency key, so no second
   * message is sent (`error.sendUncertain`).
   */
  readonly ambiguous: boolean;
  /** Retrying may succeed (`error.retryable`). */
  readonly retryable: boolean;
  /** Wait before retrying, in ms (`error.retryAfterMs`). */
  readonly retryAfterMs: number | undefined;
  /** Request id of the response, for support requests (`error.requestId`). */
  readonly requestId: string | undefined;
};

/**
 * Message key, target and `configuration` of the API reasons the catalog
 * has a message for (`getOtpErrorReason`: a 4xx `data.code` or a 429
 * `data.limit`). Any other reason falls back to the message of `code`.
 */
const REASONS: ReadonlyMap<
  string,
  readonly [OtpMessageKey, OtpFormErrorTarget?, boolean?]
> = new Map<string, readonly [OtpMessageKey, OtpFormErrorTarget?, boolean?]>([
  ["PHONE_NUMBER_NOT_MOBILE", ["phone.error.not-mobile", "phone"]],
  ["TEST_NUMBER_REQUIRED", ["error.TEST_NUMBER_REQUIRED", "phone"]],
  ["TEST_NUMBER_IN_LIVE_MODE", ["error.TEST_NUMBER_IN_LIVE_MODE", "phone"]],
  ["CHANNEL_NOT_SUPPORTED", ["error.unavailable", "form", true]],
  ["TEMPLATE_NOT_AVAILABLE", ["error.unavailable", "form", true]],
  ["WEB_OTP_NOT_SUPPORTED", ["error.unavailable", "form", true]],
  ["TRIAL_DAILY_LIMIT_EXCEEDED", ["error.limit.daily"]],
  ["perPhone", ["error.limit.perPhone"]],
  ["perKey", ["error.limit.perKey"]],
  ["perKeyDaily", ["error.limit.daily"]],
  ["perOrgDaily", ["error.limit.daily"]],
  ["testModeDaily", ["error.limit.daily"]],
]);

/** Codes the integration has to fix (key, allowed origins, wallet). */
const CONFIGURATION_CODES: ReadonlySet<OtpApiErrorCode> = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PAYMENT_REQUIRED",
]);

/**
 * Describes an SDK error for the UI: the message key, the field it targets
 * and the API's specific reason. With `operation: "send"`, an ambiguous
 * failure (timeout, network, 5xx, abort) maps to `error.sendUncertain`: the
 * code may have been sent, and retrying reuses the same idempotency key.
 *
 * ```ts
 * const detail = describeOtpError(error, "send");
 * if (detail.target === "phone") showUnderPhoneInput(t(detail.key, detail.params));
 * if (detail.configuration) report(error, detail.requestId);
 * ```
 */
export const describeOtpError = (
  error: OtpDescribableError,
  operation?: "send" | "verify",
): OtpErrorDetail => {
  const reason = getOtpErrorReason(error);
  const ambiguous =
    operation === "send" &&
    error.code !== "TOO_MANY_REQUESTS" &&
    isAmbiguousIssueError(error);
  const known = reason === undefined ? undefined : REASONS.get(reason);
  let key: OtpMessageKey = `error.${error.code}`;
  let target: OtpFormErrorTarget = "form";
  if (ambiguous) key = "error.sendUncertain";
  else if (known) [key, target = "form"] = known;
  else if (
    error.code === "BAD_REQUEST" &&
    operation === "verify" &&
    reason === undefined
  ) {
    // The only 400 of `verify` the end user can cause: a malformed code.
    key = "code.error.invalid";
    target = "code";
  }
  const resetAt = (error.data as { resetAt?: unknown } | null | undefined)
    ?.resetAt;
  return {
    code: error.code,
    status: error.status ?? 0,
    reason,
    operation,
    target,
    key,
    params: typeof resetAt === "string" ? { resetAt } : {},
    configuration:
      !ambiguous &&
      (CONFIGURATION_CODES.has(error.code) || known?.[2] === true),
    ambiguous,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    requestId: error.requestId,
  };
};
