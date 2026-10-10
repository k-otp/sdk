/**
 * `@k-otp/sdk/testing`: test-mode helpers for your own tests. The in-memory
 * API simulator `createMockTransport()` (no network, the same scenario table
 * as `pk_test_`/`sk_test_` keys on the API), its timeline constants, and the
 * test-mode constants of `@k-otp/sdk` re-exported for convenience.
 *
 * Covered by SemVer. Pure: nothing runs at import time.
 */
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
} from "../core/test-mode";
export {
  createMockTransport,
  type MockTestIssue,
  type MockTransport,
  type MockTransportOptions,
  TEST_MODE_AMBIGUOUS_OUTCOME_CODE,
  TEST_MODE_SIMULATED_BALANCE,
  TEST_MODE_TIMINGS,
} from "./mock-transport";
