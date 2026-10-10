/**
 * Test mode (API 1.9.0+): `pk_test_` / `sk_test_` keys never send a message
 * and never use credits. They only accept test phone numbers, whose last two
 * digits pick a deterministic scenario, and every created test issue verifies
 * with {@link TEST_OTP_CODE} (except the `mismatch` scenario).
 *
 * Pure constants and helpers: no I/O, no clock reads. The in-memory API
 * simulator for unit tests is `createMockTransport()` in `@k-otp/sdk/testing`.
 */
import type { OtpApiError } from "./errors";
import type { IssueOtpOutput } from "./generated/openapi";

/**
 * Mode of the API key that produced a response: `"live"`, or `"test"` for a
 * `pk_test_`/`sk_test_` key. Sent as `mode` on issue, verify, status, issue
 * list/detail and balance results by API 1.9.0+ (absent from older APIs).
 */
export type OtpApiMode = NonNullable<IssueOtpOutput["mode"]>;

/** Key prefixes of test-mode keys: public (browser) and secret (server). */
export const TEST_KEY_PREFIXES: readonly ["pk_test_", "sk_test_"] = [
  "pk_test_",
  "sk_test_",
];

/**
 * `true` for a test-mode key (`pk_test_...` or `sk_test_...`). The prefix is
 * what selects the mode on the API; every other key is a live key.
 *
 * ```ts
 * isTestKey("pk_test_abc"); // true
 * isTestKey("sk_live");     // false
 * ```
 */
export const isTestKey = (key: string): boolean => {
  const trimmed = typeof key === "string" ? key.trim() : "";
  return TEST_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
};

/** The fixed code that verifies every test issue (6 zeros). */
export const TEST_OTP_CODE = "000000";

/**
 * Test scenarios, in the order of their two-digit suffix (`00`-`10`).
 * Suffixes `11`-`99` are reserved and behave like `success`.
 */
export const TEST_SCENARIOS: readonly [
  "success",
  "delivery_failed",
  "slow_delivery",
  "ambiguous",
  "expired",
  "mismatch",
  "rate_limited",
  "insufficient_credit",
  "trial_daily_limit",
  "service_unavailable",
  "alimtalk_failover",
] = [
  "success",
  "delivery_failed",
  "slow_delivery",
  "ambiguous",
  "expired",
  "mismatch",
  "rate_limited",
  "insufficient_credit",
  "trial_daily_limit",
  "service_unavailable",
  "alimtalk_failover",
];

/**
 * A test scenario (the last two digits of a test phone number):
 *
 * | Suffix | Scenario | Issue / delivery | Verify |
 * | --- | --- | --- | --- |
 * | `00` | `success` | `sent` after 1 s, `delivered` after 2 s | `000000` |
 * | `01` | `delivery_failed` | `sent` after 1 s, `failed` after 3 s | `000000` |
 * | `02` | `slow_delivery` | `queued`/`sent` until 30 s, then `delivered` | `000000` |
 * | `03` | `ambiguous` | stays `sent`, `providerOutcomeAmbiguous: true` | `000000` |
 * | `04` | `expired` | expires 10 s after issue | `EXPIRED` after that |
 * | `05` | `mismatch` | `delivered` | always `MISMATCH`, then `MAX_ATTEMPTS` |
 * | `06` | `rate_limited` | 429 `perPhone`, `Retry-After: 60` | - |
 * | `07` | `insufficient_credit` | 402 `INSUFFICIENT_CREDIT` | - |
 * | `08` | `trial_daily_limit` | 402 `TRIAL_DAILY_LIMIT_EXCEEDED` | - |
 * | `09` | `service_unavailable` | 503, `Retry-After: 2` | - |
 * | `10` | `alimtalk_failover` | AlimTalk fails, SMS fallback `delivered` after 4 s | `000000` |
 */
export type OtpTestScenario = (typeof TEST_SCENARIOS)[number];

/**
 * One Korean test phone number per scenario, as an end user would type it
 * (`TEST_PHONE_NUMBERS.success` is `"010-0000-0000"`). The UK
 * (`+44 7700 9000xx`) and US (`+1 NXX 555-01xx`) ranges select the same
 * scenarios by their last two digits.
 */
export const TEST_PHONE_NUMBERS: Readonly<Record<OtpTestScenario, string>> = {
  success: "010-0000-0000",
  delivery_failed: "010-0000-0001",
  slow_delivery: "010-0000-0002",
  ambiguous: "010-0000-0003",
  expired: "010-0000-0004",
  mismatch: "010-0000-0005",
  rate_limited: "010-0000-0006",
  insufficient_credit: "010-0000-0007",
  trial_daily_limit: "010-0000-0008",
  service_unavailable: "010-0000-0009",
  alimtalk_failover: "010-0000-0010",
};

/** Region of a test phone number range. */
export type OtpTestPhoneRegion = "KR" | "GB" | "US";

/** A recognized test phone number. */
export type OtpTestPhoneNumber = {
  region: OtpTestPhoneRegion;
  /** Canonical digits, as the API handles the number (`01000000000`). */
  canonical: string;
  /** The last two digits. */
  suffix: string;
  scenario: OtpTestScenario;
};

const TEST_PHONE_PATTERNS: ReadonlyArray<[OtpTestPhoneRegion, RegExp]> = [
  ["KR", /^010000000(\d{2})$/],
  ["GB", /^4477009000(\d{2})$/],
  ["US", /^1[2-9]\d{2}55501(\d{2})$/],
];

/** Digits of a number, with `+82 10...`/`0082 10...` folded to `010...`. */
const canonicalDigits = (phoneNumber: string): string => {
  const digits = phoneNumber.normalize("NFKC").replace(/\D+/g, "");
  const international = digits.startsWith("0082")
    ? digits.slice(4)
    : digits.startsWith("82")
      ? digits.slice(2)
      : undefined;
  if (international === undefined) return digits;
  const national = international.startsWith("0")
    ? international.slice(1)
    : international;
  return /^(?:10\d{8}|1[16789]\d{7,8})$/.test(national)
    ? `0${national}`
    : digits;
};

/**
 * Recognizes a test phone number in any spelling (`010-0000-0001`,
 * `+82 10 0000 0001`, `+44 7700 900001`, `+1 415 555 0101`) and returns its
 * scenario, or `undefined` for any other number. A test key rejects every
 * other number (400 `TEST_NUMBER_REQUIRED`); a live key rejects test numbers
 * (400 `TEST_NUMBER_IN_LIVE_MODE`).
 */
export const matchTestPhoneNumber = (
  phoneNumber: string,
): OtpTestPhoneNumber | undefined => {
  if (typeof phoneNumber !== "string") return undefined;
  const canonical = canonicalDigits(phoneNumber);
  for (const [region, pattern] of TEST_PHONE_PATTERNS) {
    const suffix = pattern.exec(canonical)?.[1];
    if (suffix !== undefined) {
      const index = Number(suffix);
      return {
        region,
        canonical,
        suffix,
        scenario: TEST_SCENARIOS[index] ?? "success",
      };
    }
  }
  return undefined;
};

/**
 * `data.code` values of a 400 BAD_REQUEST `issue` error about the key mode
 * (the same code is the first token of `message`):
 * `TEST_NUMBER_REQUIRED` (a test key with a real number) and
 * `TEST_NUMBER_IN_LIVE_MODE` (a live key with a test number).
 */
export const TEST_NUMBER_ERROR_CODES: readonly [
  "TEST_NUMBER_REQUIRED",
  "TEST_NUMBER_IN_LIVE_MODE",
] = ["TEST_NUMBER_REQUIRED", "TEST_NUMBER_IN_LIVE_MODE"];

export type OtpTestNumberErrorCode = (typeof TEST_NUMBER_ERROR_CODES)[number];

/**
 * The test-number code of an `issue` error, or `undefined` for any other
 * error. `OtpApiError.code` stays `"BAD_REQUEST"`; the specific code is in
 * `error.data.code`.
 *
 * ```ts
 * if (getTestNumberErrorCode(error) === "TEST_NUMBER_REQUIRED") {
 *   // a pk_test_/sk_test_ key was used with a real phone number
 * }
 * ```
 */
export const getTestNumberErrorCode = (
  error: OtpApiError | unknown,
): OtpTestNumberErrorCode | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const { status, data } = error as { status?: unknown; data?: unknown };
  if (status !== 400 || typeof data !== "object" || data === null) {
    return undefined;
  }
  const code = (data as { code?: unknown }).code;
  return (TEST_NUMBER_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as OtpTestNumberErrorCode)
    : undefined;
};
