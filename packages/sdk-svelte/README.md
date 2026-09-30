# @k-otp/sdk-svelte

Svelte stores for the [K-OTP](https://api.k-otp.dev) Korean OTP API, built on
[`@k-otp/sdk-core`](../sdk-core). Plain TypeScript on `svelte/store`: works
with Svelte 4 and Svelte 5 (runes components can use `$store` too), no
`.svelte` compilation needed.

- `createOtpStores(clientOrOptions)`: readable `issue` / `verify` operation
  stores with `run` / `reset`, plus `loading`, `error` and `otpClientStore`
- `createOtpFlowStore` / `stores.createFlow()`: the common issue -> verify
  flow with resend cooldown and idempotency key handling
- `setOtpContext` / `getOtpContext` for SSR-safe sharing through context
- `otpForm`: optional `use:` action for form wiring
- Built on the public [`@k-otp/sdk-core/headless`](../sdk-core#headless-flow-k-otpsdk-coreheadless) flow; same semantics and normalized `OtpApiError` as the React and Vue adapters

## Install

```bash
npm install @k-otp/sdk-svelte
```

`svelte >= 4` is a peer dependency. `@k-otp/sdk-core` is installed
automatically (pinned to the same version) and its common exports
(`createOtpClient`, `createIdempotencyKey`, `isOtpApiError`, `OtpApiError`,
types) are re-exported here. This package is ESM-only, like Svelte.

## Quick start

```svelte
<script lang="ts">
  import { createOtpStores, otpForm } from "@k-otp/sdk-svelte";

  // pk_ public key: its allowedOrigins must list this page's exact origin.
  const otp = createOtpStores({ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY });
  const flow = otp.createFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "signup" });
</script>

{#if $flow.verified}
  <p>Verified</p>
{:else}
  <form use:otpForm={(data) => flow.send({ phoneNumber: String(data.get("phone")), purpose: "signup" })}>
    <input name="phone" />
    <button disabled={!$flow.canSend}>
      {$flow.cooldownRemainingMs > 0 ? `Resend in ${Math.ceil($flow.cooldownRemainingMs / 1000)}s` : "Send code"}
    </button>
  </form>
  <form use:otpForm={(data) => flow.verify(String(data.get("code")))}>
    <input name="code" />
    <button disabled={!$flow.canVerify}>Verify</button>
  </form>
  {#if $flow.reasonCode}<p>Code rejected: {$flow.reasonCode}</p>{/if}
  {#if $flow.error}<p role="alert">{$flow.error.code}: {$flow.error.message}</p>{/if}
{/if}
```

See [`examples/svelte-vite`](../../examples/svelte-vite) for a runnable app and
the [issue -> verify UX guide](../../docs/issue-verify-ux.md).

## API

### `createOtpStores(clientOrOptions): OtpStores`

| Member | |
| --- | --- |
| `issue`, `verify` | `OtpOperationStore`: `Readable<{ status, isLoading, data, error }>` plus `run`, `reset`, `abort`. |
| `loading` | `Readable<boolean>`: either operation in flight. |
| `error` | `Readable<OtpApiError \| undefined>`: `verify`'s error, else `issue`'s. |
| `otpClientStore`, `client` | The client, as a store and as a value. |
| `reset()` | Resets both operations. |
| `abort()` | Aborts in-flight calls without updating the stores (teardown). |
| `createFlow(options?)` | An `OtpFlowStore` bound to the same client. |

`run(input, { signal?, timeoutMs? })` resolves `{ data }` or `{ error }`; it
does **not** reject for API errors (configuration mistakes still throw
`TypeError`). A newer `run` supersedes older ones: only the latest call
updates the store. `issue.run` does not create idempotency keys: pass one per
logical send and reuse it on retries (or use the flow store).

### `createOtpFlowStore(clientOrOptions, options?): OtpFlowStore`

A `Readable<OtpFlowState>` (`issueId`, `expiresAt`, `attemptsRemaining`,
`verified`, `reasonCode`, `error`, `isLoading`, `issueState`, `verifyState`,
`idempotencyKey`, `cooldownRemainingMs`, `cooldownUntil`,
`verifyCooldownRemainingMs`, `verifyCooldownUntil`, `canSend`, `canVerify`) with `send(input)`, `resend()`, `verify(code)`, `reset()` and
`abort()`. Options: `resendCooldownMs` (default `30000`; `0` disables it),
`idempotencyKeyPrefix`, `createIdempotencyKey`.

The flow reuses the idempotency key when `send` is called again with the same
input after an ambiguous failure (`TIMEOUT`, `NETWORK_ERROR`, 5xx, 429,
`ABORTED`) and drops it after a success or a definitive error. Server
`retryAfterMs` (429/503) on `send` starts a cooldown like `resendCooldownMs`,
on `verify` a separate verify cooldown (`canVerify` is `false`); the countdowns tick
about once a second while the store has subscribers. Actions that cannot run
resolve with `{ skipped: "cooldown" | "busy" | "no-issue" | "no-previous-send" | "terminal" }`.

### `setOtpContext(storesOrClientOrOptions)` / `getOtpContext()`

Call `setOtpContext` during component initialization (e.g. the root layout)
to share one set of stores with descendants. Stores it creates (from a client
or options) are aborted when that component is destroyed; stores you pass in
keep the lifetime you manage. `getOtpContext` returns them (and throws a
`TypeError` when none were set).

### `use:otpForm={(data, form) => ...}`

Prevents the native submit, passes the form's `FormData` to your handler,
ignores re-submits while the handler's promise is pending and sets
`aria-busy="true"` on the form meanwhile.

## Runtime notes

- **SSR (SvelteKit):** creating stores performs no I/O and nothing is shared
  between calls. Do not create stores in a module-level singleton that runs
  on the server (it would be shared between requests); create them in a
  component or with `setOtpContext`. Never use an `sk_` key in universal
  code, call [`@k-otp/sdk-server`](../sdk-server) from `+server.ts` /
  `+page.server.ts` instead.
- **Teardown:** stores created in a component are not tied to its lifecycle;
  call `stores.abort()` / `flow.abort()` in `onDestroy` (or use
  `setOtpContext`, which does it for you).
- **Origins:** `pk_` keys only work from origins listed exactly (scheme, host,
  port) in the key's `allowedOrigins`; otherwise the API answers
  `403 FORBIDDEN`.

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
