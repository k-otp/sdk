/**
 * Message catalog of the OTP UI (Korean and English): labels, button copy,
 * status lines, and one message per SDK error code, verify reason code and
 * flow skip reason. Override any entry with `messages` and pick the language
 * with `locale`.
 */
import type { OtpApiError, OtpApiErrorCode } from "../core/errors";
import type { VerifyReasonCode } from "../core/types";
import type { OtpFlowSkipReason } from "../headless";
import type { OtpPhoneErrorCode } from "./phone";

export type OtpLocale = "ko" | "en";

/** The locale when none is given (on the server and in the browser). */
export const DEFAULT_OTP_LOCALE: OtpLocale = "ko";

/**
 * A locale, or `"auto"`: follow the page's `<html lang>` (Korean for `ko*`
 * or no `lang`, English for any other language). `"auto"` renders Korean on
 * the server and on the first client render (so hydration matches), then
 * switches after mount and follows later `lang` changes.
 */
export type OtpLocaleOption = OtpLocale | "auto";

/**
 * The locale to render: `locale` when it is `"ko"` or `"en"`, otherwise
 * (`undefined`, `"auto"` before mount) {@link DEFAULT_OTP_LOCALE}.
 * Deterministic: the same on the server and the client.
 */
export const resolveOtpLocale = (locale?: OtpLocaleOption): OtpLocale =>
  locale === "en" || locale === "ko" ? locale : DEFAULT_OTP_LOCALE;

/**
 * The locale of the page's `<html lang>`: `"ko"` for Korean or no `lang`,
 * `"en"` for any other language. `"ko"` without a document (server).
 */
export const detectOtpDocumentLocale = (): OtpLocale => {
  const lang =
    typeof document === "undefined"
      ? ""
      : (document.documentElement?.lang ?? "").trim().toLowerCase();
  return lang === "" || lang.startsWith("ko") ? "ko" : "en";
};

/**
 * Calls `onChange` with {@link detectOtpDocumentLocale} now and whenever
 * `<html lang>` changes (for `locale: "auto"`, after mount). Returns the
 * function that stops watching. Does nothing without a document.
 */
export const watchOtpDocumentLocale = (
  onChange: (locale: OtpLocale) => void,
): (() => void) => {
  if (typeof document === "undefined") return () => {};
  onChange(detectOtpDocumentLocale());
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() =>
    onChange(detectOtpDocumentLocale()),
  );
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return () => observer.disconnect();
};

const en = {
  "phone.label": "Phone number",
  "phone.placeholder": "010-1234-5678",
  "phone.description": "We will send a verification code to this number.",
  "phone.error.empty": "Enter your phone number.",
  "phone.error.invalid": "Enter a valid mobile number.",
  "phone.error.not-mobile": "Enter a mobile number (010-...).",
  "phone.error.international": "Only Korean mobile numbers are supported.",
  "code.label": "Verification code",
  "code.description": "Enter the {length}-digit code we sent you.",
  "code.segment": "Digit {index} of {length}",
  "code.error.incomplete": "Enter all {length} digits.",
  "send.idle": "Send code",
  "send.sending": "Sending...",
  "send.resend": "Resend code",
  "send.resendIn": "Resend in {time}",
  "send.sendIn": "Send code in {time}",
  "send.retry": "Try again",
  "verify.idle": "Verify",
  "verify.verifying": "Verifying...",
  "verify.retryIn": "Try again in {time}",
  editPhone: "Change number",
  "countdown.expiresIn": "Code expires in {time}",
  "countdown.expired": "The code has expired.",
  "status.sending": "Sending the code...",
  "status.sent": "We sent a code to {phone}.",
  "status.verifying": "Checking the code...",
  "status.verified": "Your phone number is verified.",
  "reason.MISMATCH": "The code is incorrect. {attempts} attempts remaining.",
  "reason.EXPIRED": "The code has expired. Request a new one.",
  "reason.MAX_ATTEMPTS": "Too many incorrect attempts. Request a new code.",
  "reason.REPLACED": "A newer code was sent. Enter the latest code.",
  "reason.NOT_FOUND": "This code is no longer valid. Request a new one.",
  "reason.ALREADY_VERIFIED": "This code was already used. Request a new one.",
  "skip.cooldown": "Please wait a moment before trying again.",
  "skip.busy": "Please wait for the current request to finish.",
  "skip.no-issue": "Request a code first.",
  "skip.terminal": "This code can no longer be used. Request a new one.",
  "skip.no-previous-send": "Request a code first.",
  "error.sendUncertain":
    "We could not confirm that the code was sent. Trying again is safe.",
  "error.BAD_REQUEST":
    "The request was invalid. Check the number and try again.",
  "error.UNAUTHORIZED": "Verification is unavailable right now.",
  "error.PAYMENT_REQUIRED":
    "Verification codes cannot be sent right now. Please try again later.",
  "error.FORBIDDEN": "Verification is not available on this site.",
  "error.NOT_FOUND": "The verification request was not found. Start over.",
  "error.CONFLICT": "This request conflicts with an earlier one. Start over.",
  "error.TOO_MANY_REQUESTS": "Too many attempts. Please wait and try again.",
  "error.INTERNAL_SERVER_ERROR": "Something went wrong. Please try again.",
  "error.SERVICE_UNAVAILABLE":
    "The service is temporarily unavailable. Please try again shortly.",
  "error.TIMEOUT": "The request timed out. Please try again.",
  "error.NETWORK_ERROR": "Check your connection and try again.",
  "error.ABORTED": "The request was cancelled.",
  "error.UNKNOWN": "Something went wrong. Please try again.",
} as const;

/** Every message key of the catalog. */
export type OtpMessageKey = keyof typeof en;

export type OtpMessageCatalog = Readonly<Record<OtpMessageKey, string>>;

const ko: OtpMessageCatalog = {
  "phone.label": "휴대폰 번호",
  "phone.placeholder": "010-1234-5678",
  "phone.description": "입력한 번호로 인증번호를 보내드립니다.",
  "phone.error.empty": "휴대폰 번호를 입력해 주세요.",
  "phone.error.invalid": "올바른 휴대폰 번호를 입력해 주세요.",
  "phone.error.not-mobile": "휴대폰 번호(010-...)를 입력해 주세요.",
  "phone.error.international": "국내 휴대폰 번호만 사용할 수 있습니다.",
  "code.label": "인증번호",
  "code.description":
    "카카오톡 또는 문자로 받은 {length}자리 인증번호를 입력해 주세요.",
  "code.segment": "{length}자리 중 {index}번째 숫자",
  "code.error.incomplete": "인증번호 {length}자리를 모두 입력해 주세요.",
  "send.idle": "인증번호 받기",
  "send.sending": "보내는 중...",
  "send.resend": "인증번호 다시 받기",
  "send.resendIn": "{time} 후 다시 받기",
  "send.sendIn": "{time} 후 받기",
  "send.retry": "다시 시도",
  "verify.idle": "확인",
  "verify.verifying": "확인 중...",
  "verify.retryIn": "{time} 후 다시 시도",
  editPhone: "번호 변경",
  "countdown.expiresIn": "남은 시간 {time}",
  "countdown.expired": "인증번호가 만료되었습니다.",
  "status.sending": "인증번호를 보내고 있습니다.",
  "status.sent": "{phone}(으)로 인증번호를 보냈습니다.",
  "status.verifying": "인증번호를 확인하고 있습니다.",
  "status.verified": "휴대폰 번호 인증이 완료되었습니다.",
  "reason.MISMATCH": "인증번호가 일치하지 않습니다. {attempts}회 남았습니다.",
  "reason.EXPIRED": "인증번호가 만료되었습니다. 다시 받아 주세요.",
  "reason.MAX_ATTEMPTS":
    "입력 횟수를 초과했습니다. 인증번호를 다시 받아 주세요.",
  "reason.REPLACED":
    "새 인증번호가 발송되었습니다. 가장 최근 인증번호를 입력해 주세요.",
  "reason.NOT_FOUND": "유효하지 않은 인증번호입니다. 다시 받아 주세요.",
  "reason.ALREADY_VERIFIED": "이미 사용된 인증번호입니다. 다시 받아 주세요.",
  "skip.cooldown": "잠시 후 다시 시도해 주세요.",
  "skip.busy": "진행 중인 요청이 끝날 때까지 기다려 주세요.",
  "skip.no-issue": "먼저 인증번호를 받아 주세요.",
  "skip.terminal": "더 이상 사용할 수 없는 인증번호입니다. 다시 받아 주세요.",
  "skip.no-previous-send": "먼저 인증번호를 받아 주세요.",
  "error.sendUncertain":
    "인증번호 발송 여부를 확인하지 못했습니다. 다시 시도해도 안전합니다.",
  "error.BAD_REQUEST": "요청이 올바르지 않습니다. 번호를 확인해 주세요.",
  "error.UNAUTHORIZED": "지금은 인증을 진행할 수 없습니다.",
  "error.PAYMENT_REQUIRED":
    "지금은 인증번호를 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "error.FORBIDDEN": "이 사이트에서는 인증을 사용할 수 없습니다.",
  "error.NOT_FOUND":
    "인증 요청을 찾을 수 없습니다. 처음부터 다시 시도해 주세요.",
  "error.CONFLICT": "이전 요청과 충돌했습니다. 처음부터 다시 시도해 주세요.",
  "error.TOO_MANY_REQUESTS":
    "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "error.INTERNAL_SERVER_ERROR":
    "일시적인 오류가 발생했습니다. 다시 시도해 주세요.",
  "error.SERVICE_UNAVAILABLE":
    "서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "error.TIMEOUT": "응답 시간이 초과되었습니다. 다시 시도해 주세요.",
  "error.NETWORK_ERROR": "네트워크 연결을 확인하고 다시 시도해 주세요.",
  "error.ABORTED": "요청이 취소되었습니다.",
  "error.UNKNOWN": "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.",
};

/** The built-in catalogs. */
export const OTP_MESSAGES: Readonly<Record<OtpLocale, OtpMessageCatalog>> = {
  ko,
  en,
};

/** Values interpolated into `{name}` placeholders. */
export type OtpMessageParams = Readonly<
  Record<string, string | number | undefined>
>;

/** An override: a template with `{name}` placeholders, or a function. */
export type OtpMessageOverride =
  | string
  | ((params: OtpMessageParams) => string);

export type OtpMessageOverrides = Partial<
  Record<OtpMessageKey, OtpMessageOverride>
>;

export type OtpTranslator = (
  key: OtpMessageKey,
  params?: OtpMessageParams,
) => string;

/** Replaces `{name}` placeholders; unknown placeholders are kept. */
export const formatOtpMessage = (
  template: string,
  params: OtpMessageParams = {},
): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });

export type OtpTranslatorOptions = {
  /** `ko` (default) or `en` (`"auto"` is treated as the default). */
  locale?: OtpLocaleOption | undefined;
  /** Per-key overrides (templates or functions). */
  messages?: OtpMessageOverrides | undefined;
};

/**
 * Returns `t(key, params)` for a locale with optional overrides:
 *
 * ```ts
 * const t = createOtpTranslator({ locale: "en", messages: { "send.idle": "Get code" } });
 * t("send.resendIn", { time: "0:30" }); // "Resend in 0:30"
 * ```
 */
export const createOtpTranslator = (
  options: OtpTranslatorOptions = {},
): OtpTranslator => {
  const catalog =
    OTP_MESSAGES[resolveOtpLocale(options.locale)] ??
    OTP_MESSAGES[DEFAULT_OTP_LOCALE];
  const overrides = options.messages ?? {};
  return (key, params = {}) => {
    const override = overrides[key];
    if (typeof override === "function") return override(params);
    return formatOtpMessage(override ?? catalog[key] ?? key, params);
  };
};

/** Message key of a phone validation error. */
export const otpPhoneErrorMessageKey = (
  error: OtpPhoneErrorCode,
): OtpMessageKey => `phone.error.${error}`;

/**
 * Message key of an SDK error. With `operation: "send"`, an ambiguous
 * failure (timeout, network, 5xx, abort) maps to `error.sendUncertain`: the
 * code may have been sent, and retrying reuses the same idempotency key.
 */
export const otpErrorMessageKey = (
  error: Pick<OtpApiError, "code" | "retryable">,
  operation?: "send" | "verify",
): OtpMessageKey => {
  if (
    operation === "send" &&
    error.code !== "TOO_MANY_REQUESTS" &&
    (error.retryable || error.code === "ABORTED")
  ) {
    return "error.sendUncertain";
  }
  return `error.${error.code satisfies OtpApiErrorCode}`;
};

/** Message key of a `verified: false` reason code. */
export const otpReasonMessageKey = (reason: VerifyReasonCode): OtpMessageKey =>
  `reason.${reason}`;

/** Message key of a skipped flow action. */
export const otpSkipMessageKey = (reason: OtpFlowSkipReason): OtpMessageKey =>
  `skip.${reason}`;
