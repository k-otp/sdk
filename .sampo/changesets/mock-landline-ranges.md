---
npm/@k-otp/sdk: patch
---

`createMockTransport()` in `@k-otp/sdk/testing` now treats every Korean landline-range number like K-OTP API 2.3.1: besides the area codes, unassigned codes (such as `039-…`) and premium-rate `060-…` numbers get 400 `PHONE_NUMBER_NOT_MOBILE` before the test-mode routing. Personal `050x`, `070`, `080` and representative numbers are unchanged. The OTP form already rejected these numbers before sending.
