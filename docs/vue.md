# Vue guide

[`@k-otp/sdk-vue`](../packages/sdk-vue) wraps `@k-otp/sdk-core` in a plugin
and composables. API reference: the
[package README](../packages/sdk-vue/README.md). Runnable app:
[`examples/vue-vite`](../examples/vue-vite).

## Setup

```bash
npm install @k-otp/sdk-vue   # vue >= 3.3 is a peer dependency
```

```ts
import { createOtpPlugin } from "@k-otp/sdk-vue";

app.use(createOtpPlugin({ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY }));
```

Use a **`pk_` public key** whose `allowedOrigins` contains every origin the
app runs on, exactly (`http://localhost:5173`, `https://www.example.com`, ...).
To scope a client to part of the tree, call `provideOtpClient(options)` in a
parent component's `setup`.

## Choosing a composable

| Need | Composable |
| --- | --- |
| The common "send code / enter code" screen | `useOtpFlow({ resendCooldownMs })` |
| Full control over keys and retries | `useOtp()` (`issue`, `verify`, `loading`, `error`, `reset`) |
| The raw client | `useOtpClient()` |

```vue
<script setup lang="ts">
import { useOtpFlow } from "@k-otp/sdk-vue";

const { send, verify, canSend, canVerify, cooldownRemainingMs, verified, reasonCode, error } =
  useOtpFlow({ resendCooldownMs: 30_000 });
</script>
```

Templates only unwrap **top-level** refs. Destructure what you bind
(`const { loading: sending } = useOtp().issue`) instead of writing
`otp.issue.loading` in a template attribute.

`run` / `send` / `verify` resolve `{ data }` or `{ error }` and never reject
for API errors, so `@click="send(...)"` is safe.

## Behavior you can rely on

- **Stale responses** of superseded `run` calls never overwrite newer refs.
- **Unmount aborts** in-flight requests: composables called in `setup` (or
  any `effectScope`) abort on scope disposal.
- Refs are `computed` over one `shallowRef` snapshot, so the adapter adds no
  deep reactivity to API results.

## Nuxt and Vite SSR

- Create the plugin inside the per-request app factory (a Nuxt plugin, or
  your `createSSRApp` function). The client is provided per app, so nothing
  leaks between requests. Server rendering performs no request and renders
  the idle state.
- Browser-direct flow: expose only the `pk_` key (`NUXT_PUBLIC_*` /
  `VITE_*`).
- Server-driven flow: call [`@k-otp/sdk-server`](../packages/sdk-server) with
  `sk_` from server routes (`server/api/*.ts` in Nuxt) and call those from
  the UI. Never put an `sk_` key in runtime public config.

## Testing

```ts
const app = createApp({});
app.use(createOtpPlugin(createOtpClient({ apiKey: "pk_test", fetch: myMockFetch })));
const otp = app.runWithContext(() => effectScope().run(() => useOtp()));
```

See [issue -> verify UX](./issue-verify-ux.md) and
[errors and retries](./errors-and-retries.md).
