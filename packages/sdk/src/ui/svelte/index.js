// `@k-otp/sdk/ui/svelte`: the components are Svelte sources compiled by the
// app (Svelte 4 or 5, through the "svelte" export condition); the runtime is
// compiled TypeScript (runtime.js).

export { default as OtpCodeInput } from "./OtpCodeInput.svelte";
export { default as OtpForm } from "./OtpForm.svelte";
export { default as OtpFormCodeField } from "./OtpFormCodeField.svelte";
export { default as OtpFormCountdown } from "./OtpFormCountdown.svelte";
export { default as OtpFormEditPhoneButton } from "./OtpFormEditPhoneButton.svelte";
export { default as OtpFormMessage } from "./OtpFormMessage.svelte";
export { default as OtpFormPhoneField } from "./OtpFormPhoneField.svelte";
export { default as OtpFormRoot } from "./OtpFormRoot.svelte";
export { default as OtpFormSendButton } from "./OtpFormSendButton.svelte";
export { default as OtpFormVerifyButton } from "./OtpFormVerifyButton.svelte";
export {
  attrs,
  createOtpCodeInputModel,
  createOtpFormRoot,
  getOtpFormContext,
} from "./runtime.js";
