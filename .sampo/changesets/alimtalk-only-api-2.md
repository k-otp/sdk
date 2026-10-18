---
npm/@k-otp/sdk: major
---

Support K-OTP API 2.0: delivery is KakaoTalk AlimTalk only, with SMS kept as the automatic fallback. Breaking changes:

- `channel` of `issue` is now typed `"alimtalk"` (`OtpChannel`) and is the default, so leave it out. An explicit `"sms"` is rejected by the API with 400 `CHANNEL_NOT_SUPPORTED`. `smsFallback` is unchanged, and `listIssues`/`getIssue` can still report `channel: "sms"` after a fallback (new type `OtpDeliveredChannel`).
- `webOtp` is removed: the `webOtp` request option, `IssueWebOtpOptions` and `IssueWebOtpResult`, and the `webOtp` field of the `issue` result are gone, and the API rejects any value but `false` with 400 `WEB_OTP_NOT_SUPPORTED`. The browser helpers `isWebOtpSupported` and `receiveWebOtp` and the `webOtp` option of `@k-otp/sdk/ui` (`OtpFormConfig`), `OtpForm`/`OtpFormRoot` and `OtpCodeInput` in `/ui/react`, `/ui/vue` and `/ui/svelte` are removed. Segmented code inputs keep `autocomplete="one-time-code"`, so the OS can still suggest a code that arrives by SMS fallback.
- A template without an approved AlimTalk code cannot be issued: 400 `TEMPLATE_NOT_AVAILABLE`. `channelSupport` of `listTemplates`/`getTemplate` is `["alimtalk"]`, or `[]` for such a template.
- `messageType` is deprecated and ignored by the API.

New: `getIssueRequestErrorCode(error)`, `ISSUE_REQUEST_ERROR_CODES` and the `OtpIssueRequestErrorCode` type (from `@k-otp/sdk`, `@k-otp/sdk/server`) read `CHANNEL_NOT_SUPPORTED`, `TEMPLATE_NOT_AVAILABLE` and `WEB_OTP_NOT_SUPPORTED` from the `data.code` of a 400 (`error.code` stays `BAD_REQUEST`; `OtpBadRequestData` lists them). `createMockTransport()` in `@k-otp/sdk/testing` refuses `channel: "sms"` and `webOtp` like the API and lists the default template as `["alimtalk"]`. If your app has an approved service name in the console, messages read `[K-OTP] <service name> ...`; there is no request field for it and the SDK needs no change. `@k-otp/sdk/kiota` is generated from the 2.0 spec, and the native language SDKs (C#, Java, Kotlin, PHP, Go, Python, Ruby, Dart) move to 1.0.0 with the same changes (no `webOtp` handling; see `sdks/README.md`).

Migration: remove `channel: "sms"` and every `webOtp` option or `receiveWebOtp`/`isWebOtpSupported` call; stop reading `result.webOtp`; replace `<OtpCodeInput webOtp>` and the form `webOtp` setting by nothing (autofill via `one-time-code` stays); check `channelSupport` before issuing with a custom `templateId` and handle `TEMPLATE_NOT_AVAILABLE`; stop sending `messageType`. Upgrade the SDK together with API 2.0: an older API still accepts `sms` and `webOtp`, which the new types no longer offer.
