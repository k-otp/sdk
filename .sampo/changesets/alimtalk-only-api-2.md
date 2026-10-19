---
npm/@k-otp/sdk: minor
---

Support K-OTP API 2.x, where codes are delivered by KakaoTalk AlimTalk only (SMS remains the automatic fallback of a failed AlimTalk delivery) and WebOTP is no longer offered. The vendored OpenAPI spec is synced to API 2.0.0. Nothing is removed: code written for 2.0.0 keeps compiling, and options the API no longer accepts are still sent as given, so they fail with the API's clear 400 instead of being dropped silently.

Added:

- `getIssueRequestErrorCode(error)`, `ISSUE_REQUEST_ERROR_CODES` and the `OtpIssueRequestErrorCode` type (from `@k-otp/sdk` and `@k-otp/sdk/server`) read the new 400 codes of `issue` from `error.data.code` (`error.code` stays `BAD_REQUEST`; `OtpBadRequestData` lists them): `CHANNEL_NOT_SUPPORTED` (`channel: "sms"`), `TEMPLATE_NOT_AVAILABLE` (a template without an approved AlimTalk code; its `channelSupport` is empty, otherwise it is `["alimtalk"]`) and `WEB_OTP_NOT_SUPPORTED` (`webOtp` other than `false`).
- `OtpDeliveredChannel`: the channel `listIssues`/`getIssue` report, `"sms"` after the automatic fallback.
- `OtpPaymentRequiredData` now includes `resetAt` of `TRIAL_DAILY_LIMIT_EXCEEDED`.
- `createMockTransport()` in `@k-otp/sdk/testing` follows API 2.x: it refuses `channel: "sms"` and `webOtp` with the same 400 codes, lists the default template as `["alimtalk"]`, and reports `channel: "sms"` once the `alimtalk_failover` fallback has delivered.
- `@k-otp/sdk/kiota` is generated from the API 2.0.0 spec. If your app has an approved service name in the console, messages read `[K-OTP] <service name> ...`; there is no request field for it.

Deprecated (removed in the next major version):

- `channel: "sms"` on `issue`: leave `channel` out (`"alimtalk"` is the default). `OtpChannel` still includes `"sms"`.
- The `webOtp` request option, `IssueWebOtpOptions`, `IssueWebOtpResult` (`@k-otp/sdk/contract`) and the `webOtp` field of the `issue` result, which API 2.x never sends.
- `isWebOtpSupported`, `receiveWebOtp` and `ReceiveWebOtpOptions` from `@k-otp/sdk/ui`, the `webOtp` setting of `createOtpForm` and of `OtpForm`/`OtpFormRoot`, and the `webOtp` prop of `OtpCodeInput` in `/ui/react`, `/ui/vue` and `/ui/svelte`. They still work as browser helpers, but API 2.x no longer adds the WebOTP line to the SMS, so no code arrives this way. The form setting now defaults to `false` (it was `true`). Code inputs keep `autocomplete="one-time-code"`, so the OS can still suggest a code that arrives by SMS.
- `messageType` (ignored by the API), the aliases `PaymentRequiredData` and `RateLimitedData` (use `OtpPaymentRequiredData` and `OtpRateLimitedData`), and the `origin` request option of `@k-otp/sdk/kiota` (it only bound `webOtp`).

The native language SDKs (C#, Java, Kotlin, PHP, Go, Python, Ruby, Dart) move to 0.2.0 for API 2.x and drop their per-call `origin` request option; see `sdks/README.md`.
