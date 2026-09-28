# @k-otp/sdk-core

Framework-agnostic client for the [K-OTP](https://api.k-otp.dev) Korean OTP API.
Issue and verify one-time passwords (SMS / KakaoTalk AlimTalk) from browsers,
SSR frameworks, and edge runtimes.

- `issue` / `verify` only: the operations a browser `pk_` key may call
- Zero framework dependencies, side-effect free, SSR-safe (no `window` access at import)
- Typed from the published OpenAPI spec; normalized `OtpApiError`
- ESM, CommonJS and a `<script>` bundle exposing `window.KOtp`

Server code that needs status, history, balance or templates should use
[`@k-otp/sdk-server`](../sdk-server) with an `sk_` secret key. React, Vue and
Svelte apps can use the adapters [`@k-otp/sdk-react`](../sdk-react),
[`@k-otp/sdk-vue`](../sdk-vue) and [`@k-otp/sdk-svelte`](../sdk-svelte), which
add loading/error state and an issue -> verify flow on top of this package.

## Install

```bash
npm install @k-otp/sdk-core
# or: bun add / pnpm add / yarn add @k-otp/sdk-core
```

Requires a runtime with `fetch`, `AbortController` and Web Streams (all modern
browsers, Node.js >= 20.19, Bun, Deno, Cloudflare Workers).

## Quick start

```ts
import { createIdempotencyKey, createOtpClient, isOtpApiError } from "@k-otp/sdk-core";

const otp = createOtpClient({
  apiKey: "pk_live_...", // public key; its allowedOrigins must include this page's exact origin
});

// Create ONE key per "send code" action and reuse it for retries of that action.
const idempotencyKey = createIdempotencyKey("signup");

const { issueId, expiresAt } = await otp.issue({
  phoneNumber: "01012345678",
  purpose: "signup",
  idempotencyKey,
});

const result = await otp.verify({ issueId, code: "123456" });
if (!result.verified) {
  // MISMATCH | MAX_ATTEMPTS | EXPIRED | ALREADY_VERIFIED | REPLACED | NOT_FOUND
  console.log(result.reasonCode, result.attemptsRemaining);
}
```

## CDN / static sites

```html
<script
  src="https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js"
  integrity="sha384-REPLACE_WITH_THE_FILE_HASH"
  crossorigin="anonymous"
></script>
<script>
  const otp = KOtp.createOtpClient({ apiKey: "pk_live_..." });
  const key = KOtp.createIdempotencyKey();
  otp.issue({ phoneNumber: "01012345678", purpose: "login", idempotencyKey: key });
</script>
```

Always pin an exact version and add Subresource Integrity. Get the hash from
jsDelivr ("Copy HTML + SRI" on the package page) or compute it:

```bash
curl -s https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

`dist/k-otp.iife.js` is the unminified variant.

## API

### `createOtpClient(options): OtpClient`

| Option | Type | Default | |
| --- | --- | --- | --- |
| `apiKey` | `string \| () => string \| Promise<string>` | required | `pk_` in browsers. A function is resolved before every request (key rotation, runtime injection). |
| `baseUrl` | `string` | `https://api.k-otp.dev/v1` | Must include `/v1`. Relative URLs resolve against `location` in browsers. |
| `fetch` | `typeof fetch` | `globalThis.fetch` (looked up lazily) | Custom fetch (tests, proxies, instrumentation). |
| `timeoutMs` | `number` | `10000` | Per request; `0` disables. |
| `headers` | `Record<string, string>` | | Extra headers; `authorization` cannot be overridden. Custom headers must be allowed by the API's CORS policy in browsers. |
| `hooks` | `OtpTelemetryHooks` | | See [Telemetry](#telemetry). |
| `dangerouslyAllowSecretKeyInBrowser` | `boolean` | `false` | The client throws if an `sk_` key is used where `window` and `document` exist. |

Creating a client performs no I/O. Configuration mistakes (missing key, `sk_`
key in a browser, no `fetch`) throw a `TypeError`.

### `client.issue(input, options?)` - `POST /v1/issue`

`input`: `phoneNumber`, `purpose`, **`idempotencyKey` (required)**, and optional
`channel` (`"sms"` | `"alimtalk"`), `templateId`, `templateVariables`, `from`,
`messageType`, `cost`, `metadata`, `expiresInSec`, `maxAttempts`.
Resolves `{ issueId, expiresAt, attemptsRemaining, queuedAt }`.

The key is trimmed and validated (1-128 visible ASCII characters) before any
network request; an invalid key rejects with `OtpApiError` `BAD_REQUEST` / 400.
It is sent as both the `Idempotency-Key` header and the body field.

### `client.verify(input, options?)` - `POST /v1/verify`

`input`: `{ issueId, code }`. Resolves `{ issueId, verified, reasonCode?,
attemptsRemaining, expiresAt, verifiedAt? }`. A wrong code is **not** an error:
it resolves with `verified: false` and a `reasonCode`.

### Per-call options

`{ signal?: AbortSignal; timeoutMs?: number }` on every method.

### `createIdempotencyKey(prefix?)`

Returns a random UUID v4 (`crypto.randomUUID`, falling back to
`crypto.getRandomValues` outside secure contexts), optionally prefixed.
Persist it with the pending action and reuse it when retrying; see
[errors and retries](../../docs/errors-and-retries.md).

### Errors

Every rejection from `issue`/`verify` is an `OtpApiError`:

```ts
class OtpApiError extends Error {
  code: OtpApiErrorCode;   // see below
  status: number;          // HTTP status, 0 when no response was received
  requestId?: string;      // X-Request-Id (else request-id / cf-ray), when readable
  data?: unknown;          // e.g. { code: "INSUFFICIENT_CREDIT" } for 402
  retryAfterMs?: number;   // from Retry-After or the error body
  retryable: boolean;      // TOO_MANY_REQUESTS, INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE, TIMEOUT, NETWORK_ERROR
}
```

Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `PAYMENT_REQUIRED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`,
`SERVICE_UNAVAILABLE`, `TIMEOUT`, `NETWORK_ERROR`, `ABORTED`, `UNKNOWN`.

Use `isOtpApiError(error)` rather than `instanceof` when several copies of the
SDK may be loaded (for example the CDN bundle and an npm install).

### Telemetry

```ts
createOtpClient({
  apiKey,
  hooks: {
    onRequestStart: (op) => {},                       // "issue" | "verify"
    onRequestEnd: (op, ok, status, info) => {},       // info: { durationMs, requestId?, error? }
  },
});
```

Hooks run synchronously; exceptions thrown by hooks are swallowed. They are not
called for client-side validation failures (no request is made).

### Headless flow: `@k-otp/sdk-core/headless`

The state machine behind the React, Vue and Svelte adapters, for plain
JavaScript or any other framework. Also available in the CDN bundle as
`KOtp.createOtpFlow` / `KOtp.createOtpOperation`.

```ts
import { createOtpClient } from "@k-otp/sdk-core";
import { createOtpFlow } from "@k-otp/sdk-core/headless";

const flow = createOtpFlow(createOtpClient({ apiKey: "pk_live_..." }), {
  // resendCooldownMs: 30_000 (default; 0 disables), idempotencyKeyPrefix, createIdempotencyKey
});
const unsubscribe = flow.subscribe(() => render(flow.getState()));

await flow.send({ phoneNumber, purpose: "signup" }); // { data } | { error } | { skipped }
await flow.verify(code);
flow.getState(); // issueId, verified, reasonCode, error, canSend, canVerify,
                 // cooldownRemainingMs (ticks ~1/s while subscribed), idempotencyKey, ...
```

- One idempotency key per send attempt; the same key is reused when `send`
  is called again with the same input after an ambiguous failure (`TIMEOUT`,
  `NETWORK_ERROR`, 5xx, 429, `ABORTED`) and dropped after a success, a
  definitive error or changed input.
- Cooldown: `resendCooldownMs` (default `DEFAULT_RESEND_COOLDOWN_MS`, 30 s)
  after each successful send, and the server's `retryAfterMs` on 429/503.
- Actions never reject for API errors; blocked actions resolve with
  `{ skipped: "cooldown" | "busy" | "no-issue" | "no-previous-send" | "terminal" }`.
- `verified: false` with `EXPIRED`, `MAX_ATTEMPTS`, `REPLACED`, `NOT_FOUND`
  or `ALREADY_VERIFIED` is terminal for that code (`canVerify` becomes false).
- `reset()` clears the flow but keeps the cooldown; `abort()` cancels
  in-flight requests (e.g. when your view is torn down).

`createOtpOperation(execute)` is the single-operation building block
(`getState`, `subscribe`, `run`, `reset`, `abort`) with stale-response
protection. See the [issue -> verify UX guide](../../docs/issue-verify-ux.md).

### Advanced entry points

- `@k-otp/sdk-core/contract` - the oRPC contract (`otpPublicContract`,
  `otpServerContract`) and every generated OpenAPI type, for building your own
  oRPC `OpenAPILink` client.
- `@k-otp/sdk-core/internal` - transport building blocks for
  `@k-otp/sdk-server`. **Not covered by SemVer.**

## Runtime notes

- **SSR:** importing and creating a client is safe on the server; nothing runs
  until you call a method. Create browser clients with a `pk_` key only.
- **Origins:** `pk_` keys require an `Origin` header that exactly matches one
  of the key's `allowedOrigins` (scheme + host + port, no wildcards). Calls from
  servers or tools without a matching `Origin` get `FORBIDDEN`.
- **Request ids in browsers:** the API exposes `X-Request-Id` and
  `Retry-After` to allowed origins, so `requestId`/`retryAfterMs` work in
  browsers. They are undefined when no response was readable.
- **`NETWORK_ERROR` in the browser but works with curl:** the page origin is
  not in the `pk_` key's `allowedOrigins`. For unlisted origins the API sends
  no CORS headers, so the browser blocks the response and the SDK can only
  report `NETWORK_ERROR` (status 0, no `requestId`; the message carries a
  hint in browsers). Fix the allowlist entry: exact scheme + host + port.
- **CommonJS:** the CJS build `require()`s the ESM-only `@orpc/*` packages,
  which needs Node.js >= 20.19 (or 22.12+). ESM consumers are unaffected.
- **Timeouts:** the default is 10 seconds per request (`DEFAULT_TIMEOUT_MS`).

## Versioning

All `@k-otp/sdk-*` packages are released in lockstep with the same version.
Breaking changes bump the minor version while `0.x`. See the
[changelog](./CHANGELOG.md).

## License

MIT
