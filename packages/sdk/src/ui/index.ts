/**
 * `@k-otp/sdk/ui`: the framework-agnostic model behind the OTP UI
 * components: phone parsing/formatting, the segmented code input, the form
 * state machine, the KO/EN message catalog, countdown formatting, WebOTP and
 * the shared part attributes. No DOM framework; nothing touches `window` at
 * import time. Covered by SemVer.
 */
export {
  applyOtpCodeInput,
  applyOtpCodeKey,
  applyOtpCodePaste,
  DEFAULT_OTP_CODE_LENGTH,
  isOtpCodeComplete,
  type OtpCodeChange,
  otpCodeFocusIndex,
  otpCodeSegments,
  sanitizeOtpCode,
} from "./code";
export { formatOtpCountdown, otpSecondsLeft } from "./countdown";
export {
  createOtpForm,
  type OtpFormActionResult,
  type OtpFormConfig,
  type OtpFormController,
  type OtpFormFocusTarget,
  type OtpFormMessage,
  type OtpFormMessageTone,
  type OtpFormOperation,
  type OtpFormOptions,
  type OtpFormPhase,
  type OtpFormState,
} from "./form";
export {
  createOtpTranslator,
  DEFAULT_OTP_LOCALE,
  detectOtpDocumentLocale,
  formatOtpMessage,
  OTP_MESSAGES,
  type OtpLocale,
  type OtpLocaleOption,
  type OtpMessageCatalog,
  type OtpMessageKey,
  type OtpMessageOverride,
  type OtpMessageOverrides,
  type OtpMessageParams,
  type OtpTranslator,
  type OtpTranslatorOptions,
  otpErrorMessageKey,
  otpPhoneErrorMessageKey,
  otpReasonMessageKey,
  otpSkipMessageKey,
  resolveOtpLocale,
  watchOtpDocumentLocale,
} from "./messages";
export {
  createOtpCodeInputHandlers,
  focusOtpCodeSegment,
  focusOtpFormTarget,
  getOtpCodeInputParts,
  getOtpFormParts,
  type OtpAttrs,
  type OtpAttrValue,
  type OtpCodeInputHandlerOptions,
  type OtpCodeInputHandlers,
  type OtpCodeInputPartsOptions,
  type OtpFormIds,
  type OtpFormParts,
  type OtpPartName,
  otpCodeSegmentId,
  otpCodeTabIndex,
  otpFormIds,
} from "./parts";
export {
  formatOtpPhoneInput,
  isValidOtpPhoneNumber,
  maskOtpPhoneNumber,
  OTP_PHONE_NUMBER_MAX_LENGTH,
  type OtpPhoneErrorCode,
  type OtpPhoneKind,
  type OtpPhoneNumber,
  type OtpPhoneOptions,
  parseOtpPhoneNumber,
} from "./phone";
export {
  isWebOtpSupported,
  type ReceiveWebOtpOptions,
  receiveWebOtp,
} from "./webotp";
