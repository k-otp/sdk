---
npm/@k-otp/sdk: patch
---

Document KakaoTalk AlimTalk as the default delivery, with automatic SMS fallback: omit `channel` when calling `issue`. The READMEs, `docs/` and the JSDoc of `IssueInput`, `OtpChannel`, the `@k-otp/sdk/ui` form `issue` option, WebOTP (`receiveWebOtp`, the `webOtp` prop of `OtpCodeInput` in `/ui/react`, `/ui/vue` and `/ui/svelte`) no longer describe SMS as the delivery channel. The default UI copy is now channel-neutral: `phone.description` ("We will send a verification code to this number.") and `code.description` ("Enter the {length}-digit code we sent you." / "카카오톡 또는 문자로 받은 {length}자리 인증번호를 입력해 주세요."). WebOTP and `autocomplete="one-time-code"` autofill are unchanged and apply when the code arrives by SMS fallback.
