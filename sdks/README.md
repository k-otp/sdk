# K-OTP server SDKs

Choose your language to install the K-OTP server client. All clients require an
`sk_` secret key and support the nine public API operations: issue, verify,
status, issue lists/detail, credit ledger, balance and templates/list detail.
Keep secret keys on your server, and phone numbers and verification codes as strings.

| Language | Package | Guide | Tested runtime |
| --- | --- | --- | --- |
| C# | `KOtp.Sdk` | [.NET](dotnet/README.md) | .NET 8 |
| Java | `dev.kotp:kotp-sdk` | [Java](java/README.md) | JDK 21 |
| Kotlin/JVM | same Java JAR | [Kotlin/JVM](kotlin/README.md) | Kotlin 2.1.20 / JDK 21 |
| PHP | `k-otp/sdk` | [PHP](php/README.md) | PHP 8.4 |
| Go | `github.com/k-otp/sdk/sdks/go` | [Go](go/README.md) | Go 1.26 |
| Python | `kotp-sdk` | [Python](python/README.md) | Python 3.13 |
| Ruby | `kotp_sdk` | [Ruby](ruby/README.md) | Ruby 3.3 |
| Dart | `kotp_sdk` | [Dart](dart/README.md) | Dart 3.9, server IO |
| TypeScript | `@k-otp/sdk/kiota` | [TypeScript](typescript/README.md) | Node 20.19 / 22 / 24 |

Native SDKs have independent versions from npm (`0.2.0` follows the K-OTP API 2.0
release, see below). TypeScript shares the version of `@k-otp/sdk`. Download
native packages from
[GitHub Releases](https://github.com/k-otp/sdk/releases/tag/server-sdk-v0.2.0);
package manager registries other than npm are being set up. Verify downloaded
files against the attached `SHA256SUMS`. Go is installed directly from its version tag.

Responses are native JSON values. Issue requires a trimmed, nonempty ASCII
`idempotencyKey` of at most 128 characters; the same value is sent in header
and body. Automatic retries are disabled. The explicit issue retry option
allows one retry after HTTP 503 using the same body and key. Verification is
never automatically retried. A timeout has an unknown outcome; reconcile the
original issue rather than starting one with a new key.

API errors expose HTTP status, the `defined`, `code`, `status`, `message`, `data`
envelope, request ID and retry delay in milliseconds. List methods accept cursor
pages and ISO 8601 date/status/type filters. Each guide describes the native
method names, options and connection lifetime.

These clients are for servers. For browser/public-key, framework and UI
integrations, use the [JavaScript SDK](../packages/sdk/README.md). Kotlin/JVM
uses the Java API; Android and Kotlin Multiplatform are not covered by this release.

## Migrating from 0.1.x

Version `0.2.0` matches the K-OTP API 2.0 contract:

- `channel` accepts only `"alimtalk"` (also the default). Leave it out; an
  explicit `"sms"` is rejected with a 400 whose `data.code` is
  `CHANNEL_NOT_SUPPORTED`. SMS remains only as the automatic fallback of a
  failed AlimTalk delivery (`smsFallback`), and issue lists can still report
  `sms` as the delivered channel after a fallback.
- `webOtp` is gone from requests and responses. A request that still sets it
  to anything but `false` is rejected with 400 `WEB_OTP_NOT_SUPPORTED`.
- A template without an approved AlimTalk code cannot be issued: 400
  `TEMPLATE_NOT_AVAILABLE`; its `channelSupport` is empty. Templates that can be
  issued report `["alimtalk"]`.
- `messageType` is deprecated and ignored.
- The per-call `origin` request option is removed from every client (it only
  bound `webOtp`): drop it from issue options, or from `RequestOptions` in
  Java/Kotlin (constructor is now `RequestOptions(headers, retry503)`), C#
  (`new RequestOptions(headers, retry503)`) and Go.

These codes arrive in the `data` of the API error each client exposes, as
described in its guide.
