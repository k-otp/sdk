# Security

## Never ship `sk_` keys to clients

`sk_` secret keys can read issue history, balances and ledgers for your whole
app and issue OTPs to any number. Keep them in server-side secrets (environment
variables, Workers secrets, a secret manager).

- Never put an `sk_` key in browser code, mobile apps, public repositories,
  `NEXT_PUBLIC_*` / `VITE_*` / `PUBLIC_*` variables or client-side config.
- `@k-otp/sdk-core` throws if it is given an `sk_` key in a browser, and
  `@k-otp/sdk-server` refuses to run in a browser at all. These guards catch
  mistakes; they are not a substitute for keeping keys out of client bundles.
- Rotate a key immediately if it was ever exposed.

## `pk_` public keys and the Origin allowlist

`pk_` keys are designed to be public, with strict limits:

- They can only call `POST /v1/issue` and `POST /v1/verify`.
- Every request must carry an `Origin` header that **exactly** matches one of
  the key's `allowedOrigins`: scheme, host and port (`https://example.com` does
  not match `https://www.example.com` or `http://example.com`). There are no
  wildcards; list each deployment origin (and `http://localhost:<port>` for
  local development, preferably on a separate key).
- A missing or unlisted `Origin` is rejected with `403 FORBIDDEN`. That is also
  why a `pk_` key does not work from a server or `curl` unless it sends a
  matching `Origin`.
- `@k-otp/sdk-server` only accepts keys that start with `sk_` (it refuses
  `pk_` keys and anything unprefixed); use `sk_` on servers.

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
<script src="https://cdn.jsdelivr.net/npm/@k-otp/sdk-core@0.1.0/dist/k-otp.iife.min.js"
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
