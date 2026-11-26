---
npm/@k-otp/sdk: patch
---

Targets K-OTP API 2.3.1. `OPENAPI_VERSION` is now `2.3.1`; request and response shapes are unchanged. API 2.3.1 also refuses Korean numbers in the landline ranges that are not real area codes (unassigned codes such as `039-…` and premium-rate `060-…`) with 400 `PHONE_NUMBER_NOT_MOBILE`; personal `050x`, `070`, `080`, representative and foreign numbers are accepted as before.
