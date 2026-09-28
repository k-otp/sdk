# @k-otp/sdk-vue

Vue 3 plugin and composables for the [K-OTP](https://api.k-otp.dev) Korean OTP
API, built on [`@k-otp/sdk-core`](../sdk-core).

- `createOtpPlugin` (`app.use`), `provideOtpClient`, `useOtpClient`
- `useOtp()`: `issue` / `verify` as refs (`loading`, `error`, `result`) plus
  `reset`
- `useOtpFlow()`: the common issue -> verify flow with resend cooldown and
  idempotency key handling
- SSR-safe (per-app `provide`/`inject`, no globals, no `window` access at
  import); requests are aborted when the component unmounts
- Same semantics and normalized `OtpApiError` as the React and Svelte adapters

## Install

```bash
npm install @k-otp/sdk-vue
```

`vue >= 3.3` is a peer dependency. `@k-otp/sdk-core` is installed
automatically (pinned to the same version) and its common exports
(`createOtpClient`, `createIdempotencyKey`, `isOtpApiError`, `OtpApiError`,
types) are re-exported here.

## Quick start

```ts
// main.ts
import { createApp } from "vue";
import { createOtpPlugin } from "@k-otp/sdk-vue";
import App from "./App.vue";

createApp(App)
  // pk_ public key: its allowedOrigins must list this page's exact origin.
  .use(createOtpPlugin({ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY }))
  .mount("#app");
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useOtpFlow } from "@k-otp/sdk-vue";

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
[issue -> verify UX guide](../../docs/issue-verify-ux.md).

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

Options: `resendCooldownMs` (default `0`), `idempotencyKeyPrefix`,
`createIdempotencyKey`, `client`. Returns computed refs `issueId`,
`expiresAt`, `attemptsRemaining`, `verified`, `reasonCode`, `loading`,
`sending`, `verifying`, `error`, `idempotencyKey`, `cooldownRemainingMs`,
`canSend`, `canVerify`, the full snapshot as `state`, and the actions
`send(input)`, `resend()`, `verify(code)`, `reset()`.

The flow reuses the idempotency key when `send` is called again with the same
input after an ambiguous failure (`TIMEOUT`, `NETWORK_ERROR`, 5xx, 429,
`ABORTED`) and drops it after a success or a definitive error. Server
`retryAfterMs` starts a cooldown like `resendCooldownMs`. Actions that cannot
run resolve with `{ skipped: "cooldown" | "busy" | "no-issue" |
"no-previous-send" }`. See the
[issue -> verify UX guide](../../docs/issue-verify-ux.md).

## Runtime notes

- **SSR (Nuxt, Vite SSR):** composables perform no request during server
  rendering and render the idle state. Provide the client per app instance
  (plugin in the app factory); never use an `sk_` key in a universal app, call
  [`@k-otp/sdk-server`](../sdk-server) from server routes instead.
- **Origins:** `pk_` keys only work from origins listed exactly (scheme, host,
  port) in the key's `allowedOrigins`; otherwise the API answers
  `403 FORBIDDEN`.
- **CommonJS** consumers need Node.js >= 20.19 (see sdk-core).

## Versioning and migration

All `@k-otp/sdk-*` packages are released in lockstep; this package depends on
the exact same `@k-otp/sdk-core` version. While `0.x`, breaking changes bump
the minor version and are listed in the [changelog](./CHANGELOG.md).

## License

MIT
