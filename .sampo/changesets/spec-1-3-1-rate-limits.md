---
npm/@k-otp/sdk-core: minor
npm/@k-otp/sdk-server: minor
npm/@k-otp/sdk-react: minor
npm/@k-otp/sdk-vue: minor
npm/@k-otp/sdk-svelte: minor
---

Support the K-OTP API 1.3.1 per-key rate limits. `issue` and `verify` can now reject with a retryable `TOO_MANY_REQUESTS` (429) `OtpApiError` whose `retryAfterMs` comes from the exact `data.retryAfterMs` (falling back to the `Retry-After` header) and whose `data` is the new `OtpRateLimitedData` (`limit`: `perKey` / `perIp` / `perPhone`, `policy`: `key` / `platform`). The headless flow and the React, Vue and Svelte adapters gain a separate verify cooldown (`verifyCooldownRemainingMs`, `verifyCooldownUntil`): a rate-limited `verify` keeps `canVerify` false and skips `verify` with `"cooldown"` until it ends, while a rate-limited `send` keeps using the resend cooldown. The vendored spec also documents the `cost` issue field as deprecated (ignored for billing).
