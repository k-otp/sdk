---
npm/@k-otp/sdk: minor
---

Support test mode (API 1.9.0). `pk_test_`/`sk_test_` keys never send a message or use credits, only accept test phone numbers (Korean `010-0000-00xx`, UK `+44 7700 9000xx`, US `+1 NXX 555-01xx`, where the last two digits pick a scenario) and verify with the fixed code `000000`.

- The vendored OpenAPI spec is synced to API 1.9.0: `issue`, `verify`, `getStatus`, `listIssues`/`getIssue` and `getBalance` results carry `mode` (`"live"` or `"test"`, type `OtpApiMode`), `OtpWalletScope` adds `"test"` (the fixed simulated balance a `sk_test_` key sees), and `OtpRateLimitedData.limit` adds `perKeyDaily`, `perOrgDaily` and `testModeDaily`.
- New exports from `@k-otp/sdk` (and `@k-otp/sdk/server`): `isTestKey(key)`, `TEST_PHONE_NUMBERS` (one test number per scenario), `TEST_OTP_CODE`, `TEST_SCENARIOS`, `matchTestPhoneNumber(phoneNumber)`, `getTestNumberErrorCode(error)` and the `OtpBadRequestData` type for the new 400 codes `TEST_NUMBER_REQUIRED` (test key with a real number) and `TEST_NUMBER_IN_LIVE_MODE` (live key with a test number), which arrive in `error.data.code` while `error.code` stays `BAD_REQUEST`.
- New subpath `@k-otp/sdk/testing`: `createMockTransport()` simulates the API's test mode in memory for unit tests (pass its `fetch` to any client, the framework adapters or the UI components; `advance(ms)` walks the delivery timeline), with `TEST_MODE_TIMINGS` and `TEST_MODE_SIMULATED_BALANCE`.
- `@k-otp/sdk/kiota` is generated from the 1.9.0 spec.
