// Every export of `@k-otp/sdk/server` under the `browser` condition in 2.0.0 (generated from its
// built declarations). Must keep compiling: see ../compat-2.0.test.ts.
export {
  createIdempotencyKey,
  createOtpServerClient,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  getTestNumberErrorCode,
  isOtpApiError,
  isTestKey,
  matchTestPhoneNumber,
  normalizeIdempotencyKey,
  normalizeOtpApiError,
  OTP_API_ERROR_CODES,
  OtpApiError,
  paginate,
  paginatePages,
  TEST_KEY_PREFIXES,
  TEST_NUMBER_ERROR_CODES,
  TEST_OTP_CODE,
  TEST_PHONE_NUMBERS,
  TEST_SCENARIOS,
} from "../../src/server/browser";
