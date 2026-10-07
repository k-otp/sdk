# K-OTP server SDK previews

These local preview packages provide server clients for the public K-OTP API.
Choose your language for installation and usage:

| Language | Guide | Preview version |
| --- | --- | --- |
| C# / .NET | [.NET](dotnet/README.md) | `0.1.0-preview.1` |
| Java | [Java](java/README.md) | `0.1.0-preview.1` |
| Kotlin/JVM | [Java JAR from Kotlin](java/README.md) | `0.1.0-preview.1` |
| PHP | [PHP](php/README.md) | `0.1.0-alpha.1` |
| Go | [Go](go/README.md) | `v0.1.0-preview.1` |
| Python | [Python](python/README.md) | `0.1.0a1` |
| Ruby | [Ruby](ruby/README.md) | `0.1.0.pre.1` |
| Dart | [Dart](dart/README.md) | `0.1.0-dev.1` |
| TypeScript | [TypeScript](typescript/README.md) | `0.1.0-preview.1` |

All clients use an `sk_` server secret key. They provide issue, verify, status,
issue lists/detail, credit ledger, balance, and templates/list detail. Responses
are native JSON values. Keep phone numbers and verification codes as strings.

Issue requires an idempotency key before making a request. The client trims
the key and sends the same value in header and body. Automatic retries are
disabled. An explicit issue option permits one retry after HTTP 503; verification
is never automatically retried. A network timeout has an unknown outcome, so
reconcile the original issue instead of starting one with a new key.

API errors expose HTTP status, the error envelope, request ID and retry delay.
The envelope includes `defined`, `code`, `status`, `message` and arbitrary `data`.
List endpoints accept cursor pages and date/status/type filters. Each language
guide documents its method names and connection lifetime.

Install the supplied local artifacts; registry package names are provisional.
These previews do not establish browser/public-key, mobile or production
environment support. The existing JavaScript/TypeScript SDK remains the
supported choice for its documented integrations.
