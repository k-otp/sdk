# `@k-otp/sdk/server` reference

Server-side client for the [K-OTP](https://api.k-otp.dev) Korean OTP API, in
the `server` subpath of [`@k-otp/sdk`](../../packages/sdk/README.md). Works in
Node.js (>= 20.19), Bun, Deno and edge runtimes (Cloudflare Workers, Vercel
Edge) with an **`sk_` secret key**.

Covers every public `/v1` operation: issue, verify, status, issue history,
credit ledger, balance and templates. It shares the error model and transport
of the core client (`@k-otp/sdk`) and re-exports its common helpers.

## Install

```bash
npm install @k-otp/sdk
```

No framework is needed: React, Vue and Svelte are optional peer dependencies
of `@k-otp/sdk` and are never loaded by `@k-otp/sdk/server`.

### Server only: the `browser` export condition

`@k-otp/sdk/server` must never end up in a browser bundle (it needs an `sk_`
key). Bundlers that build for browsers (Vite, webpack, esbuild, Rollup,
Metro, ...) resolve it with the `browser` export condition, which maps to a
stub with the same exports: the constants are the plain public values, and
every function (including the `OtpApiError` constructor) throws an error
explaining that `@k-otp/sdk/server` was resolved for a browser. The bundle
still builds, but the server client is not in it, and the first call fails
loudly. (The stub has no load-time side effects, so the package can stay
`sideEffects: false` and the failure never depends on what a bundler drops.)

Server runtimes whose bundlers also set `browser` resolve the real client
because their own condition is matched first: `workerd` / `worker`
(Cloudflare Workers: wrangler, `@cloudflare/vite-plugin`), `edge-light`
(Vercel / Next.js Edge) and `deno`. Node.js, Bun, Deno and the default Node
SSR builds (Next.js server, Vite SSR, SvelteKit, Nuxt) do not set `browser`
and are unaffected.

If server code throws the "resolved with the `browser` export condition"
error, the build used browser conditions:

- **Vite SSR with `ssr.target: "webworker"`** (for example a Worker built
  with Vite but without the Cloudflare plugin) uses Vite's client
  conditions (`module`, `browser`, ...). Add a server condition:

  ```ts
  // vite.config.ts
  export default defineConfig({
    ssr: {
      target: "webworker",
      resolve: { conditions: ["workerd", "worker", "module", "browser"] },
    },
  });
  ```

  or build Workers with `@cloudflare/vite-plugin`, which sets `workerd` /
  `worker` itself.
- **Tests of server code in a DOM environment** (Jest or Vitest with
  jsdom/happy-dom) may resolve `browser` too: run them in a `node`
  environment, or set the export conditions (Jest:
  `testEnvironmentOptions: { customExportConditions: ["node"] }`; Vitest:
  `resolve.conditions: ["node"]`), and pass `dangerouslyAllowBrowser: true`
  if `window` and `document` exist.

## Quick start

```ts
import { createIdempotencyKey, createOtpServerClient, isOtpApiError } from "@k-otp/sdk/server";

const otp = createOtpServerClient({ apiKey: process.env.K_OTP_SECRET_KEY! });

// Persist this key with the pending sign-up and reuse it on retries.
const idempotencyKey = createIdempotencyKey("signup");

try {
  const { issueId } = await otp.issue({
    phoneNumber: "01012345678",
    purpose: "signup",
    templateId: "otp_signup_kr",
    idempotencyKey,
  });
  const status = await otp.getStatus({ issueId });
  console.log(status.overallStatus); // in_progress | delivered | delivery_failed | ...
} catch (error) {
  if (isOtpApiError(error) && error.code === "PAYMENT_REQUIRED") {
    // error.data.code: INSUFFICIENT_CREDIT | OVERDRAFT_LIMIT_EXCEEDED
  }
  throw error;
}
```

Cloudflare Workers:

```ts
export default {
  async fetch(request: Request, env: { K_OTP_SECRET_KEY: string }) {
    const otp = createOtpServerClient({ apiKey: env.K_OTP_SECRET_KEY });
    return Response.json(await otp.getBalance());
  },
};
```

## API

`createOtpServerClient(options)` accepts the same options as
`createOtpClient` (`@k-otp/sdk`) plus `dangerouslyAllowBrowser`:

| Option | Default | |
| --- | --- | --- |
| `apiKey` | required | `sk_...` secret key, or a (possibly async) function resolved before every request. |
| `baseUrl` | `https://api.k-otp.dev/v1` | Must include `/v1`. |
| `timeoutMs` | `10000` (10 s) | Per request; `0` disables. Override per call with `{ timeoutMs }`. |
| `fetch` | `globalThis.fetch` | Custom fetch (tests, proxies, instrumentation). |
| `headers` | | Extra headers; `authorization` cannot be overridden. |
| `hooks` | | Telemetry hooks, see [`@k-otp/sdk`](../../packages/sdk/README.md#telemetry). |
| `dangerouslyAllowBrowser` | `false` | See below. |

- The key must start with `sk_`. Anything else (a `pk_` public key, a key
  without a prefix, a `Bearer ...` string) is refused with a `TypeError`, at
  construction for string keys and before the request (no I/O) for lazily
  resolved keys. Surrounding whitespace is trimmed.
- Constructing the client where `window` and `document` exist throws, because
  an `sk_` key must never reach a browser. `dangerouslyAllowBrowser: true` is
  meant for jsdom-style tests only.

| Method | HTTP | Notes |
| --- | --- | --- |
| `issue(input)` | `POST /v1/issue` | `idempotencyKey` required (validated before the request). |
| `verify(input)` | `POST /v1/verify` | Wrong codes resolve with `verified: false` + `reasonCode`. |
| `getStatus({ issueId })` | `GET /v1/status` | `overallStatus`, delivery + verification state. Recently issued ids may report `pending_lookup` for up to 60 s. |
| `listIssues(query?)` | `GET /v1/issues` | One page (`items`, `nextCursor?`). Filters: `limit` (1-100), `cursor`, `verificationStatus`, `createdFrom`, `createdTo`. |
| `iterateIssues(query?, options?)` | `GET /v1/issues` | `AsyncGenerator` over all items, following `nextCursor`. |
| `getIssue({ issueId })` | `GET /v1/issues/{issueId}` | Billing status and attempt counters. |
| `listCreditLedger(query?)` | `GET /v1/credit-ledger` | One page of the wallet ledger. Filters: `limit`, `cursor`, `entryType`, `createdFrom`, `createdTo`. See [Credit wallet](#credit-wallet-organization-wide). |
| `iterateCreditLedger(query?, options?)` | `GET /v1/credit-ledger` | `AsyncGenerator` over all entries. |
| `getBalance()` | `GET /v1/balance` | Credit balance (`currency: "CREDIT"`) plus `walletId`, `walletScope`, `organizationId?`. See [Credit wallet](#credit-wallet-organization-wide). |
| `listTemplates()` | `GET /v1/templates` | Whitelisted templates + `defaultTemplateId`. |
| `getTemplate({ templateId })` | `GET /v1/templates/{templateId}` | Includes the `variables` schema for `templateVariables`. |

Every method takes an optional last argument `{ signal?, timeoutMs? }`; the
iterators additionally accept `maxPages`.

### Pagination

```ts
for await (const issue of otp.iterateIssues({ verificationStatus: "verified", limit: 100 })) {
  console.log(issue.issueId, issue.billingStatus);
}

// Or page by page with the generic helpers:
import { paginatePages } from "@k-otp/sdk/server";
for await (const page of paginatePages((q) => otp.listCreditLedger(q), { entryType: "debit" })) {
  console.log(page.items.length);
}
```

Cursors are opaque and bound to the endpoint that issued them; keep the same
filters while paging (the helpers do this for you). Breaking out of a
`for await` loop stops fetching.

### Credit wallet (organization-wide)

From API 1.4.0 credit is held per **organization**, not per app: every app of
an organization spends from, and is topped up into, one shared wallet.

```ts
const wallet = await otp.getBalance();
wallet.balance;        // credits left in the wallet shared by all apps
wallet.currency;       // "CREDIT"
wallet.appId;          // the app of the key you called with (not the wallet owner)
wallet.walletScope;    // "organization" (shared) | "app" (legacy per-app wallet)
wallet.walletId;       // "org:<organizationId>" | "app:<appId>"
wallet.organizationId; // set when walletScope is "organization"
```

- `balance` is the **whole organization's** balance, so it can drop between two
  calls because of another app's issues.
- `listCreditLedger` / `iterateCreditLedger` return the wallet's `credit` and
  `clawback` entries plus only **the calling app's** `debit` and `refund`
  entries. Other apps' debits are not listed, so `balanceAfter` (always the
  wallet balance) can change by more than `amountDelta` between two entries.
- A ledger entry's optional `appId` is its attribution: always the calling app
  for `debit` / `refund`, and on a `credit` / `clawback` only when the purchase
  was attributed to an app.
- `walletId` and `walletScope` are typed optional (`GetBalanceResult`). An API
  deployment older than 1.4.0 does not send them (its balance is the app's own
  wallet), and `appId` on ledger entries is absent there too. Treat a missing
  `walletScope` as `"app"`.
- `PAYMENT_REQUIRED` (402) on `issue` now means the organization wallet is out
  of credit. No new error codes were added.

### Errors

Rejections are `OtpApiError` with the same codes, `status`, `requestId`,
`data` and `retryAfterMs` as the core client. `issue` and `verify` are rate-limited
per API key: an exceeded limit rejects with `TOO_MANY_REQUESTS` (429,
retryable), `retryAfterMs` and `data: { limit, policy, retryAfterMs }`
(`OtpRateLimitedData`). See
[errors and retries](../errors-and-retries.md).

## Runtime notes

- **Node.js >= 20.19** is required. The SDK talks to the API through oRPC,
  whose packages are ESM-only; the CommonJS build (`require("@k-otp/sdk/server")`)
  therefore relies on `require()` of ES modules, which is enabled by default
  from Node.js 20.19 (and 22.12). ESM consumers (`import`) work on any
  supported Node.js version, Bun, Deno and edge runtimes.
- The default timeout is **10 seconds** per request (`DEFAULT_TIMEOUT_MS`).
  A timeout rejects with `TIMEOUT`; for `issue` that outcome is ambiguous, so
  retry with the same idempotency key.

## Not included

Internal billing (credit/debit), quota maintenance and provider reconciliation
endpoints are private to the K-OTP platform and are intentionally not part of
this SDK.

## License

MIT
