# @k-otp/sdk-react

React hooks for the [K-OTP](https://api.k-otp.dev) Korean OTP API, built on
[`@k-otp/sdk-core`](../sdk-core). Works with React 18 and 19, in client
components, SSR and React Server Components setups (the hooks module is marked
`"use client"`).

- `OtpProvider`, `useOtpClient`, `useOtpIssue`, `useOtpVerify`
- `useOtpFlow`: the common issue -> verify flow with resend cooldown and
  idempotency key handling
- No Suspense required, no global state, SSR-safe (no `window` access at
  import or render)
- Built on the public [`@k-otp/sdk-core/headless`](../sdk-core#headless-flow-k-otpsdk-coreheadless) flow; same semantics and normalized `OtpApiError` as the Vue and Svelte adapters

## Install

```bash
npm install @k-otp/sdk-react
```

`react >= 18` is a peer dependency. `@k-otp/sdk-core` is installed
automatically (pinned to the same version) and its common exports
(`createOtpClient`, `createIdempotencyKey`, `isOtpApiError`, `OtpApiError`,
types) are re-exported here.

## Quick start

```tsx
import { OtpProvider, useOtpFlow } from "@k-otp/sdk-react";
import { useState } from "react";

export function App() {
  return (
    // pk_ public key: its allowedOrigins must list this page's exact origin.
    <OtpProvider options={{ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY }}>
      <PhoneVerification />
    </OtpProvider>
  );
}

function PhoneVerification() {
  const otp = useOtpFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "signup" });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  if (otp.verified) return <p>Verified</p>;
  return (
    <>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button
        disabled={!otp.canSend}
        onClick={() => void otp.send({ phoneNumber: phone, purpose: "signup" })}
      >
        {otp.cooldownRemainingMs > 0
          ? `Resend in ${Math.ceil(otp.cooldownRemainingMs / 1000)}s`
          : otp.issueId ? "Resend code" : "Send code"}
      </button>
      <input value={code} onChange={(e) => setCode(e.target.value)} />
      <button disabled={!otp.canVerify} onClick={() => void otp.verify(code)}>
        Verify
      </button>
      {otp.reasonCode && <p>Code rejected: {otp.reasonCode}</p>}
      {otp.error && <p role="alert">{otp.error.code}: {otp.error.message}</p>}
    </>
  );
}
```

See [`examples/react-vite`](../../examples/react-vite) for a runnable app and
the [issue -> verify UX guide](../../docs/issue-verify-ux.md).

## API

### `<OtpProvider client={client}>` / `<OtpProvider options={options}>`

Provides a client to the hooks below. `options` are `createOtpClient` options
(`apiKey`, `baseUrl`, `fetch`, `timeoutMs`, `headers`, `hooks`) and are read
once, on the first render; pass `client` to control the client's lifetime
yourself. Creating a client performs no I/O.

### `useOtpClient(client?)`

Returns `client` or the provider's client. Throws a `TypeError` when neither
exists.

### `useOtpIssue(options?)` / `useOtpVerify(options?)`

```ts
const { run, data, error, isLoading, status, reset } = useOtpIssue();
// status: "idle" | "loading" | "success" | "error"
const { data, error } = await run({ phoneNumber, purpose, idempotencyKey });
```

| Field | |
| --- | --- |
| `run(input, { signal?, timeoutMs? })` | Calls `issue`/`verify`. Resolves `{ data }` or `{ error }`; it does **not** reject for API errors (safe in event handlers). Configuration mistakes still throw `TypeError`. |
| `data` | Result of the latest successful call (cleared when a new call starts). |
| `error` | `OtpApiError` of the latest failed call. |
| `isLoading`, `status` | Loading flag and status of the latest call. |
| `reset()` | Aborts an in-flight call and returns to `idle`. |

`run` and `reset` are stable across renders. `options.client` overrides the
provider's client.

- **Stale-response protection:** when `run` is called again before the
  previous call settled, only the latest call updates the state (each caller
  still receives its own outcome).
- **Abort on unmount:** in-flight requests are aborted when the component
  unmounts (the promise resolves with an `ABORTED` error, state is not
  updated).
- `useOtpIssue` does not create idempotency keys for you: pass one per logical
  send and reuse it on retries (or use `useOtpFlow`).

### `useOtpFlow(options?)`

Wraps issue + verify with the rules from the
[issue -> verify UX guide](../../docs/issue-verify-ux.md).

| Option | Default | |
| --- | --- | --- |
| `resendCooldownMs` | `30000` | Local cooldown after a successful send; `0` disables it. |
| `idempotencyKeyPrefix` | | Prefix for generated keys. |
| `createIdempotencyKey` | `createIdempotencyKey(prefix)` | Custom key factory. |
| `client` | provider | |

Returns the state plus `send(input)`, `resend()`, `verify(code)`, `reset()`:

| State | |
| --- | --- |
| `issueId`, `expiresAt`, `attemptsRemaining` | From the latest send/verify. |
| `verified`, `reasonCode` | Latest verification outcome (`MISMATCH`, `EXPIRED`, ...). |
| `error` | Latest `OtpApiError` of either call. |
| `isLoading`, `issueState`, `verifyState` | Loading flag and per-operation state. |
| `idempotencyKey` | Key of the current send attempt, kept after ambiguous failures. |
| `cooldownRemainingMs`, `cooldownUntil`, `canSend` | Resend cooldown (updates about once a second). |
| `canVerify` | A code can be verified now. |

Key handling: a key is generated per send attempt and **reused** when `send`
is called again with the same input after an ambiguous failure (`TIMEOUT`,
`NETWORK_ERROR`, 5xx, 429, `ABORTED`); it is dropped after a success or a
definitive error (400/401/402/403/409), so the next send is a new attempt.
Server `retryAfterMs` (429/503) starts a cooldown just like
`resendCooldownMs`. Actions that cannot run resolve with
`{ skipped: "cooldown" | "busy" | "no-issue" | "no-previous-send" }`.
Options are read when the flow is created.

## Runtime notes

- **SSR / RSC:** rendering on the server performs no request and shows the
  idle state. The package is marked `"use client"`; use the hooks from client
  components. Never pass an `sk_` key to `OtpProvider` (sdk-core refuses `sk_`
  keys in browsers); server-driven flows should call
  [`@k-otp/sdk-server`](../sdk-server) from your backend instead.
- **Origins:** `pk_` keys only work from origins listed exactly (scheme, host,
  port) in the key's `allowedOrigins`; otherwise the API answers
  `403 FORBIDDEN`.
- **StrictMode:** supported. Development double-mount aborts nothing that has
  not started yet; a flow that is re-sent after an aborted attempt reuses the
  same idempotency key.
- **CommonJS** consumers need Node.js >= 20.19 (see sdk-core).

## Troubleshooting

- **`NETWORK_ERROR` in the browser, but the same key works with curl:** the
  page origin is not in the `pk_` key's `allowedOrigins`. For unlisted
  origins the API sends no CORS headers, so the browser blocks the response
  and the SDK can only report `NETWORK_ERROR` (status 0, no `requestId`).
  Add the origin exactly: scheme + host + port (`http://localhost:5173` is
  not `http://127.0.0.1:5173`), no path or trailing slash.
- **`error.requestId`** comes from the `X-Request-Id` response header;
  include it when contacting support.

## Versioning and migration

All `@k-otp/sdk-*` packages are released in lockstep; this package depends on
the exact same `@k-otp/sdk-core` version. While `0.x`, breaking changes bump
the minor version and are listed in the [changelog](./CHANGELOG.md).

## License

MIT
