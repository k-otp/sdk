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

Native SDKs start at version `0.1.0` and have independent versions from npm.
TypeScript shares the version of `@k-otp/sdk`. Download native packages from
[GitHub Releases](https://github.com/k-otp/sdk/releases/tag/server-sdk-v0.1.0);
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
