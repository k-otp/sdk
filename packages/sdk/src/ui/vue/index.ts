/**
 * `@k-otp/sdk/ui/vue`: headless OTP form components for Vue 3.3+ (render
 * functions, provide/inject, scoped slots). Unstyled; every part exposes its
 * state through `data-*` attributes (or import `@k-otp/sdk/ui/theme.css`).
 *
 * ```vue
 * <OtpForm purpose="signup" @verified="done" />
 * ```
 */
export type {
  OtpFormPhase,
  OtpFormState,
  OtpLocale,
  OtpMessageKey,
  OtpMessageOverrides,
} from "..";
export {
  OTP_FORM_KEY,
  OtpCodeInput,
  type OtpCodeInputProps,
  OtpForm,
  OtpFormCodeField,
  type OtpFormContext,
  OtpFormCountdown,
  OtpFormEditPhoneButton,
  type OtpFormEmits,
  type OtpFormFieldProps,
  OtpFormMessage,
  OtpFormPhoneField,
  type OtpFormPhoneFieldSlotProps,
  OtpFormRoot,
  type OtpFormRootProps,
  OtpFormSendButton,
  type OtpFormSlotProps,
  OtpFormVerifyButton,
  useOtpFormContext,
} from "./components";
