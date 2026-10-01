/**
 * Model of a segmented one-time-code input: one `<input>` per digit, filled
 * from the left. The value is always a contiguous string of digits (no gaps),
 * and segment `i` shows `value[i]`.
 *
 * Every function is pure (value in, value + focus index out); the DOM part
 * (reading events, moving focus) is in `parts.ts` and the framework
 * components.
 */

/** The K-OTP API issues 6-digit codes. */
export const DEFAULT_OTP_CODE_LENGTH = 6;

const clampLength = (length: number): number =>
  Number.isInteger(length) && length > 0 ? length : DEFAULT_OTP_CODE_LENGTH;

/**
 * Normalizes typed or pasted text into code digits: full-width and other
 * compatibility digits become ASCII (NFKC), and when the text contains a
 * standalone run of exactly `length` digits (optionally split by spaces or
 * hyphens, e.g. `123 456` or `123-456`), that run is the code. Otherwise every
 * non-digit is dropped. The result is at most `length` digits.
 *
 * ```ts
 * sanitizeOtpCode("１２３ ４５６");                      // "123456"
 * sanitizeOtpCode("[K-OTP] 인증번호는 123456입니다. 3분"); // "123456"
 * ```
 */
export const sanitizeOtpCode = (
  text: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): string => {
  const size = clampLength(length);
  const normalized = text.normalize("NFKC");
  const run = new RegExp(`(?<!\\d)\\d(?:[\\s-]?\\d){${size - 1}}(?!\\d)`);
  const match = run.exec(normalized);
  const digits = (match ? match[0] : normalized).replace(/\D+/g, "");
  return digits.slice(0, size);
};

/** The digit shown by each segment (`""` when empty). */
export const otpCodeSegments = (
  value: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): string[] =>
  Array.from({ length: clampLength(length) }, (_, i) => value[i] ?? "");

/** `true` when every segment is filled. */
export const isOtpCodeComplete = (
  value: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): boolean => new RegExp(`^\\d{${clampLength(length)}}$`).test(value);

/**
 * The segment that may receive focus when the user focuses segment `index`:
 * segments after the first empty one redirect to it (no gaps).
 */
export const otpCodeFocusIndex = (
  value: string,
  index: number,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): number =>
  Math.max(0, Math.min(index, value.length, clampLength(length) - 1));

/** New code value and the segment to focus afterwards. */
export type OtpCodeChange = {
  readonly value: string;
  readonly focus: number;
};

/** Writes `digits` starting at `index` (pasted text or one typed digit). */
const write = (
  value: string,
  index: number,
  digits: string,
  length: number,
): OtpCodeChange => {
  const size = clampLength(length);
  const start = Math.min(index, value.length);
  const next = (
    value.slice(0, start) +
    digits +
    value.slice(start + digits.length)
  ).slice(0, size);
  return { value: next, focus: Math.min(start + digits.length, size - 1) };
};

/**
 * The `input` event of segment `index`, whose element now contains `text`.
 *
 * - One new digit replaces the segment and moves to the next one. When the
 *   segment already had a digit, the element may contain both (`"57"`): the
 *   one that is not the old digit wins.
 * - Several digits (OS autofill of `one-time-code`, IME, drag and drop) are
 *   written across the segments from `index`; a full-length code always
 *   replaces the whole value.
 * - An empty element clears the segment (as Backspace would).
 */
export const applyOtpCodeInput = (
  value: string,
  index: number,
  text: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): OtpCodeChange => {
  const size = clampLength(length);
  const digits = text.normalize("NFKC").replace(/\D+/g, "");
  const at = Math.min(index, value.length);
  if (!digits) {
    const next = value.slice(0, at) + value.slice(at + 1);
    return { value: next, focus: otpCodeFocusIndex(next, at, size) };
  }
  if (digits.length >= size) {
    return { value: sanitizeOtpCode(text, size), focus: size - 1 };
  }
  const previous = value[at];
  if (digits.length === 2 && previous !== undefined) {
    const typed = digits[0] === previous ? digits[1] : digits[0];
    return write(value, at, typed ?? "", size);
  }
  return write(value, at, digits, size);
};

/** Pasted text on segment `index` (sanitized, written from that segment). */
export const applyOtpCodePaste = (
  value: string,
  index: number,
  text: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): OtpCodeChange => {
  const size = clampLength(length);
  const digits = sanitizeOtpCode(text, size);
  if (!digits) return { value, focus: otpCodeFocusIndex(value, index, size) };
  if (digits.length === size) return { value: digits, focus: size - 1 };
  return write(value, index, digits, size);
};

/**
 * Keyboard navigation of segment `index`. Returns `undefined` for keys the
 * input should handle natively (digits, Tab, shortcuts).
 *
 * - Backspace: clears the segment; on an empty segment, clears the previous
 *   one and moves there.
 * - Delete: clears the segment (later digits shift left).
 * - ArrowLeft / ArrowRight / Home / End: moves between segments.
 */
export const applyOtpCodeKey = (
  value: string,
  index: number,
  key: string,
  length: number = DEFAULT_OTP_CODE_LENGTH,
): OtpCodeChange | undefined => {
  const size = clampLength(length);
  const at = Math.min(index, value.length);
  switch (key) {
    case "Backspace": {
      if (at < value.length) {
        return { value: value.slice(0, at) + value.slice(at + 1), focus: at };
      }
      if (at === 0) return { value, focus: 0 };
      return { value: value.slice(0, at - 1), focus: at - 1 };
    }
    case "Delete": {
      const next = value.slice(0, at) + value.slice(at + 1);
      return { value: next, focus: otpCodeFocusIndex(next, at, size) };
    }
    case "ArrowLeft":
      return { value, focus: Math.max(0, at - 1) };
    case "ArrowRight":
      return { value, focus: otpCodeFocusIndex(value, at + 1, size) };
    case "Home":
      return { value, focus: 0 };
    case "End":
      return { value, focus: otpCodeFocusIndex(value, size, size) };
    default:
      return undefined;
  }
};
