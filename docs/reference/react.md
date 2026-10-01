# `@k-otp/sdk/react` reference

React hooks for the [K-OTP](https://api.k-otp.dev) Korean OTP API, in the `react`
subpath of [`@k-otp/sdk`](../../packages/sdk/README.md). Works with React 18 and 19, in client
components, SSR and React Server Components setups (the hooks module is marked
`"use client"`).

- `OtpProvider`, `useOtpClient`, `useOtpIssue`, `useOtpVerify`
- `useOtpFlow`: the common issue -> verify flow with resend cooldown and
  idempotency key handling
- No Suspense required, no global state, SSR-safe (no `window` access at
  import or render)
- Built on the public [`@k-otp/sdk/headless`](../../packages/sdk/README.md#headless-flow-k-otpsdkheadless) flow; same semantics and normalized `OtpApiError` as the Vue and Svelte adapters

## Install

```bash
npm install @k-otp/sdk react
```

`react` (`>= 18`) is an optional peer dependency of `@k-otp/sdk`: install it
yourself (your app already has it). `@k-otp/sdk/react` only loads React, never
the other frameworks or the server client. The common core exports
(`createOtpClient`, `createIdempotencyKey`, `isOtpApiError`, `OtpApiError`,
types) are re-exported here and are the same objects as in `@k-otp/sdk`
(within one module format).

## Quick start

```tsx
import { OtpProvider, useOtpFlow } from "@k-otp/sdk/react";
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
the [issue -> verify UX guide](../issue-verify-ux.md).

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
[issue -> verify UX guide](../issue-verify-ux.md).

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
| `verifyCooldownRemainingMs`, `verifyCooldownUntil` | Verify cooldown after a rate-limited (429) verify. |
| `canVerify` | A code can be verified now. |

Key handling: a key is generated per send attempt and **reused** when `send`
is called again with the same input after an ambiguous failure (`TIMEOUT`,
`NETWORK_ERROR`, 5xx, 429, `ABORTED`); it is dropped after a success or a
definitive error (400/401/402/403/409), so the next send is a new attempt.
Server `retryAfterMs` (429/503) on `send` starts a cooldown just like
`resendCooldownMs`; on `verify` it starts the separate verify cooldown
(`canVerify` is `false` until it ends). Actions that cannot run resolve with
`{ skipped: "cooldown" | "busy" | "no-issue" | "no-previous-send" | "terminal" }`.
Options are read when the flow is created.

## Runtime notes

- **SSR / RSC:** rendering on the server performs no request and shows the
  idle state. The package is marked `"use client"`; use the hooks from client
  components. Never pass an `sk_` key to `OtpProvider` (the core client refuses `sk_`
  keys in browsers); server-driven flows should call
  [`@k-otp/sdk/server`](./server.md) from your backend instead.
- **Origins:** `pk_` keys only work from origins listed exactly (scheme, host,
  port) in the key's `allowedOrigins`; otherwise the API answers
  `403 FORBIDDEN`.
- **StrictMode:** supported. Development double-mount aborts nothing that has
  not started yet; a flow that is re-sent after an aborted attempt reuses the
  same idempotency key.
- **CommonJS** consumers need Node.js >= 20.19 (see the [`@k-otp/sdk` runtime notes](../../packages/sdk/README.md#runtime-notes)).

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

`@k-otp/sdk/react` is versioned with the rest of `@k-otp/sdk` (one package, one
version, SemVer from 1.0.0). Changes are listed in the
[changelog](../../packages/sdk/CHANGELOG.md).

## License

MIT
