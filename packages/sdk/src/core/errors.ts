/**
 * Normalized error model shared by every K-OTP SDK package.
 *
 * Every rejected SDK promise rejects with an {@link OtpApiError}, whatever went
 * wrong (HTTP error envelope, non-JSON gateway error, timeout, network
 * failure, abort, or a client-side validation failure before any request).
 */

import type {
  IssueOtpPaymentErrorData,
  OtpRateLimitErrorData,
} from "./generated/openapi";

/** All normalized error codes. */
export const OTP_API_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "PAYMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_MANY_REQUESTS",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
  "NETWORK_ERROR",
  "ABORTED",
  "UNKNOWN",
] as const;

export type OtpApiErrorCode = (typeof OTP_API_ERROR_CODES)[number];

/**
 * `data` of a 402 PAYMENT_REQUIRED error from `issue`: the generated wire type
 * (including `resetAt` of `TRIAL_DAILY_LIMIT_EXCEEDED`), with `code` open to
 * reasons a newer API version may add.
 */
export type OtpPaymentRequiredData = Omit<IssueOtpPaymentErrorData, "code"> & {
  code: IssueOtpPaymentErrorData["code"] | (string & {});
};

/**
 * The `data.code` of a 400 error when it is one of `codes`, else `undefined`
 * (internal; shared by the code-family helpers such as
 * {@link getIssueRequestErrorCode}).
 */
export const badRequestDataCode = <T extends string>(
  error: unknown,
  codes: readonly T[],
): T | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const { status, data } = error as { status?: unknown; data?: unknown };
  if (status !== 400 || typeof data !== "object" || data === null) {
    return undefined;
  }
  const code = (data as { code?: unknown }).code;
  return (codes as readonly unknown[]).includes(code) ? (code as T) : undefined;
};

/**
 * `data.code` values of a 400 BAD_REQUEST `issue` error about a request the
 * API cannot serve (the same code is the first token of `message`):
 *
 * - `CHANNEL_NOT_SUPPORTED`: `channel` was `"sms"`. Only `"alimtalk"` (the
 *   default) is accepted; SMS is only the automatic fallback.
 * - `TEMPLATE_NOT_AVAILABLE`: the template has no approved AlimTalk code
 *   (`channelSupport` of `listTemplates`/`getTemplate` is empty for it).
 * - `WEB_OTP_NOT_SUPPORTED`: `webOtp` was set to anything but `false`.
 * - `PHONE_NUMBER_NOT_MOBILE` (API 2.3.0+): `phoneNumber` is a Korean
 *   landline (an area-code number such as `02-...` or `031-...`), which can
 *   receive neither KakaoTalk nor SMS. Ask the user for a mobile number.
 */
export const ISSUE_REQUEST_ERROR_CODES: readonly [
  "CHANNEL_NOT_SUPPORTED",
  "TEMPLATE_NOT_AVAILABLE",
  "WEB_OTP_NOT_SUPPORTED",
  "PHONE_NUMBER_NOT_MOBILE",
] = [
  "CHANNEL_NOT_SUPPORTED",
  "TEMPLATE_NOT_AVAILABLE",
  "WEB_OTP_NOT_SUPPORTED",
  "PHONE_NUMBER_NOT_MOBILE",
];

export type OtpIssueRequestErrorCode =
  (typeof ISSUE_REQUEST_ERROR_CODES)[number];

/**
 * The issue-request code of an `issue` error, or `undefined` for any other
 * error. `OtpApiError.code` stays `"BAD_REQUEST"`; the specific code is in
 * `error.data.code`.
 *
 * ```ts
 * if (getIssueRequestErrorCode(error) === "TEMPLATE_NOT_AVAILABLE") {
 *   // pick another template (see `channelSupport` of `listTemplates`)
 * }
 * if (getIssueRequestErrorCode(error) === "PHONE_NUMBER_NOT_MOBILE") {
 *   // ask the user for a mobile number (a landline cannot receive codes)
 * }
 * ```
 */
export const getIssueRequestErrorCode = (
  error: OtpApiError | unknown,
): OtpIssueRequestErrorCode | undefined =>
  badRequestDataCode(error, ISSUE_REQUEST_ERROR_CODES);

/**
 * `data` of a 400 BAD_REQUEST error, when the API names the cause. From API
 * 1.9.0 `issue` sets `code` to `TEST_NUMBER_REQUIRED` (a `pk_test_`/`sk_test_`
 * key with a real phone number) or `TEST_NUMBER_IN_LIVE_MODE` (a live key
 * with a test phone number); see `getTestNumberErrorCode`. From API 2.0.0 it
 * is also `CHANNEL_NOT_SUPPORTED`, `TEMPLATE_NOT_AVAILABLE` or
 * `WEB_OTP_NOT_SUPPORTED`, and from API 2.3.0 `PHONE_NUMBER_NOT_MOBILE` (a
 * Korean landline number); see `getIssueRequestErrorCode`. Other 400 errors
 * have no `data`. A newer API version may add codes: treat an unknown one
 * like a plain `BAD_REQUEST`.
 */
export type OtpBadRequestData = {
  code:
    | "TEST_NUMBER_REQUIRED"
    | "TEST_NUMBER_IN_LIVE_MODE"
    | OtpIssueRequestErrorCode
    | (string & {});
};

/**
 * `data` of a 429 TOO_MANY_REQUESTS error: the generated wire type, open to
 * rules and policies a newer API version may add. The wait is also
 * normalized into {@link OtpApiError.retryAfterMs}.
 */
export type OtpRateLimitedData = {
  /**
   * Rule that rejected the request: `perKey`, `perIp`, `perPhone`, or for
   * test-mode keys (API 1.9.0+) `perKeyDaily` (daily cap per key and
   * operation), `perOrgDaily` (daily test issue budget of the organization)
   * or `testModeDaily` (platform-wide daily test issue budget).
   */
  limit: OtpRateLimitErrorData["limit"] | (string & {});
  /** `key` (the key's own policy) or `platform` (default or ceiling). */
  policy: OtpRateLimitErrorData["policy"] | (string & {});
  /** Milliseconds until a retry can be admitted. */
  retryAfterMs: number;
};

export type OtpApiErrorOptions = {
  code: OtpApiErrorCode;
  /** HTTP status, or `0` when no HTTP response was received. */
  status: number;
  message: string;
  requestId?: string | undefined;
  data?: unknown;
  retryAfterMs?: number | undefined;
  cause?: unknown;
};

const BRAND: symbol = Symbol.for("@k-otp/sdk/OtpApiError");

const hasBrand = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<symbol, unknown>)[BRAND] === true;

const ordinaryHasInstance = (target: unknown, value: unknown): boolean =>
  Function.prototype[Symbol.hasInstance].call(target, value);

/** Codes for which retrying the same request later may succeed. */
const RETRYABLE_CODES: ReadonlySet<OtpApiErrorCode> = new Set([
  "TOO_MANY_REQUESTS",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
  "NETWORK_ERROR",
]);

export class OtpApiError extends Error {
  override readonly name: "OtpApiError" = "OtpApiError";
  readonly code: OtpApiErrorCode;
  /** HTTP status, or `0` when no HTTP response was received. */
  readonly status: number;
  /** Server request id (`x-request-id` / `request-id` / `cf-ray`), if exposed. */
  readonly requestId: string | undefined;
  /**
   * Error payload, e.g. {@link OtpBadRequestData} for some 400 errors,
   * {@link OtpPaymentRequiredData} for 402 or {@link OtpRateLimitedData} for
   * 429.
   */
  readonly data: unknown;
  /**
   * Suggested wait before retrying, in ms: the error body's
   * `data.retryAfterMs`, else the `Retry-After` header (seconds or HTTP
   * date), else `data.retryAfter` (seconds). Set on 429 TOO_MANY_REQUESTS
   * and, when the server sends one, on 503.
   */
  readonly retryAfterMs: number | undefined;

  /**
   * `error instanceof OtpApiError` is also true for errors created by another
   * copy of the SDK (the ESM and CommonJS builds loaded side by side, the CDN
   * bundle): every `OtpApiError` carries the same `Symbol.for` brand.
   * Subclasses keep the ordinary prototype check.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    // biome-ignore lint/complexity/noThisInStatic lint/complexity/noUselessThisAlias: the subclass in `x instanceof Subclass`.
    const target: unknown = this;
    return (
      ordinaryHasInstance(target, value) ||
      (target === OtpApiError && hasBrand(value))
    );
  }

  constructor(options: OtpApiErrorOptions) {
    super(
      options.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.data = options.data;
    this.retryAfterMs = options.retryAfterMs;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /**
   * Whether retrying may succeed. For `issue`, a retry MUST reuse the same
   * idempotency key: a TIMEOUT/NETWORK_ERROR/503 outcome can be ambiguous
   * (the OTP may already have been sent).
   */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  toJSON(): {
    name: string;
    code: OtpApiErrorCode;
    status: number;
    message: string;
    requestId?: string;
    data?: unknown;
    retryAfterMs?: number;
  } {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.data === undefined ? {} : { data: this.data }),
      ...(this.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: this.retryAfterMs }),
    };
  }
}

/**
 * Realm/bundle-safe `instanceof OtpApiError` (works across duplicated copies,
 * e.g. the CDN bundle and an npm install).
 */
export const isOtpApiError = (value: unknown): value is OtpApiError =>
  ordinaryHasInstance(OtpApiError, value) || hasBrand(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A machine-readable reason: an identifier, never free text. */
const REASON_PATTERN = /^[a-z][\w.-]{0,63}$/i;

/**
 * The specific reason of an API error, when the API names one: `data.code`
 * of a 4xx error (400 `PHONE_NUMBER_NOT_MOBILE`, `TEST_NUMBER_REQUIRED`,
 * `TEMPLATE_NOT_AVAILABLE`, ...; 402 `INSUFFICIENT_CREDIT`,
 * `TRIAL_DAILY_LIMIT_EXCEEDED`, ...) or `data.limit` of a 429 (`perPhone`,
 * `perKey`, ...). `undefined` for every other error.
 *
 * Reasons a newer API version adds are returned as they are, so log them
 * and fall back to `error.code` for anything you do not handle. Only
 * identifier-like values (letters, digits, `_`, `.`, `-`; at most 64
 * characters) count as a reason.
 *
 * ```ts
 * switch (getOtpErrorReason(error)) {
 *   case "PHONE_NUMBER_NOT_MOBILE": // ask for a mobile number
 *   case "perPhone": // too many codes to this number: wait error.retryAfterMs
 * }
 * ```
 */
export const getOtpErrorReason = (
  error: OtpApiError | unknown,
): string | undefined => {
  const { status, data } = isRecord(error) ? error : {};
  const reason =
    isRecord(data) &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
      ? data[status === 429 ? "limit" : "code"]
      : undefined;
  return typeof reason === "string" && REASON_PATTERN.test(reason)
    ? reason
    : undefined;
};

const isKnownCode = (value: unknown): value is OtpApiErrorCode =>
  typeof value === "string" &&
  (OTP_API_ERROR_CODES as readonly string[]).includes(value);

/** Maps an HTTP status to a normalized code. */
export const otpErrorCodeFromStatus = (status: number): OtpApiErrorCode => {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 402:
      return "PAYMENT_REQUIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 408:
      return "TIMEOUT";
    case 409:
      return "CONFLICT";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 502:
    case 503:
    case 504:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 && status < 600
        ? "INTERNAL_SERVER_ERROR"
        : "UNKNOWN";
  }
};

type HeaderBag =
  | Headers
  | Record<string, string | readonly string[] | undefined>
  | undefined;

const readHeader = (headers: HeaderBag, name: string): string | undefined => {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<
    string,
    string | readonly string[] | undefined
  >;
  const value =
    record[name] ??
    Object.entries(record).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === "string" ? value : value?.[0];
};

const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "cf-ray"] as const;

/** Reads the first request-id-like response header. */
export const readRequestId = (headers: HeaderBag): string | undefined => {
  for (const name of REQUEST_ID_HEADERS) {
    const value = readHeader(headers, name)?.trim();
    if (value) return value;
  }
  return undefined;
};

/**
 * Parses `Retry-After` (delta-seconds or HTTP-date) into milliseconds.
 * Returns `undefined` for missing/invalid values.
 */
export const parseRetryAfter = (
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

const isWait = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** `data.retryAfterMs`, else `Retry-After`, else `data.retryAfter` (s). */
const resolveRetryAfterMs = (
  data: unknown,
  headers: HeaderBag,
): number | undefined => {
  const body = isRecord(data) ? data : undefined;
  if (isWait(body?.retryAfterMs)) return Math.ceil(body.retryAfterMs);
  const header = parseRetryAfter(readHeader(headers, "retry-after"));
  if (header !== undefined) return header;
  if (isWait(body?.retryAfter)) return Math.round(body.retryAfter * 1000);
  return undefined;
};

/** Longest server text kept in `message` (or a plain-text `data`). */
const MAX_SERVER_TEXT_LENGTH = 300;

/** Looks like markup: an HTML error page or a fragment of one. */
const MARKUP = /<\/?[a-z!][^>]*>/i;

/**
 * Server-provided text that is safe to keep: whitespace collapsed, at most
 * {@link MAX_SERVER_TEXT_LENGTH} characters, `undefined` when it is empty or
 * markup (an HTML error page of a gateway or proxy).
 */
const serverText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped.
  const text = value.replace(/[\s\0-\x1f\x7f]+/g, " ").trim();
  if (!text || MARKUP.test(text)) return undefined;
  return text.length > MAX_SERVER_TEXT_LENGTH
    ? `${text.slice(0, MAX_SERVER_TEXT_LENGTH - 1)}\u2026`
    : text;
};

/**
 * Builds an {@link OtpApiError} from an HTTP error response.
 *
 * `body` is the decoded body: normally the API envelope
 * `{ defined, code, status, message, data? }`, but gateways can return HTML or
 * plain text, which falls back to status-based mapping. Server text is
 * bounded: an HTML page never becomes `message` or `data`, and a long
 * `message` is cut to 300 characters.
 */
export const otpErrorFromResponse = (
  status: number,
  body: unknown,
  headers?: HeaderBag,
): OtpApiError => {
  const envelope = isRecord(body) ? body : undefined;
  const code = isKnownCode(envelope?.code)
    ? envelope.code
    : otpErrorCodeFromStatus(status);
  const message =
    serverText(envelope?.message) ??
    `K-OTP API request failed with HTTP ${status}`;
  let data: unknown;
  if (envelope) data = envelope.data;
  // A plain-text body (e.g. from a proxy) is kept as `data`, never an HTML
  // error page.
  else data = serverText(body);
  return new OtpApiError({
    code,
    status,
    message,
    requestId: readRequestId(headers),
    data,
    // `data.retryAfterMs` is exact; `Retry-After` is the same wait rounded up
    // to whole seconds, and the only one a gateway or older API may send.
    retryAfterMs: resolveRetryAfterMs(data, headers),
  });
};

/**
 * Normalizes any thrown value into an {@link OtpApiError}. Already-normalized
 * errors are returned unchanged.
 */
export const normalizeOtpApiError = (error: unknown): OtpApiError => {
  if (isOtpApiError(error)) return error;
  if (isRecord(error) && typeof error.status === "number" && error.status > 0) {
    return otpErrorFromResponse(error.status, error);
  }
  const message =
    error instanceof Error ? error.message : "Unknown K-OTP SDK error";
  return new OtpApiError({ code: "UNKNOWN", status: 0, message, cause: error });
};

/** Whether an issue may have reached the server: retry the same input with the same idempotency key. */
export const isAmbiguousIssueError = (
  error: Pick<OtpApiError, "code" | "retryable"> &
    Partial<Pick<OtpApiError, "status">>,
): boolean =>
  error.retryable ||
  error.code === "ABORTED" ||
  (error.code === "UNKNOWN" &&
    (error.status === 0 ||
      (typeof error.status === "number" &&
        error.status >= 200 &&
        error.status < 400)));
