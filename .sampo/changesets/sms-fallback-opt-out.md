---
npm/@k-otp/sdk: minor
---

The vendored OpenAPI spec is synced to API 1.8.0: `issue` accepts `smsFallback` (default `true`). `smsFallback: false` delivers the code by KakaoTalk AlimTalk only, with no SMS fallback; the price is unchanged, the field is ignored for SMS deliveries, and `webOtp` then reports `skipped` with `channel_alimtalk`. The JSDoc of `IssueInput` and `OtpChannel` mentions the option.
