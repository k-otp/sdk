# React guide

[`@k-otp/sdk/react`](./reference/react.md) wraps the `@k-otp/sdk` core client in hooks.
API reference: [`@k-otp/sdk/react` reference](./reference/react.md).
Runnable app: [`examples/react-vite`](../examples/react-vite).

> Prefer ready-made components? `@k-otp/sdk/ui/react` renders the whole form
> (phone, send/resend, code input, verify, messages) on top of these
> hooks: see [UI components](./ui.md).

## Setup

```bash
npm install @k-otp/sdk react   # react (>= 18) is an optional peer dependency
```

```tsx
import { OtpProvider } from "@k-otp/sdk/react";

<OtpProvider options={{ apiKey: import.meta.env.VITE_K_OTP_PUBLIC_KEY }}>
  <App />
</OtpProvider>;
```

Use a **`pk_` public key** whose `allowedOrigins` contains every origin the
app runs on, exactly (`http://localhost:5173`, `https://www.example.com`, ...).

## Choosing a hook

| Need | Hook |
| --- | --- |
| The common "send code / enter code" screen | `useOtpFlow({ resendCooldownMs })` |
| Full control over keys and retries | `useOtpIssue()` + `useOtpVerify()` |
| The raw client (e.g. inside an event handler) | `useOtpClient()` |

```tsx
const otp = useOtpFlow({ resendCooldownMs: 30_000, idempotencyKeyPrefix: "login" });
// otp.send({ phoneNumber, purpose: "login" }), otp.verify(code), otp.resend(), otp.reset()
// otp.canSend, otp.cooldownRemainingMs, otp.canVerify, otp.verified, otp.reasonCode, otp.error
```

With the lower-level hooks you manage the idempotency key yourself:

```tsx
const issue = useOtpIssue();
const [key, setKey] = useState(() => createIdempotencyKey("login"));

const send = async () => {
  const { data, error } = await issue.run({ phoneNumber, purpose: "login", idempotencyKey: key });
  // Keep the key after ambiguous failures (retryable codes, ABORTED); otherwise the next send is a new attempt.
  if (data || (error && !error.retryable && error.code !== "ABORTED")) setKey(createIdempotencyKey("login"));
};
```

`run` resolves `{ data }` or `{ error }` and never rejects for API errors, so
`onClick={() => void issue.run(...)}` is safe. Every hook result is also
available as state (`data`, `error`, `isLoading`, `status`).

## Behavior you can rely on

- **Stale responses** of superseded `run` calls never overwrite newer state.
- **Unmount aborts** in-flight requests (the pending promise resolves with an
  `ABORTED` error).
- **No Suspense** requirement; nothing suspends. For async boundaries, await
  `run` in your own transition (`startTransition(async () => { await run(...) })`
  in React 19).
- **StrictMode**: development double-mounting is harmless; a flow re-sent
  after an aborted attempt reuses the same idempotency key.

## Next.js (App Router) and other SSR frameworks

- The package is marked `"use client"`. Put `OtpProvider` in a client
  component (e.g. `app/providers.tsx`) and use the hooks in client
  components. Server rendering performs no request and renders the idle
  state.
- Browser-direct flow: expose only the `pk_` key (`NEXT_PUBLIC_K_OTP_PUBLIC_KEY`).
- Server-driven flow (recommended when the backend must trust the result):
  call [`@k-otp/sdk/server`](./reference/server.md) with `sk_` from route
  handlers / server actions, and call those from the UI. Never import
  `@k-otp/sdk/server` or an `sk_` key into client components (a client
  bundle resolves `@k-otp/sdk/server` to a stub whose functions throw).

## Testing

Pass a client with a custom `fetch` to the provider (or `client` to a hook):

```tsx
const client = createOtpClient({ apiKey: "pk_test", fetch: myMockFetch });
render(<OtpProvider client={client}><Screen /></OtpProvider>);
```

See [issue -> verify UX](./issue-verify-ux.md) for the rules behind the flow
and [errors and retries](./errors-and-retries.md) for the error model.
