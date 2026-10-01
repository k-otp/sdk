---
npm/@k-otp/sdk-core: minor
npm/@k-otp/sdk-server: minor
npm/@k-otp/sdk-react: minor
npm/@k-otp/sdk-vue: minor
npm/@k-otp/sdk-svelte: minor
---

Support the K-OTP API 1.4.0 organization credit wallet. Credit now belongs to the organization and is shared by all of its apps. `getBalance()` returns the whole organization's balance with the new `walletId`, `walletScope` (`"organization"` or the legacy `"app"`, exported as `OtpWalletScope`) and `organizationId` fields (`appId` stays the calling app), and credit ledger entries gain an optional attribution `appId`. The ledger lists the wallet's `credit` / `clawback` entries plus only the calling app's `debit` / `refund` entries, and `balanceAfter` is the wallet balance, so it can change by more than `amountDelta` between listed entries. The new fields are optional and absent on API versions older than 1.4.0 (`walletId` and `walletScope` are typed optional in `GetBalanceResult`), so existing code keeps working against either; the organization semantics apply only where the API is 1.4.0 or newer. No method, option or error code changed, and 402 `PAYMENT_REQUIRED` now refers to the shared wallet.
