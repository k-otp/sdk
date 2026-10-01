# `@k-otp/sdk/vue` reference

Vue 3 plugin and composables for the [K-OTP](https://api.k-otp.dev) Korean OTP
API, in the `vue` subpath of [`@k-otp/sdk`](../../packages/sdk/README.md).

- `createOtpPlugin` (`app.use`), `provideOtpClient`, `useOtpClient`
- `useOtp()`: `issue` / `verify` as refs (`loading`, `error`, `result`) plus
  `reset`
- `useOtpFlow()`: the common issue -> verify flow with resend cooldown and
  idempotency key handling
- SSR-safe (per-app `provide`/`inject`, no globals, no `window` access at
  import); requests are aborted when the component unmounts
- Built on the public [`@k-otp/sdk/headless`](../../packages/sdk/README.md#headless-flow-k-otpsdkheadless) flow; same semantics and normalized `OtpApiError` as the React and Svelte adapters

## Install

```bash
npm install @k-otp/sdk vue
```

`vue` (`>= 3.3`) is an optional peer dependency of `@k-otp/sdk`: install it
yourself (your app already has it). `@k-otp/sdk/vue` only loads Vue, never
the other frameworks or the server client. The common core exports
(`createOtpClient`, `createIdempotencyKey`, `isOtpApiError`, `OtpApiError`,
types) are re-exported here and are the same objects as in `@k-otp/sdk`
(within one module format).

## Quick start

```ts
// main.ts
import { createApp } from "vue";
import { createOtpPlugin } from "@k-otp/sdk/vue";
import App from "./App.vue";

createApp(App)
  // pk_ public key: its allowedOrigins must list this page's exact origin.
  .use(createOtpPlugin({ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY }))
  .mount("#app");
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useOtpFlow } from "@k-otp/sdk/vue";

const phone = ref("");
const code = ref("");
const { send, verify, canSend, canVerify, cooldownRemainingMs, verified, reasonCode, error } =
  useOtpFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "signup" });
</script>

<template>
  <p v-if="verified">Verified</p>
  <form v-else @submit.prevent="verify(code)">
    <input v-model="phone" />
    <button type="button" :disabled="!canSend" @click="send({ phoneNumber: phone, purpose: 'signup' })">
      {{ cooldownRemainingMs > 0 ? `Resend in ${Math.ceil(cooldownRemainingMs / 1000)}s` : "Send code" }}
    </button>
    <input v-model="code" />
    <button :disabled="!canVerify">Verify</button>
    <p v-if="reasonCode">Code rejected: {{ reasonCode }}</p>
    <p v-if="error" role="alert">{{ error.code }}: {{ error.message }}</p>
  </form>
</template>
```

See [`examples/vue-vite`](../../examples/vue-vite) for a runnable app and the
[issue -> verify UX guide](../issue-verify-ux.md).

## API

### `createOtpPlugin(clientOrOptions)`

Returns a plugin that provides the client to the app (`app.provide`). Accepts
a client from `createOtpClient` or its options. Creating it performs no I/O.
For SSR, create the plugin inside your per-request `createSSRApp` factory.

### `provideOtpClient(clientOrOptions)` / `useOtpClient(client?)`

`provideOtpClient` provides a client to the current component's descendants
(call it in `setup`). `useOtpClient` returns `client` or the injected one and
throws a `TypeError` when there is none. `OTP_CLIENT_KEY` is the injection
key.

### `useOtp(options?)`

```ts
const { issue, verify, loading, error, reset } = useOtp();
const { data, error: issueError } = await issue.run({ phoneNumber, purpose, idempotencyKey });
```

| Member | Type | |
| --- | --- | --- |
| `issue`, `verify` | `UseOtpOperation` | One per operation, see below. |
| `loading` | `ComputedRef<boolean>` | Either operation in flight. |
| `error` | `ComputedRef<OtpApiError \| undefined>` | `verify.error`, else `issue.error`. |
| `reset()` | | Resets both operations. |
| `client` | | The client in use. |

`UseOtpOperation`:

| Member | |
| --- | --- |
| `run(input, { signal?, timeoutMs? })` | Resolves `{ data }` or `{ error }`; it does **not** reject for API errors. Configuration mistakes still throw `TypeError`. |
| `loading`, `status` | `ComputedRef<boolean>`, `ComputedRef<"idle" \| "loading" \| "success" \| "error">` |
| `result` | `ComputedRef` of the latest successful result (cleared when a new call starts). |
| `error` | `ComputedRef<OtpApiError \| undefined>` of the latest failed call. |
| `reset()` | Aborts an in-flight call and returns to `idle`. |

Templates only unwrap top-level refs, so destructure what you bind:
`const { loading: sending, error: sendError } = issue`.

- **Stale-response protection:** a newer `run` supersedes older ones; only the
  latest call updates the refs (each caller still receives its own outcome).
- **Abort on unmount:** when `useOtp` runs inside a component (or any effect
  scope), in-flight requests are aborted when the scope is disposed.
- `issue.run` does not create idempotency keys: pass one per logical send and
  reuse it on retries (or use `useOtpFlow`).

### `useOtpFlow(options?)`

Options: `resendCooldownMs` (default `30000`; `0` disables it), `idempotencyKeyPrefix`,
`createIdempotencyKey`, `client`. Returns computed refs `issueId`,
`expiresAt`, `attemptsRemaining`, `verified`, `reasonCode`, `loading`,
`sending`, `verifying`, `error`, `idempotencyKey`, `cooldownRemainingMs`,
`verifyCooldownRemainingMs`, `canSend`, `canVerify`, the full snapshot as `state`, and the actions
`send(input)`, `resend()`, `verify(code)`, `reset()`.

The flow reuses the idempotency key when `send` is called again with the same
input after an ambiguous failure (`TIMEOUT`, `NETWORK_ERROR`, 5xx, 429,
`ABORTED`) and drops it after a success or a definitive error. Server
`retryAfterMs` (429/503) on `send` starts a cooldown like `resendCooldownMs`;
on `verify` it starts a separate verify cooldown
(`verifyCooldownRemainingMs`, `canVerify` is `false`). Actions that cannot
run resolve with `{ skipped: "cooldown" | "busy" | "no-issue" |
"no-previous-send" | "terminal" }`. See the
[issue -> verify UX guide](../issue-verify-ux.md).

## Runtime notes

- **SSR (Nuxt, Vite SSR):** composables perform no request during server
  rendering and render the idle state. Provide the client per app instance
  (plugin in the app factory); never use an `sk_` key in a universal app, call
  [`@k-otp/sdk/server`](./server.md) from server routes instead.
- **Origins:** `pk_` keys only work from origins listed exactly (scheme, host,
  port) in the key's `allowedOrigins`; otherwise the API answers
  `403 FORBIDDEN`.
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

`@k-otp/sdk/vue` is versioned with the rest of `@k-otp/sdk` (one package, one
version, SemVer from 1.0.0). Changes are listed in the
[changelog](../../packages/sdk/CHANGELOG.md).

## License

MIT
