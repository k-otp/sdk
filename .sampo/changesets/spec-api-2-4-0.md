---
npm/@k-otp/sdk: minor
---

Targets K-OTP API 2.4.0. `OPENAPI_VERSION` is now `2.4.0`; request and response shapes are unchanged. Every app now spends from its organization's shared credit wallet only: a live key whose app is not linked to an organization gets `503 SERVICE_UNAVAILABLE` (`message` `wallet_unresolved`) on `issue`, `getBalance` and `listCreditLedger`. `walletScope: "app"` is deprecated and no longer returned; it stays in `OtpWalletScope` so existing code keeps compiling.
