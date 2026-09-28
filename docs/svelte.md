# Svelte guide

[`@k-otp/sdk-svelte`](../packages/sdk-svelte) wraps `@k-otp/sdk-core` in
Svelte stores. It only uses `svelte/store` (and `svelte` for context), so it
works in Svelte 4 and Svelte 5 (runes components read stores with `$store`
as usual). API reference: the
[package README](../packages/sdk-svelte/README.md). Runnable app:
[`examples/svelte-vite`](../examples/svelte-vite).

## Setup

```bash
npm install @k-otp/sdk-svelte   # svelte >= 4 is a peer dependency
```

```svelte
<script lang="ts">
  import { createOtpStores } from "@k-otp/sdk-svelte";

  const otp = createOtpStores({ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY });
  const flow = otp.createFlow({ resendCooldownMs: 30_000 });
</script>

<button disabled={!$flow.canSend} onclick={() => flow.send({ phoneNumber, purpose: "login" })}>
  Send code
</button>
```

Use a **`pk_` public key** whose `allowedOrigins` contains every origin the
app runs on, exactly (`http://localhost:5173`, `https://www.example.com`, ...).

## Choosing a store

| Need | Store |
| --- | --- |
| The common "send code / enter code" screen | `otp.createFlow(options)` / `createOtpFlowStore(client, options)` |
| Full control over keys and retries | `otp.issue`, `otp.verify` (`run`, `reset`) with `otp.loading`, `otp.error` |
| Share one set of stores with a subtree | `setOtpContext(...)` + `getOtpContext()` |

`run` / `send` / `verify` resolve `{ data }` or `{ error }` and never reject
for API errors.

### Forms

`use:otpForm` wires a form without extra state: it prevents the native
submit, hands your function the `FormData`, ignores double submits while the
call is pending and sets `aria-busy`.

```svelte
<form use:otpForm={(data) => flow.verify(String(data.get("code")))}>
  <input name="code" autocomplete="one-time-code" inputmode="numeric" />
  <button disabled={!$flow.canVerify}>Verify</button>
</form>
```

## Lifecycle

Stores are plain objects, not tied to a component. When a component that
created stores is destroyed, abort in-flight requests:

```ts
onDestroy(() => {
  otp.abort();
  flow.abort();
});
```

`setOtpContext` registers that cleanup for you. The flow's countdown timer
only runs while the store has subscribers.

## SvelteKit and SSR

- Creating stores performs no I/O and nothing is shared between calls, so
  it is SSR-safe **as long as you do not create them in a module-level
  singleton** that the server would share between requests. Create them in a
  component, or call `setOtpContext(...)` in the root `+layout.svelte` and
  `getOtpContext()` below it.
- Browser-direct flow: expose only the `pk_` key (`PUBLIC_*` env).
- Server-driven flow: call [`@k-otp/sdk-server`](../packages/sdk-server) with
  `sk_` from `+server.ts` endpoints or form actions in `+page.server.ts`
  (`$env/static/private`), and never import it from universal code.

## Testing

Stores can be tested without a DOM:

```ts
const otp = createOtpStores(createOtpClient({ apiKey: "pk_test", fetch: myMockFetch }));
await otp.issue.run(input);
expect(get(otp.issue).status).toBe("success");
```

See [issue -> verify UX](./issue-verify-ux.md) and
[errors and retries](./errors-and-retries.md).
