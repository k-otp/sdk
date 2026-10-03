# @k-otp/sdk

The official JavaScript/TypeScript SDK for the [K-OTP](https://api.k-otp.dev)
Korean OTP API: issue and verify one-time passwords (delivered by KakaoTalk AlimTalk by
default, with automatic SMS fallback) from browsers, SSR frameworks, edge
runtimes and servers. One package, with a subpath per use:

| Import | Use it for | Key | Reference |
| --- | --- | --- | --- |
| `@k-otp/sdk` (= `@k-otp/sdk/core`) | Framework-agnostic `issue` / `verify` for browsers, SSR and edge | `pk_` (browser) or `sk_` | [below](#api) |
| `@k-otp/sdk/headless` | The issue -> verify flow state machine behind the adapters | | [below](#headless-flow-k-otpsdkheadless) |
| `@k-otp/sdk/server` | Every public `/v1` operation (status, history, ledger, balance, templates) from Node.js, Bun, Deno or edge runtimes; never bundled for browsers | `sk_` only | [server](../../docs/reference/server.md) |
| `@k-otp/sdk/react` | `OtpProvider`, `useOtpIssue`, `useOtpVerify`, `useOtpFlow` (React 18/19, `"use client"`) | `pk_` | [react](../../docs/reference/react.md) |
| `@k-otp/sdk/vue` | `createOtpPlugin`, `useOtp`, `useOtpFlow` (Vue >= 3.3) | `pk_` | [vue](../../docs/reference/vue.md) |
| `@k-otp/sdk/svelte` | `createOtpStores`, flow store, `use:otpForm` (Svelte 4/5, ESM-only) | `pk_` | [svelte](../../docs/reference/svelte.md) |
| `@k-otp/sdk/ui/react`, `/ui/vue`, `/ui/svelte` | Headless UI components: `<OtpForm />` preset and composable parts (React 18/19, Vue >= 3.3, Svelte 4/5) | `pk_` | [ui](../../docs/reference/ui.md) |
| `@k-otp/sdk/ui/theme.css` | Optional default theme for the UI components | | [theme](../../docs/ui.md#theme) |
| `@k-otp/sdk/ui` | The framework-agnostic UI model (phone, code input, form state machine, messages, WebOTP) | | [ui](../../docs/reference/ui.md#k-otpsdkui) |
| `@k-otp/sdk/contract` | The oRPC contract and generated OpenAPI types, for custom oRPC clients | | [below](#advanced-entry-points) |
| `@k-otp/sdk/k-otp.iife.min.js` | `<script>` bundle exposing `window.KOtp` (also `k-otp.iife.js`) | `pk_` | [below](#cdn--static-sites) |

- Zero framework code in the core, side-effect free (only the optional theme
  CSS is a side effect: `sideEffects: ["**/*.css"]`), SSR-safe (no `window`
  access at import)
- Each subpath only loads what it needs: `@k-otp/sdk/react` never pulls Vue,
  Svelte, the UI components or the server client, `@k-otp/sdk/ui/react` never
  pulls Vue or Svelte, and the subpaths share one copy of the core per module
  format (`OtpApiError` from `@k-otp/sdk` and `@k-otp/sdk/react` is the same
  class; across the ESM and CommonJS builds, `instanceof OtpApiError` still
  matches)
- Typed from the published OpenAPI spec; normalized `OtpApiError`
- ESM and CommonJS per subpath (Svelte: ESM only) with type declarations,
  plus the `<script>` bundle

## Install

```bash
npm install @k-otp/sdk
# or: bun add / pnpm add / yarn add @k-otp/sdk
```

The only runtime dependencies are the `@orpc/*` client packages. React, Vue
and Svelte are **optional peer dependencies**: install the one your app uses
(it already does), and only import its subpath.

| Subpath | Peer dependency |
| --- | --- |
| `@k-otp/sdk/react`, `@k-otp/sdk/ui/react` | `react >= 18` |
| `@k-otp/sdk/vue`, `@k-otp/sdk/ui/vue` | `vue >= 3.3` |
| `@k-otp/sdk/svelte`, `@k-otp/sdk/ui/svelte` | `svelte >= 4` |
| everything else | none |

Requires a runtime with `fetch`, `AbortController` and Web Streams (all modern
browsers, Node.js >= 20.19, Bun, Deno, Cloudflare Workers).

TypeScript resolves the subpaths through the `exports` map, which needs
`"moduleResolution": "bundler"`, `"node16"` or `"nodenext"`. The legacy
`"node"` (`node10`) setting only sees the root `@k-otp/sdk`. `@k-otp/sdk/svelte`
ships plain JavaScript stores (no `.svelte` files), so it has no `svelte`
export condition on purpose.

## Quick start

```ts
import { createIdempotencyKey, createOtpClient, isOtpApiError } from "@k-otp/sdk";

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
  src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js"
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
curl -s https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

unpkg works the same way:
`https://unpkg.com/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js` (the package's
`unpkg` / `jsdelivr` fields also point there, so
`https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1` serves it too). CDN URLs use
the file path `dist/...`; bundlers and Node.js use the package export
`@k-otp/sdk/k-otp.iife.min.js`. `dist/k-otp.iife.js` is the unminified
variant.

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
`templateId`, `templateVariables`, `from`, `messageType`, `metadata`,
`expiresInSec`, `maxAttempts`. The code is delivered by KakaoTalk AlimTalk by
default, with automatic SMS fallback when AlimTalk cannot be delivered; leave
`channel` out. `cost` is still accepted but deprecated: the API decides the
charged credit from the delivery channel and message type and ignores it for
billing.
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
  data?: unknown;          // e.g. { code: "INSUFFICIENT_CREDIT" } for 402,
                           // { limit, policy, retryAfterMs } for 429
  retryAfterMs?: number;   // data.retryAfterMs, else Retry-After (429, some 503s)
  retryable: boolean;      // TOO_MANY_REQUESTS, INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE, TIMEOUT, NETWORK_ERROR
}
```

Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `PAYMENT_REQUIRED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`,
`SERVICE_UNAVAILABLE`, `TIMEOUT`, `NETWORK_ERROR`, `ABORTED`, `UNKNOWN`.

`error instanceof OtpApiError` also matches errors from another copy of the
SDK (the ESM and CommonJS builds loaded side by side, the CDN bundle and an
npm install): every `OtpApiError` carries a shared `Symbol.for` brand, which
`instanceof` and `isOtpApiError(error)` check.

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

### Headless flow: `@k-otp/sdk/headless`

The state machine behind the React, Vue and Svelte adapters, for plain
JavaScript or any other framework. Also available in the CDN bundle as
`KOtp.createOtpFlow` / `KOtp.createOtpOperation`.

```ts
import { createOtpClient } from "@k-otp/sdk";
import { createOtpFlow } from "@k-otp/sdk/headless";

const flow = createOtpFlow(createOtpClient({ apiKey: "pk_live_..." }), {
  // resendCooldownMs: 30_000 (default; 0 disables), idempotencyKeyPrefix, createIdempotencyKey
});
const unsubscribe = flow.subscribe(() => render(flow.getState()));

await flow.send({ phoneNumber, purpose: "signup" }); // { data } | { error } | { skipped }
await flow.verify(code);
flow.getState(); // issueId, verified, reasonCode, error, canSend, canVerify,
                 // cooldownRemainingMs (ticks ~1/s while subscribed),
                 // verifyCooldownRemainingMs, idempotencyKey, ...
```

- One idempotency key per send attempt; the same key is reused when `send`
  is called again with the same input after an ambiguous failure (`TIMEOUT`,
  `NETWORK_ERROR`, 5xx, 429, `ABORTED`) and dropped after a success, a
  definitive error or changed input.
- Cooldown: `resendCooldownMs` (default `DEFAULT_RESEND_COOLDOWN_MS`, 30 s)
  after each successful send, and the server's `retryAfterMs` on 429/503.
  A 429/503 on `verify` starts a separate verify cooldown
  (`verifyCooldownRemainingMs`; `canVerify` is false and `verify` is skipped
  with `"cooldown"` until it ends).
- Actions never reject for API errors; blocked actions resolve with
  `{ skipped: "cooldown" | "busy" | "no-issue" | "no-previous-send" | "terminal" }`.
- `verified: false` with `EXPIRED`, `MAX_ATTEMPTS`, `REPLACED`, `NOT_FOUND`
  or `ALREADY_VERIFIED` is terminal for that code (`canVerify` becomes false).
- `reset()` clears the flow but keeps the cooldowns; `abort()` cancels
  in-flight requests (e.g. when your view is torn down).

`createOtpOperation(execute)` is the single-operation building block
(`getState`, `subscribe`, `run`, `reset`, `abort`) with stale-response
protection. See the [issue -> verify UX guide](../../docs/issue-verify-ux.md).

### Advanced entry points

- `@k-otp/sdk/contract` - the oRPC contract (`otpPublicContract`,
  `otpServerContract`), `OPENAPI_VERSION` and every generated OpenAPI type,
  for building your own oRPC `OpenAPILink` client.

Anything not listed in the `exports` map (for example the shared transport
under `src/core/internal.ts`) is private and cannot be imported.

## UI components

```tsx
import { OtpForm } from "@k-otp/sdk/ui/react"; // or /ui/vue, /ui/svelte
import "@k-otp/sdk/ui/theme.css"; // optional

<OtpForm options={{ apiKey: "pk_live_..." }} purpose="signup" onVerified={(r) => console.log(r.issueId)} />;
```

A phone field (Korean mobiles canonicalized before sending), send/resend with
the cooldown, a segmented code input (paste, `one-time-code` autofill,
WebOTP, keyboard navigation), verify, an expiry countdown and a live status
message, in Korean or English. Headless parts (`OtpForm.Root`,
`OtpForm.PhoneField`, ...) expose `data-*` state and render props / slots.
Guide: [UI components](../../docs/ui.md); API:
[reference](../../docs/reference/ui.md). The Svelte components are shipped as
`.svelte` sources (the `svelte` export condition) that your Svelte 4 or 5
compiles.

## Server, React, Vue and Svelte

```ts
// Backend (Node.js, Bun, Deno, Workers) with an sk_ key:
import { createOtpServerClient } from "@k-otp/sdk/server";
const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });
await otp.getBalance();
```

```tsx
// React (Vue and Svelte mirror this API):
import { OtpProvider, useOtpFlow } from "@k-otp/sdk/react";
```

`@k-otp/sdk/server` resolves to a stub under the `browser` export condition
(same exports; every function throws when called), so the `sk_` client
cannot slip into a client bundle; server runtimes that also set `browser` (Cloudflare Workers, Vercel
Edge) are matched first and get the real client. Details, every method and
the framework APIs: [server](../../docs/reference/server.md),
[react](../../docs/reference/react.md), [vue](../../docs/reference/vue.md),
[svelte](../../docs/reference/svelte.md); guides:
[React](../../docs/react.md), [Vue](../../docs/vue.md),
[Svelte](../../docs/svelte.md).

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

`@k-otp/sdk` follows SemVer from 1.0.0. Every subpath listed above is part of
the public API and shares the package version. See the
[changelog](./CHANGELOG.md).

## License

MIT
