---
npm/@k-otp/sdk-core: patch
npm/@k-otp/sdk-server: patch
npm/@k-otp/sdk-react: patch
npm/@k-otp/sdk-vue: patch
npm/@k-otp/sdk-svelte: patch
---

Sync the vendored K-OTP API spec to 1.3.2, which declares the optional `Retry-After` header on the `503` of `issue` and `verify` (sent when the rate limiter is unavailable and a `pk_` request fails closed). No runtime change: `OtpApiError.retryAfterMs` already reads `Retry-After` on 503.
