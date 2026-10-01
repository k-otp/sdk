/**
 * `@k-otp/sdk/ui/react`: headless OTP form components for React 18 and 19
 * (client components). Unstyled; every part exposes its state through
 * `data-*` attributes (style them yourself or import
 * `@k-otp/sdk/ui/theme.css`) and accepts a render function for full control.
 *
 * ```tsx
 * <OtpForm options={{ apiKey: "pk_..." }} purpose="signup" onVerified={done} />
 * ```
 */
export type {
  OtpFormPhase,
  OtpFormState,
  OtpLocale,
  OtpLocaleOption,
  OtpMessageKey,
  OtpMessageOverrides,
} from "..";
export {
  OtpCodeInput,
  type OtpCodeInputProps,
  OtpForm,
  OtpFormCodeField,
  type OtpFormCodeFieldProps,
  type OtpFormCodeFieldRenderProps,
  type OtpFormContextValue,
  OtpFormCountdown,
  type OtpFormCountdownProps,
  OtpFormEditPhoneButton,
  type OtpFormEditPhoneButtonProps,
  OtpFormMessage,
  type OtpFormMessageProps,
  OtpFormPhoneField,
  type OtpFormPhoneFieldProps,
  type OtpFormPhoneFieldRenderProps,
  type OtpFormProps,
  OtpFormRoot,
  type OtpFormRootProps,
  OtpFormSendButton,
  type OtpFormSendButtonProps,
  type OtpFormSettings,
  OtpFormVerifyButton,
  type OtpFormVerifyButtonProps,
  useOtpFormContext,
} from "./components";
