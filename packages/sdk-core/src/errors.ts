/**
 * Normalized error model shared by every K-OTP SDK package.
 *
 * Every rejected SDK promise rejects with an {@link OtpApiError}, whatever went
 * wrong (HTTP error envelope, non-JSON gateway error, timeout, network
 * failure, abort, or a client-side validation failure before any request).
 */

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

/** `data` of a 402 PAYMENT_REQUIRED error from `issue`. */
export type OtpPaymentRequiredData = {
  code: "INSUFFICIENT_CREDIT" | "OVERDRAFT_LIMIT_EXCEEDED" | (string & {});
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

const BRAND: symbol = Symbol.for("@k-otp/sdk-core/OtpApiError");

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
  /** Error payload, e.g. {@link OtpPaymentRequiredData} for 402. */
  readonly data: unknown;
  /** Suggested wait before retrying (from `Retry-After` or the error body). */
  readonly retryAfterMs: number | undefined;

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
  value instanceof OtpApiError ||
  (typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const retryAfterFromBody = (data: unknown): number | undefined => {
  if (!isRecord(data)) return undefined;
  if (typeof data.retryAfterMs === "number" && data.retryAfterMs >= 0) {
    return data.retryAfterMs;
  }
  if (typeof data.retryAfter === "number" && data.retryAfter >= 0) {
    return Math.round(data.retryAfter * 1000);
  }
  return undefined;
};

/**
 * Builds an {@link OtpApiError} from an HTTP error response.
 *
 * `body` is the decoded body: normally the API envelope
 * `{ defined, code, status, message, data? }`, but gateways can return HTML or
 * plain text, which falls back to status-based mapping.
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
    typeof envelope?.message === "string" && envelope.message
      ? envelope.message
      : `K-OTP API request failed with HTTP ${status}`;
  const data = envelope
    ? envelope.data
    : typeof body === "string" && body
      ? body
      : undefined;
  return new OtpApiError({
    code,
    status,
    message,
    requestId: readRequestId(headers),
    data,
    retryAfterMs:
      parseRetryAfter(readHeader(headers, "retry-after")) ??
      retryAfterFromBody(data),
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
