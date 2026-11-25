---
npm/@k-otp/sdk: minor
---

Clearer error states: specific API reasons now reach end users and custom UIs, and server error text is never shown raw. Nothing is removed or renamed.

Added:

- `PHONE_NUMBER_NOT_MOBILE` in `ISSUE_REQUEST_ERROR_CODES`, `OtpIssueRequestErrorCode` and `OtpBadRequestData`: from K-OTP API 2.3.0, `issue` rejects a Korean landline number (area code `02`, `031`-`033`, `041`-`044`, `051`-`055` or `061`-`064`, also spelled with `+82`), which can receive neither KakaoTalk nor SMS, with 400 `BAD_REQUEST` and this `data.code` (`getIssueRequestErrorCode(error)` returns it). The check runs before test mode, so test keys get it too.
- `createMockTransport()` in `@k-otp/sdk/testing` simulates it: a Korean landline gets 400 `PHONE_NUMBER_NOT_MOBILE` with a test or live key, before the test-number check (it used to get `TEST_NUMBER_REQUIRED`).
- `getOtpErrorReason(error)` (from `@k-otp/sdk` and `@k-otp/sdk/server`): the API's specific reason of any error, `data.code` of a 4xx or `data.limit` of a 429, including reasons a newer API version adds.
- `@k-otp/sdk/ui`: `describeOtpError(error, operation?)` with the `OtpErrorDetail`, `OtpFormErrorTarget` and `OtpDescribableError` types, mapping an error to a message key, `params`, the field it targets (`"phone"`, `"code"` or `"form"`), the API `reason`, `configuration` (the integration, not the user, has to fix it), `ambiguous`, `retryable`, `retryAfterMs` and `requestId`. `OtpErrorDetail` and `OtpFormErrorTarget` are also exported from `/ui/react`, `/ui/vue` and `/ui/svelte`.
- `OtpFormState.errorDetail`: that description of `state.error`, available to custom UIs through the form context and slot props of every framework.
- New messages (Korean and English): `error.TEST_NUMBER_REQUIRED`, `error.TEST_NUMBER_IN_LIVE_MODE`, `error.unavailable`, `error.limit.perPhone`, `error.limit.perKey`, `error.limit.daily` (with `{resetAt}` for the daily free-trial limit) and `code.error.invalid`. A custom catalog typed as a complete `OtpMessageCatalog` needs these keys; `messages` overrides are unaffected.

Changed:

- The OTP form (`createOtpForm` and the React, Vue and Svelte `<OtpForm />` components) shows a message for the API's specific reason instead of one message per HTTP code: a landline number or a test-number mismatch appears under the phone input (with `aria-invalid`, `aria-describedby` and focus, like a validation error) and clears when the number is edited; a 400 on verify appears under the code input; 429 rate limits say which limit applied when it helps the user (too many codes to this number, busy right now, daily limit), and the daily free-trial limit (402 `TRIAL_DAILY_LIMIT_EXCEEDED`) says no more codes can be sent today. Key, origin, wallet, template and request-option errors keep neutral end-user wording. `otpErrorMessageKey` returns the same specific keys. An ambiguous send still shows `error.sendUncertain`.
- `OtpApiError.message` keeps server text only when it is plain text: whitespace is collapsed, it is cut to 300 characters, and an HTML error page from a gateway or proxy is never used as the `message` or kept as `data` (the generic `K-OTP API request failed with HTTP <status>` is used instead).
