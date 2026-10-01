/**
 * Phone number parsing, validation, formatting and masking for the OTP UI.
 *
 * Korean mobile numbers are the primary target. International spellings of a
 * Korean mobile (`+82 10-...`, `82 10...`, `0082 10...` and the common
 * mis-dial `+82 010...`) are folded into the national form `010...` before
 * sending. Other countries are accepted as E.164 (`+<country code><number>`)
 * only when `allowInternational` is set.
 *
 * What is sent as `phoneNumber` ({@link OtpPhoneNumber.value}): the national
 * digits for a Korean mobile (`01012345678`, the format of the API's
 * examples) and E.164 for other numbers (`+14155550123`). The same number is
 * thus always sent the same way, whatever the user typed.
 *
 * Pure functions: no DOM, no globals.
 */

export type OtpPhoneKind = "kr-mobile" | "international";

/**
 * Why a phone number is not accepted:
 * - `empty`: nothing entered.
 * - `invalid`: not a phone number (letters, wrong length, ...).
 * - `not-mobile`: a Korean number that is not a mobile (e.g. `02-...`).
 * - `international`: a valid non-Korean number while `allowInternational`
 *   is off.
 */
export type OtpPhoneErrorCode =
  | "empty"
  | "invalid"
  | "not-mobile"
  | "international";

export type OtpPhoneNumber = {
  /** The raw input. */
  readonly input: string;
  readonly valid: boolean;
  /** Set when the input looks like a phone number of that kind. */
  readonly kind: OtpPhoneKind | undefined;
  readonly error: OtpPhoneErrorCode | undefined;
  /**
   * The value to send as `phoneNumber` (only when `valid`): `01012345678`
   * for a Korean mobile, `+14155550123` for other countries.
   */
  readonly value: string | undefined;
  /** National digits of a Korean mobile (`01012345678`). */
  readonly national: string | undefined;
  /** E.164 form (`+821012345678`, `+14155550123`). */
  readonly e164: string | undefined;
  /** Human-readable form (`010-1234-5678`, `+14155550123`). */
  readonly display: string | undefined;
};

export type OtpPhoneOptions = {
  /** Accept non-Korean E.164 numbers (`+1...`). Default `false`. */
  allowInternational?: boolean;
};

/** Same bound as the API (`phoneNumber`: at most 32 characters, trimmed). */
export const OTP_PHONE_NUMBER_MAX_LENGTH = 32;

/** Korean mobile without the trunk `0` (`10` + 8, or `11`/`16`-`19` + 7-8). */
const KR_MOBILE_WITHOUT_TRUNK = /^(?:10\d{8}|1[16789]\d{7,8})$/;
/** E.164: country code + subscriber number, 7 to 15 digits, no leading 0. */
const E164_DIGITS = /^[1-9]\d{6,14}$/;
/** Digits, separators and one leading `+`. */
const PHONE_CHARS = /^\+?[\d\s\-.()/]*$/;

/** NFKC folds full-width digits and `＋` into ASCII. */
const normalize = (input: string): string => input.normalize("NFKC").trim();

const groupKr = (national: string): string =>
  national.length === 10
    ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
    : `${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`;

const result = (
  input: string,
  fields: Partial<Omit<OtpPhoneNumber, "input">>,
): OtpPhoneNumber => ({
  input,
  valid: false,
  kind: undefined,
  error: undefined,
  value: undefined,
  national: undefined,
  e164: undefined,
  display: undefined,
  ...fields,
});

const krMobile = (input: string, national: string): OtpPhoneNumber =>
  result(input, {
    valid: true,
    kind: "kr-mobile",
    value: national,
    national,
    e164: `+82${national.slice(1)}`,
    display: groupKr(national),
  });

/**
 * Parses and validates a phone number entered by an end user.
 *
 * ```ts
 * parseOtpPhoneNumber("+82 10-1234-5678").value; // "01012345678"
 * parseOtpPhoneNumber("010 1234 5678").display;  // "010-1234-5678"
 * parseOtpPhoneNumber("02-123-4567").error;      // "not-mobile"
 * ```
 */
export const parseOtpPhoneNumber = (
  input: string,
  options: OtpPhoneOptions = {},
): OtpPhoneNumber => {
  const text = normalize(input);
  if (!text) return result(input, { error: "empty" });
  if (text.length > OTP_PHONE_NUMBER_MAX_LENGTH || !PHONE_CHARS.test(text)) {
    return result(input, { error: "invalid" });
  }
  const plus = text.startsWith("+");
  const digits = text.replace(/\D+/g, "");
  if (!digits) return result(input, { error: "invalid" });

  // International spellings of a Korean number: +82, 82, 0082.
  const international = digits.startsWith("0082")
    ? digits.slice(4)
    : digits.startsWith("82")
      ? digits.slice(2)
      : undefined;
  if (international !== undefined) {
    const withoutTrunk = international.startsWith("0")
      ? international.slice(1)
      : international;
    if (KR_MOBILE_WITHOUT_TRUNK.test(withoutTrunk)) {
      return krMobile(input, `0${withoutTrunk}`);
    }
    if (plus || digits.startsWith("0082")) {
      // A Korean landline or service number written internationally.
      return result(input, {
        kind: "kr-mobile",
        error: /^0?[2-9]/.test(international) ? "not-mobile" : "invalid",
      });
    }
    return result(input, { error: "invalid" });
  }

  if (plus) {
    if (!E164_DIGITS.test(digits)) return result(input, { error: "invalid" });
    const e164 = `+${digits}`;
    const fields = { kind: "international" as const, e164, display: e164 };
    return options.allowInternational
      ? result(input, { ...fields, valid: true, value: e164 })
      : result(input, { ...fields, error: "international" });
  }

  if (digits.startsWith("0")) {
    if (/^01\d/.test(digits)) {
      return KR_MOBILE_WITHOUT_TRUNK.test(digits.slice(1))
        ? krMobile(input, digits)
        : result(input, { kind: "kr-mobile", error: "invalid" });
    }
    // 02 (Seoul), 031..064 (regions), 070, 080, 15xx-style numbers start
    // without 01: not a mobile.
    return result(input, {
      kind: "kr-mobile",
      error: digits.length >= 9 ? "not-mobile" : "invalid",
    });
  }
  return result(input, { error: "invalid" });
};

/** `true` when `input` is an accepted phone number. */
export const isValidOtpPhoneNumber = (
  input: string,
  options?: OtpPhoneOptions,
): boolean => parseOtpPhoneNumber(input, options).valid;

/**
 * As-you-type formatting for a phone input: keeps digits and a leading `+`
 * and groups Korean mobiles (`010-1234-5678`, `+82 10-1234-5678`). Other
 * input is returned with separators removed. Never rejects input: the
 * validation message is {@link parseOtpPhoneNumber}'s job.
 */
export const formatOtpPhoneInput = (input: string): string => {
  const text = normalize(input);
  const plus = text.startsWith("+");
  const digits = text.replace(/\D+/g, "");
  // Anything that is not a phone number is left as typed.
  if (!PHONE_CHARS.test(text)) return input;
  const progressive = (national: string): string => {
    if (national.length <= 3) return national;
    if (national.length <= 7) {
      return `${national.slice(0, 3)}-${national.slice(3)}`;
    }
    if (national.length === 10 && !national.startsWith("010")) {
      return groupKr(national);
    }
    if (national.length > 11) return national;
    return `${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`;
  };
  if (plus) {
    if (!digits.startsWith("82")) return `+${digits}`;
    const rest = digits.slice(2);
    if (!rest) return "+82";
    // `+82 10-1234-5678` (the trunk 0 is dropped internationally).
    const national = rest.startsWith("0") ? rest : `0${rest}`;
    const grouped = progressive(national);
    return `+82 ${rest.startsWith("0") ? grouped : grouped.slice(1)}`;
  }
  return digits.startsWith("01") ? progressive(digits) : digits;
};

/**
 * Masks the middle of a phone number for display after sending
 * (`010-****-5678`, `+1415***0123`). Returns `undefined` for invalid input.
 */
export const maskOtpPhoneNumber = (
  input: string,
  options: OtpPhoneOptions = { allowInternational: true },
): string | undefined => {
  const phone = parseOtpPhoneNumber(input, options);
  if (!phone.valid) return undefined;
  if (phone.kind === "kr-mobile" && phone.national) {
    const n = phone.national;
    const middle = n.length - 7;
    return `${n.slice(0, 3)}-${"*".repeat(middle)}-${n.slice(-4)}`;
  }
  const e164 = phone.e164 ?? "";
  const keep = 4;
  const head = e164.slice(0, keep + 1);
  const hidden = Math.max(0, e164.length - head.length - keep);
  return `${head}${"*".repeat(hidden)}${e164.slice(head.length + hidden)}`;
};
