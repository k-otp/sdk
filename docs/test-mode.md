# Test mode

Test-mode keys let you build and test an integration without sending a real
message or using credits (API 1.9.0+). They work with every part of the SDK:
the core client, `@k-otp/sdk/server`, the framework adapters and the UI
components.

| Situation | Use |
| --- | --- |
| Local development, CI integration tests | A `pk_test_` / `sk_test_` key and the test phone numbers below. No cost, deterministic. Store the `sk_test_` key as a CI secret. |
| Unit and component tests of your app | `createMockTransport()` from `@k-otp/sdk/testing`: the same scenarios in memory, no network, no key. |
| Checking a production rollout | A live key and a few real sends to your team's phones (uses credits). Test numbers are rejected with live keys. |
| Practicing failure paths | Scenarios `06` (429), `07` (402), `09` (503) and `03` (unknown provider outcome). |

## Test keys

Create test keys next to your live keys in the console. They have the same
types and rules as live keys, with a `_test_` prefix:

- `pk_test_...` (browser): `issue` and `verify` only, like `pk_`. Besides the
  key's allowed origins, `http(s)://localhost` and `http(s)://127.0.0.1` on
  any port are always accepted, so local development needs no origin setup.
- `sk_test_...` (server): every operation, like `sk_`. Keep it on servers and
  in CI secrets, never in a browser.

The prefix selects the mode on the API. `isTestKey(key)` tells the two apart,
for example to show a "test mode" badge in your own UI:

```ts
import { isTestKey } from "@k-otp/sdk";

isTestKey(import.meta.env.VITE_K_OTP_KEY); // true for pk_test_...
```

Every issue, verify, status, issue list/detail and balance result carries
`mode` (`"live"` or `"test"`, type `OtpApiMode`), so you can also check what
the API did:

```ts
const issued = await client.issue(input);
issued.mode; // "test": nothing was sent, no credit was used
```

`mode` is typed optional because an API older than 1.9.0 does not send it.

## Test phone numbers and scenarios

Test keys only accept test phone numbers; the last two digits pick a
deterministic scenario. Every test issue that is created verifies with the
fixed code `TEST_OTP_CODE` (`"000000"`), except scenario `05`.

| Range | Example | Note |
| --- | --- | --- |
| Korea | `010-0000-00xx`, `+82 10-0000-00xx` | `TEST_PHONE_NUMBERS` uses this range |
| UK | `+44 7700 9000xx` | Ofcom drama range |
| US | `+1 NXX 555-01xx` | NANP fictional range (any valid area code) |

| `xx` | `TEST_PHONE_NUMBERS` key | Issue and delivery (`getStatus`) | Verify |
| --- | --- | --- | --- |
| `00` | `success` | 200; `sent` after 1 s, `delivered` after 2 s | `000000` verifies |
| `01` | `delivery_failed` | 200; `sent` after 1 s, `failed` after 3 s | `000000` verifies (delivery and verification are independent) |
| `02` | `slow_delivery` | 200; `queued`/`sent` until 30 s, then `delivered` | `000000` verifies |
| `03` | `ambiguous` | 200; stays `sent` with `providerOutcomeAmbiguous: true` | `000000` verifies |
| `04` | `expired` | 200 with `expiresAt` 10 s after the issue | `EXPIRED` after that |
| `05` | `mismatch` | 200; `delivered` | every code is `MISMATCH`, the last attempt `MAX_ATTEMPTS` |
| `06` | `rate_limited` | 429 `TOO_MANY_REQUESTS` (`perPhone`, `Retry-After: 60`) | - |
| `07` | `insufficient_credit` | 402 `PAYMENT_REQUIRED` (`INSUFFICIENT_CREDIT`) | - |
| `08` | `trial_daily_limit` | 402 `PAYMENT_REQUIRED` (`TRIAL_DAILY_LIMIT_EXCEEDED`) | - |
| `09` | `service_unavailable` | 503 `SERVICE_UNAVAILABLE` (`Retry-After: 2`) | - |
| `10` | `alimtalk_failover` | 200; on AlimTalk the AlimTalk send fails and the SMS fallback is `delivered` after 4 s (`failed` after 3 s with `smsFallback: false`) | `000000` verifies |
| `11`-`99` | | reserved; behave like `00` | `000000` verifies |

```ts
import { TEST_OTP_CODE, TEST_PHONE_NUMBERS } from "@k-otp/sdk";

const { issueId } = await client.issue({
  phoneNumber: TEST_PHONE_NUMBERS.success, // "010-0000-0000"
  purpose: "login",
  idempotencyKey: createIdempotencyKey(),
});
const result = await client.verify({ issueId, code: TEST_OTP_CODE });
result.verified; // true
```

`matchTestPhoneNumber(phoneNumber)` recognizes a test number in any spelling
and returns `{ region, canonical, suffix, scenario }`, or `undefined` for any
other number.

The rejecting scenarios (`06`-`09`) answer exactly like the live errors, so
your error handling, the flow helpers' cooldowns and the UI messages can be
exercised end to end. Idempotency, replacement of the previous issue for the
same number and purpose, and the verification attempt limit behave like live.
Test issues are kept for 7 days and never mix with live data: a live key
cannot read a test issue and the other way around.

## Errors specific to test mode

`issue` rejects a mismatch between the key and the number with
`BAD_REQUEST` (400). `error.code` stays `"BAD_REQUEST"`; the specific code is
in `error.data.code` (type `OtpBadRequestData`) and is the first token of
`error.message`:

| `data.code` | Cause |
| --- | --- |
| `TEST_NUMBER_REQUIRED` | A test key with a real phone number. Nothing is sent in test mode. |
| `TEST_NUMBER_IN_LIVE_MODE` | A live key with a test phone number. |

```ts
import { getTestNumberErrorCode } from "@k-otp/sdk";

try {
  await client.issue(input);
} catch (error) {
  if (getTestNumberErrorCode(error) === "TEST_NUMBER_REQUIRED") {
    // A pk_test_/sk_test_ key reached production, or a real number was typed.
  }
}
```

## Limits

Test keys use a fixed platform rate limit instead of the key's own policy:
`perKey` 120 requests per minute and `perKeyDaily` 5,000 requests per day,
counted per key and separately for issue, verify and reads (status, issues,
balance, credit ledger). New test issues also share daily budgets per
organization (`perOrgDaily`) and platform-wide (`testModeDaily`), reset at
00:00 UTC. An exceeded limit is the usual 429 with `retryAfterMs` and
`data.limit` naming the rule (`OtpRateLimitedData`).

## Balance and ledger with `sk_test_`

`getBalance()` with a test key never reads your real wallet. It returns a
fixed simulated balance that test issues never reduce (scenarios `07` and
`08` stand in for the out-of-credit paths):

```ts
const wallet = await server.getBalance();
wallet.walletScope; // "test"
wallet.walletId;    // "test:<appId>"
wallet.balance;     // 1000000
wallet.mode;        // "test"
```

`listCreditLedger()` returns an empty page.

## Unit tests without the network: `@k-otp/sdk/testing`

`createMockTransport()` simulates test mode in memory: pass its `fetch` to
any client. It follows the same scenario table and timeline, so the code
under test sees the same responses as with a real test key, but nothing
leaves the process and no daily test budget is used.

```ts
import { createOtpClient, TEST_OTP_CODE, TEST_PHONE_NUMBERS } from "@k-otp/sdk";
import { createOtpServerClient } from "@k-otp/sdk/server";
import { createMockTransport, TEST_MODE_TIMINGS } from "@k-otp/sdk/testing";

const mock = createMockTransport({ now: () => Date.parse("2026-10-11T00:00:00Z") });
const client = createOtpClient({ apiKey: "pk_test_unit", fetch: mock.fetch });
const server = createOtpServerClient({ apiKey: "sk_test_unit", fetch: mock.fetch });

const { issueId } = await client.issue({
  phoneNumber: TEST_PHONE_NUMBERS.delivery_failed,
  purpose: "login",
  idempotencyKey: "unit-1",
});
mock.advance(TEST_MODE_TIMINGS.failedAfterMs); // walk the timeline, no waiting
(await server.getStatus({ issueId })).deliveryStatus; // "failed"
mock.issues(); // what the console test inbox would show, newest first
mock.reset();  // between tests
```

- Options: `now` (the clock, default `Date.now`; `advance(ms)` moves it
  forward), `appId` and `organizationId` (used by the balance result).
- Any `pk_test_`/`sk_test_` key works; the key value is not checked.
  `pk_test_` keys may only issue and verify (403 otherwise). A live key gets
  400 `TEST_NUMBER_IN_LIVE_MODE` for a test number and 401 for anything else:
  live delivery is never simulated.
- Idempotency fingerprints use resolved values like the API: a retry that
  spells out a default (`channel: "alimtalk"`, `expiresInSec: 180`,
  `maxAttempts: 5`, the default `templateId`) replays instead of 409.
- Not simulated: `Origin` checks, rate limits and daily budgets (scenario
  `06` still answers 429), template variables (any `templateId` is accepted;
  `listTemplates` returns only the default template `otp_default_kr`).
- The scenario table, test number ranges and timings mirror the API's test
  mode and are updated together with it: an SDK release that matches a new
  API contract version also updates the mock.
- It also exports `TEST_MODE_TIMINGS`, `TEST_MODE_SIMULATED_BALANCE` and the
  test-mode constants of `@k-otp/sdk`.

With the framework adapters and the UI components, create the client with the
mock's `fetch` and pass it to the provider, plugin or stores as usual:

```tsx
const client = createOtpClient({ apiKey: "pk_test_unit", fetch: createMockTransport().fetch });
render(<OtpProvider client={client}><Screen /></OtpProvider>);
```

## Before going live

- Swap the `pk_test_`/`sk_test_` keys for live keys in production
  configuration. A test key in production fails fast: real numbers get
  `TEST_NUMBER_REQUIRED`.
- Keep test numbers out of production data: live keys reject them with
  `TEST_NUMBER_IN_LIVE_MODE`.
- The simulator cannot reproduce every live failure (quota, provider
  outages). Confirm a rollout with a few real sends on a live key.
