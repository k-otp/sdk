# Security

## Never ship `sk_` keys to clients

`sk_` secret keys can read issue history and issue OTPs to any number. Since
API 1.4.0 they also read the organization-wide credit balance (shared by all of
the organization's apps) and its credit ledger (top-ups and clawbacks, plus
this app's debits), so a leaked key exposes organization-level balance
information, not just one app's. Keep them in server-side secrets (environment
variables, Workers secrets, a secret manager).

- Never put an `sk_` key in browser code, mobile apps, public repositories,
  `NEXT_PUBLIC_*` / `VITE_*` / `PUBLIC_*` variables or client-side config.
- `@k-otp/sdk` throws if it is given an `sk_` key in a browser, and
  `@k-otp/sdk/server` refuses to run in a browser at all: browser bundlers
  resolve it (via the `browser` export condition) to a stub whose functions
  throw when called, and the real client throws when `window` and `document`
  exist.
  These guards catch mistakes; they are not a substitute for keeping keys
  out of client bundles.
- Rotate a key immediately if it was ever exposed.

## `pk_` public keys and the Origin allowlist

`pk_` keys are designed to be public, with strict limits:

- They can only call `POST /v1/issue` and `POST /v1/verify`.
- Every request must carry an `Origin` header that **exactly** matches one of
  the key's `allowedOrigins`: scheme, host and port (`https://example.com` does
  not match `https://www.example.com` or `http://example.com`). There are no
  wildcards; list each deployment origin (and `http://localhost:<port>` for
  local development, preferably on a separate key).
- A request without a matching `Origin` is rejected with `403 FORBIDDEN`. That
  is also why a `pk_` key does not work from a server or `curl` unless it
  sends a matching `Origin`.
- **In browsers, an unlisted origin looks like a network error.** For an
  `Origin` outside the allowlist the API does not send CORS headers, so the
  browser blocks the response and the SDK reports `NETWORK_ERROR` (no status,
  no `requestId`) instead of `403`. See the troubleshooting entry below.
- For allowed origins the API exposes `X-Request-Id` and `Retry-After` via
  `Access-Control-Expose-Headers`, so `error.requestId` and
  `error.retryAfterMs` are available in browsers too.
- `@k-otp/sdk/server` only accepts keys that start with `sk_` (it refuses
  `pk_` keys and anything unprefixed); use `sk_` on servers.

### Troubleshooting: `NETWORK_ERROR` in the browser, but it works with curl

For a `pk_` key called from a browser `Origin` that is **not** in the key's
`allowedOrigins`, the API answers without CORS headers. The browser then
blocks the response and reports a generic network/CORS failure, so the SDK
can only surface `NETWORK_ERROR` with `status: 0` and no `requestId` (in
browsers the message also carries a hint about the allowlist). The same key
works from curl or a server because those do not enforce CORS.

Check the key's allowed origins: they must match the page origin exactly,
scheme + host + port (`http://localhost:5173` is not `http://127.0.0.1:5173`
or `http://localhost:3000`; `https://example.com` is not
`https://www.example.com`), without a path or trailing slash. The browser
devtools console shows the blocked CORS request.

Because a `pk_` key is visible to anyone, anyone can use it from a page on an
allowed origin. Protect browser-direct flows with your own abuse controls
(CAPTCHA, per-user rate limits) or prefer the server-driven flow where your
backend decides who may receive a code.

## Trusting verification results

A browser-direct `verify` only proves to the browser that the code matched. If
your backend grants access based on it, confirm server-side: call `verify`
from your backend, or check `getStatus({ issueId })` with an `sk_` key
(`verificationStatus: "verified"`), and bind the `issueId` to the user session
that requested it.

## CDN usage

Pin exact versions and use Subresource Integrity:

```html
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk@1.0.1/dist/k-otp.iife.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
```

Compute the hash with
`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A` or copy it
from jsDelivr. Unpinned (`@latest`) URLs cannot be used with SRI.

## Personal data

The API stores phone numbers only as hashes and never returns them. Avoid
putting personal data in `purpose`, `metadata` or idempotency keys.

## Reporting vulnerabilities

Please report security issues privately via GitHub Security Advisories on
`k-otp/sdk` ("Report a vulnerability") instead of opening a public issue.
