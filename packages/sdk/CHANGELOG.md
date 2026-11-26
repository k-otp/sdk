# @k-otp/sdk

## 2.3.1 — 2026-11-26

### Patch changes

- [e627724](https://github.com/k-otp/sdk/commit/e627724d07d97d4d77b50c34606b5bfbd70767dc) `createMockTransport()` in `@k-otp/sdk/testing` now treats every Korean landline-range number like K-OTP API 2.3.1: besides the area codes, unassigned codes (such as `039-…`) and premium-rate `060-…` numbers get 400 `PHONE_NUMBER_NOT_MOBILE` before the test-mode routing. Personal `050x`, `070`, `080` and representative numbers are unchanged. The OTP form already rejected these numbers before sending. — Thanks @imjlk!
- [d6395ec](https://github.com/k-otp/sdk/commit/d6395ec0e0ebaecb01ebf66a845f31e269d4dfd9) Targets K-OTP API 2.3.1. `OPENAPI_VERSION` is now `2.3.1`; request and response shapes are unchanged. API 2.3.1 also refuses Korean numbers in the landline ranges that are not real area codes (unassigned codes such as `039-…` and premium-rate `060-…`) with 400 `PHONE_NUMBER_NOT_MOBILE`; personal `050x`, `070`, `080`, representative and foreign numbers are accepted as before. — Thanks @imjlk!

## 2.3.0 — 2026-11-25

### Minor changes

- [d1632e7](https://github.com/k-otp/sdk/commit/d1632e7209c2a2f583b9e30c8d4ac68a3f48b53e) Clearer error states: specific API reasons now reach end users and custom UIs, and server error text is never shown raw. Nothing is removed or renamed.
  
  Added:
  
  - `PHONE_NUMBER_NOT_MOBILE` in `ISSUE_REQUEST_ERROR_CODES`, `OtpIssueRequestErrorCode` and `OtpBadRequestData`: from K-OTP API 2.3.0, `issue` rejects a Korean landline number (area code `02`, `031`-`033`, `041`-`044`, `051`-`055` or `061`-`064`, also spelled with `+82`), which can receive neither KakaoTalk nor SMS, with 400 `BAD_REQUEST` and this `data.code` (`getIssueRequestErrorCode(error)` returns it). The check runs before test mode, so test keys get it too.
  - `createMockTransport()` in `@k-otp/sdk/testing` simulates it: a Korean landline gets 400 `PHONE_NUMBER_NOT_MOBILE` with a test or live key, before the test-number check (it used to get `TEST_NUMBER_REQUIRED`).
  - `getOtpErrorReason(error)` (from `@k-otp/sdk` and `@k-otp/sdk/server`): the API's specific reason of any error, `data.code` of a 4xx or `data.limit` of a 429, including reasons a newer API version adds.
  - `@k-otp/sdk/ui`: `describeOtpError(error, operation?)` with the `OtpErrorDetail`, `OtpFormErrorTarget` and `OtpDescribableError` types, mapping an error to a message key, `params`, the field it targets (`"phone"`, `"code"` or `"form"`), the API `reason`, `configuration` (the integration, not the user, has to fix it), `ambiguous`, `retryable`, `retryAfterMs` and `requestId`. `OtpErrorDetail` and `OtpFormErrorTarget` are also exported from `/ui/react`, `/ui/vue` and `/ui/svelte`.
  - `OtpFormState.errorDetail`: that description of `state.error`, available to custom UIs through the form context and slot props of every framework.
  - New messages (Korean and English): `error.TEST_NUMBER_REQUIRED`, `error.TEST_NUMBER_IN_LIVE_MODE`, `error.unavailable`, `error.limit.perPhone`, `error.limit.perKey`, `error.limit.daily` (with `{resetAt}` for the daily free-trial limit) and `code.error.invalid`. A custom catalog typed as a complete `OtpMessageCatalog` needs these keys; `messages` overrides are unaffected.
  
  Changed:
  
  - The OTP form (`createOtpForm` and the React, Vue and Svelte `<OtpForm />` components) shows a message for the API's specific reason instead of one message per HTTP code: a landline number or a test-number mismatch appears under the phone input (with `aria-invalid`, `aria-describedby` and focus, like a validation error) and clears when the number is edited; a 400 on verify appears under the code input; 429 rate limits say which limit applied when it helps the user (too many codes to this number, busy right now, daily limit), and the daily free-trial limit (402 `TRIAL_DAILY_LIMIT_EXCEEDED`) says no more codes can be sent today. Key, origin, wallet, template and request-option errors keep neutral end-user wording. `otpErrorMessageKey` returns the same specific keys. An ambiguous send still shows `error.sendUncertain`.
  - `OtpApiError.message` keeps server text only when it is plain text: whitespace is collapsed, it is cut to 300 characters, and an HTML error page from a gateway or proxy is never used as the `message` or kept as `data` (the generic `K-OTP API request failed with HTTP <status>` is used instead). — Thanks @imjlk!
- [987e741](https://github.com/k-otp/sdk/commit/987e741f1f0bc609802b88ddddbdb43700a2cbb0) Targets K-OTP API 2.3.0. `OPENAPI_VERSION` is now `2.3.0`; request and response shapes are unchanged. API 2.3.0 refuses a Korean landline number on `issue` with 400 `BAD_REQUEST` and `data.code` `PHONE_NUMBER_NOT_MOBILE` (see `getIssueRequestErrorCode`), and API 2.2.2 reworded the issue descriptions about the SMS fallback. — Thanks @imjlk!

## 2.2.0 — 2026-11-21

### Minor changes

- [0189715](https://github.com/k-otp/sdk/commit/018971593c31bac865771da60ffc23e5c1ff29d6) Targets K-OTP API 2.2.1. `OPENAPI_VERSION` is now `2.2.1`; request and response types are unchanged, so no code changes are needed. API 2.2.1 no longer refunds an issue whose code was verified when the delivery is later reported as failed. — Thanks @imjlk!

## 2.1.1 — 2026-11-12

### Patch changes

- [0d1d592](https://github.com/k-otp/sdk/commit/0d1d5923baa0b83039d5d862e0b23876da8dab55) Fix default HTTP requests failing with `TypeError: Illegal invocation` on Cloudflare Workers by preserving the global receiver of native `fetch`. Core and server clients retain lazy fetch resolution, and custom fetch implementations are used unchanged. The Kiota client also uses Workers-compatible manual redirect handling while continuing to reject redirects without following them. — Thanks @imjlk!

## 2.1.0 — 2026-10-19

### Minor changes

- [f57c0c1](https://github.com/k-otp/sdk/commit/f57c0c112c9ab18cafbc8854766558b54e571d0f) Support K-OTP API 2.x, where codes are delivered by KakaoTalk AlimTalk only (SMS remains the automatic fallback of a failed AlimTalk delivery) and WebOTP is no longer offered. The vendored OpenAPI spec is synced to API 2.1.0. Nothing is removed: code written for 2.0.0 keeps compiling, and options the API no longer accepts are still sent as given, so they fail with the API's clear 400 instead of being dropped silently.
  
  Added:
  
  - `getIssueRequestErrorCode(error)`, `ISSUE_REQUEST_ERROR_CODES` and the `OtpIssueRequestErrorCode` type (from `@k-otp/sdk` and `@k-otp/sdk/server`) read the new 400 codes of `issue` from `error.data.code` (`error.code` stays `BAD_REQUEST`; `OtpBadRequestData` lists them): `CHANNEL_NOT_SUPPORTED` (`channel: "sms"`), `TEMPLATE_NOT_AVAILABLE` (a template without an approved AlimTalk code; its `channelSupport` is empty, otherwise it is `["alimtalk"]`) and `WEB_OTP_NOT_SUPPORTED` (`webOtp` other than `false`).
  - `OtpDeliveredChannel`: the channel `listIssues`/`getIssue` report, `"sms"` after the automatic fallback.
  - `OtpPaymentRequiredData` now includes `resetAt` of `TRIAL_DAILY_LIMIT_EXCEEDED`.
  - `createMockTransport()` in `@k-otp/sdk/testing` follows API 2.x: it refuses `channel: "sms"` and `webOtp` with the same 400 codes, lists the default template as `["alimtalk"]`, and reports `channel: "sms"` once the `alimtalk_failover` fallback has delivered.
  - `@k-otp/sdk/kiota` is generated from the API 2.1.0 spec. If your app has an approved service name in the console, messages read `[K-OTP] <service name> ...`; there is no request field for it.
  
  Deprecated (removed in the next major version):
  
  - `channel: "sms"` on `issue`: leave `channel` out (`"alimtalk"` is the default). `OtpChannel` still includes `"sms"`.
  - The `webOtp` request option, `IssueWebOtpOptions`, `IssueWebOtpResult` (`@k-otp/sdk/contract`) and the `webOtp` field of the `issue` result, which API 2.x never sends.
  - `isWebOtpSupported`, `receiveWebOtp` and `ReceiveWebOtpOptions` from `@k-otp/sdk/ui`, the `webOtp` setting of `createOtpForm` and of `OtpForm`/`OtpFormRoot`, and the `webOtp` prop of `OtpCodeInput` in `/ui/react`, `/ui/vue` and `/ui/svelte`. They still work as browser helpers, but API 2.x no longer adds the WebOTP line to the SMS, so no code arrives this way. The form setting now defaults to `false` (it was `true`). Code inputs keep `autocomplete="one-time-code"`, so the OS can still suggest a code that arrives by SMS.
  - `messageType` (ignored by the API), the aliases `PaymentRequiredData` and `RateLimitedData` (use `OtpPaymentRequiredData` and `OtpRateLimitedData`), and the `origin` request option of `@k-otp/sdk/kiota` (it only bound `webOtp`).
  
  The native language SDKs (C#, Java, Kotlin, PHP, Go, Python, Ruby, Dart) move to 0.2.0 for API 2.x and drop their per-call `origin` request option; see `sdks/README.md`. — Thanks @imjlk!

## 2.0.0 — 2026-10-12

### Major changes

- [651415b](https://github.com/k-otp/sdk/commit/651415b28a0c42f0d4ddb60e9ffd3eecd94a68e6) Keep the issue idempotency key whenever an `issue` outcome is unknown: a timeout or network failure, an unreadable success body, and now also a redirect or a 2xx response that is empty, not JSON or lacks `issueId`, which reject with an `UNKNOWN` error carrying the HTTP status instead of resolving as a success. `isAmbiguousIssueError(error)` is exported for callers that manage keys themselves. Timeout and cancellation now also cover resolving an asynchronous API key. Requests no longer follow redirects automatically. Breaking: `baseUrl` must be HTTPS, with plain HTTP accepted only for loopback hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`); a `baseUrl` with credentials, a query or a fragment is refused. For a container, LAN or other non-loopback HTTP URL in development or tests, pass `allowInsecureHttp: true` (a custom `fetch` does not lift the rule). A relative `baseUrl` inherits the page scheme, so it is refused on a plain-HTTP non-loopback page unless that option is set. — Thanks @imjlk!

## 1.4.0 — 2026-10-11

### Minor changes

- [af0c934](https://github.com/k-otp/sdk/commit/af0c9344ecc6c0c4f4148b3d68e65f62c005c905) Support test mode (API 1.9.0). `pk_test_`/`sk_test_` keys never send a message or use credits, only accept test phone numbers (Korean `010-0000-00xx`, UK `+44 7700 9000xx`, US `+1 NXX 555-01xx`, where the last two digits pick a scenario) and verify with the fixed code `000000`.
  
  - The vendored OpenAPI spec is synced to API 1.9.0: `issue`, `verify`, `getStatus`, `listIssues`/`getIssue` and `getBalance` results carry `mode` (`"live"` or `"test"`, type `OtpApiMode`), `OtpWalletScope` adds `"test"` (the fixed simulated balance a `sk_test_` key sees), and `OtpRateLimitedData.limit` adds `perKeyDaily`, `perOrgDaily` and `testModeDaily`.
  - New exports from `@k-otp/sdk` (and `@k-otp/sdk/server`): `isTestKey(key)`, `TEST_PHONE_NUMBERS` (one test number per scenario), `TEST_OTP_CODE`, `TEST_SCENARIOS`, `matchTestPhoneNumber(phoneNumber)`, `getTestNumberErrorCode(error)` and the `OtpBadRequestData` type for the new 400 codes `TEST_NUMBER_REQUIRED` (test key with a real number) and `TEST_NUMBER_IN_LIVE_MODE` (live key with a test number), which arrive in `error.data.code` while `error.code` stays `BAD_REQUEST`.
  - New subpath `@k-otp/sdk/testing`: `createMockTransport()` simulates the API's test mode in memory for unit tests (pass its `fetch` to any client, the framework adapters or the UI components; `advance(ms)` walks the delivery timeline), with `TEST_MODE_TIMINGS` and `TEST_MODE_SIMULATED_BALANCE`.
  - `@k-otp/sdk/kiota` is generated from the 1.9.0 spec. — Thanks @imjlk!

## 1.3.0 — 2026-10-07

### Minor changes

- [090911e](https://github.com/k-otp/sdk/commit/090911e4cf7abe8371a2ec9eac5bba1c960c6fd8) Add `@k-otp/sdk/kiota`, a server-only client built with official Kiota runtimes for all nine public API operations. It validates issue idempotency keys before HTTP, preserves native JSON responses and error details, disables automatic retries, and provides an opt-in single issue retry after HTTP 503. — Thanks @imjlk!

## 1.2.0 — 2026-10-05

### Minor changes

- [abac0a6](https://github.com/k-otp/sdk/commit/abac0a661c2b79e659a5d3850608bcc97f799544) The vendored OpenAPI spec is synced to API 1.8.0: `issue` accepts `smsFallback` (default `true`). `smsFallback: false` delivers the code by KakaoTalk AlimTalk only, with no SMS fallback; the price is unchanged, the field is ignored for SMS deliveries, and `webOtp` then reports `skipped` with `channel_alimtalk`. The JSDoc of `IssueInput` and `OtpChannel` mentions the option. — Thanks @imjlk!

## 1.1.0 — 2026-10-03

### Minor changes

- [b4de877](https://github.com/k-otp/sdk/commit/b4de87781ca7ede4d3c8db872af9b6b5a609183d) Document KakaoTalk AlimTalk as the default delivery, with automatic SMS fallback: omit `channel` when calling `issue`. The READMEs, `docs/` and the JSDoc of `IssueInput`, `OtpChannel`, the `@k-otp/sdk/ui` form `issue` option, WebOTP (`receiveWebOtp`, the `webOtp` prop of `OtpCodeInput` in `/ui/react`, `/ui/vue` and `/ui/svelte`) no longer describe SMS as the delivery channel. The default UI copy is now channel-neutral: `phone.description` ("We will send a verification code to this number.") and `code.description` ("Enter the {length}-digit code we sent you." / "카카오톡 또는 문자로 받은 {length}자리 인증번호를 입력해 주세요."). WebOTP and `autocomplete="one-time-code"` autofill are unchanged and apply when the code arrives by SMS fallback.
  
  The vendored OpenAPI spec is synced to API 1.7.0: `channel` defaults to AlimTalk, `GetBalanceResult` gains the optional `promoBalance` and `promoNextExpiry` (free promotional credits, API 1.6.0+), and credit ledger entries can be `promo_credit`, `promo_expire` or `promo_revoke`. — Thanks @imjlk!

## 1.0.1 — 2026-10-01

### Patch changes

- [db678ab](https://github.com/k-otp/sdk/commit/db678ab047dbddefefeb286c462f77458b271962) Republish with resolved dependency versions. The 1.0.0 tarball on npm declared its `@orpc/*` dependencies with unresolved `catalog:` ranges and cannot be installed; use 1.0.1 or later. The package now refuses `npm publish` from the package directory when a dependency range is unresolved. — Thanks @imjlk!

## 1.0.0 — 2026-10-01

### Major changes

- [90542d6](https://github.com/k-otp/sdk/commit/90542d65f24cfd3a69f8f870daad0e6864ff2c7d) Initial public release of `@k-otp/sdk` (1.0.0), the official JavaScript/TypeScript SDK for the K-OTP Korean OTP API (API 1.4.0), as one package with subpath exports:
  
  - `@k-otp/sdk` (same as `@k-otp/sdk/core`): framework-agnostic `issue` / `verify` client for browsers (`pk_` keys), SSR and edge runtimes, over oRPC `OpenAPILink` against `/v1`. Required idempotency keys (validated before any request, sent as header and body, `createIdempotencyKey`), a normalized `OtpApiError` (`code`, `status`, `requestId`, `retryable`, `retryAfterMs`, typed `OtpPaymentRequiredData` / `OtpRateLimitedData` for 402 and the per-key 429 rate limits), per-call `signal` / `timeoutMs`, telemetry hooks and a refusal of `sk_` keys in browsers.
  - `@k-otp/sdk/headless`: the `createOtpFlow` / `createOtpOperation` controllers behind every adapter: stale-response protection, abort, idempotency key reuse after ambiguous failures, the resend cooldown and a separate verify cooldown after a rate-limited `verify`.
  - `@k-otp/sdk/server`: every public `/v1` operation with an `sk_` secret key for Node.js, Bun, Deno and edge runtimes: issue, verify, status, issue history, organization credit wallet balance (`walletId`, `walletScope`, `organizationId`) and ledger, and templates, with async pagination helpers. Under the `browser` export condition it resolves to a stub with the same exports whose functions throw when called, so the server client never ships to a browser by accident.
  - `@k-otp/sdk/react` (`OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow`; React 18 and 19, marked `"use client"`), `@k-otp/sdk/vue` (`createOtpPlugin`, `useOtp`, `useOtpFlow`; Vue 3.3+) and `@k-otp/sdk/svelte` (`createOtpStores`, a flow store and the `otpForm` action; Svelte 4 and 5). React, Vue and Svelte are optional peer dependencies, and each subpath only loads its own framework.
  - `@k-otp/sdk/contract`: the oRPC contract and the generated OpenAPI types, for custom oRPC clients.
  - `@k-otp/sdk/k-otp.iife.min.js` (and the unminified `k-otp.iife.js`): a `<script>` bundle exposing `window.KOtp`, including `KOtp.createOtpFlow`. — Thanks @imjlk!

### Minor changes

- [ebccd84](https://github.com/k-otp/sdk/commit/ebccd84a849002efc8e1ed5bf517b9ffda4631df) Add headless UI components with an optional default theme, as new subpaths:
  
  - `@k-otp/sdk/ui`: the framework-agnostic UI model. Korean mobile parsing, formatting and masking, canonicalized before sending (`+82 10-...`, `82 10...`, `0082 10...` and `+82 010...` are sent as `010...`; E.164 for other countries with `allowInternational`), the segmented code input model (paste, full-width digits, IME composition, a single tab stop with arrow-key navigation), the `createOtpForm` state machine over `createOtpFlow` (phases `phone`/`sending`/`code`/`verifying`/`verified`/`failed`, resend and 429/503 retry countdowns, code expiry, focus requests), a Korean/English message catalog for every error code, verify reason and skip reason (overridable; Korean by default, `locale: "auto"` follows `<html lang>` after mount), countdown formatting and an SSR-safe, abortable WebOTP helper.
  - `@k-otp/sdk/ui/react` (React 18/19, `"use client"`), `@k-otp/sdk/ui/vue` (Vue 3.3+) and `@k-otp/sdk/ui/svelte` (Svelte 4 and 5, shipped as `.svelte` sources under the `svelte` export condition): a one-line `<OtpForm />` preset and the headless parts `OtpForm.Root` (`OtpFormRoot`), `PhoneField`, `SendButton`, `CodeField`, `VerifyButton`, `Countdown`, `Message`, `EditPhoneButton`, plus a standalone `OtpCodeInput` (`autocomplete="one-time-code"`, `inputmode="numeric"`). Unstyled, with `data-k-otp`/`data-state`/`data-invalid`/`data-disabled` on every part, render props / slots / snippets, labels and live regions, focus that follows the flow, and `sent`/`verified`/`error`/`phaseChange` events. The three frameworks render the same state.
  - `@k-otp/sdk/ui/theme.css`: a minimal default theme scoped to `[data-k-otp]` with zero-specificity selectors, `--k-otp-*` tokens, light/dark via `prefers-color-scheme` or `data-k-otp-theme`, and reduced-motion support. CSS is the package's only side effect (`"sideEffects": ["**/*.css"]`).
  
  The hooks subpaths (`@k-otp/sdk/react`, `/vue`, `/svelte`), the core, `/headless` and `/server` never load UI code. — Thanks @imjlk!

