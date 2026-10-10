export {
  createOtpClient,
  type OtpClient,
  type OtpClientOptions,
} from "./client";
export {
  isOtpApiError,
  normalizeOtpApiError,
  OTP_API_ERROR_CODES,
  OtpApiError,
  type OtpApiErrorCode,
  type OtpApiErrorOptions,
  type OtpBadRequestData,
  type OtpPaymentRequiredData,
  type OtpRateLimitedData,
  otpErrorCodeFromStatus,
  parseRetryAfter,
} from "./errors";
export {
  createIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  normalizeIdempotencyKey,
} from "./idempotency";
export {
  getTestNumberErrorCode,
  isTestKey,
  matchTestPhoneNumber,
  type OtpApiMode,
  type OtpTestNumberErrorCode,
  type OtpTestPhoneNumber,
  type OtpTestPhoneRegion,
  type OtpTestScenario,
  TEST_KEY_PREFIXES,
  TEST_NUMBER_ERROR_CODES,
  TEST_OTP_CODE,
  TEST_PHONE_NUMBERS,
  TEST_SCENARIOS,
} from "./test-mode";
export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  type OtpApiKey,
  type OtpOperation,
  type OtpRequestEndInfo,
  type OtpRequestOptions,
  type OtpTelemetryHooks,
  type OtpTransportOptions,
} from "./transport";
export type * from "./types";
