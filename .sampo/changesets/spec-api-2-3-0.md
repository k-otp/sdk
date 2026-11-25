---
npm/@k-otp/sdk: minor
---

Targets K-OTP API 2.3.0. `OPENAPI_VERSION` is now `2.3.0`; request and response shapes are unchanged. API 2.3.0 refuses a Korean landline number on `issue` with 400 `BAD_REQUEST` and `data.code` `PHONE_NUMBER_NOT_MOBILE` (see `getIssueRequestErrorCode`), and API 2.2.2 reworded the issue descriptions about the SMS fallback.
