# K-OTP server client for .NET

Add the local preview package directory as a NuGet source, then reference
`KOtp.Kiota.Poc` version `0.1.0-preview.1`.

```cs
using KOtp.Preview;
using var client = new KotpClient(Environment.GetEnvironmentVariable("K_OTP_SECRET_KEY")!);
var balance = await client.BalanceAsync();
```

Use an `sk_` server key. Responses are `JsonNode` values. The client provides
`IssueAsync`, `VerifyAsync`, `StatusAsync`, `IssuesAsync`, `IssueDetailAsync`,
`CreditLedgerAsync`, `BalanceAsync`, `TemplatesAsync` and `TemplateDetailAsync`.
Issue/verify inputs and list queries use JSON property names. List filters
include `limit`, `cursor`, ISO 8601 `createdFrom`/`createdTo` and
`verificationStatus` or `entryType`. Phone numbers and codes remain strings.

`IssueAsync` validates and trims `idempotencyKey` before HTTP, then sends the
same key in header and body. It must be nonempty ASCII, at most 128 characters.
Automatic retries are disabled. `new RequestOptions(Retry503: true)` permits
one issue retry after an explicit HTTP 503 response. Other operations do not
automatically retry. Request options also accept `Origin` and custom `Headers`;
authentication and idempotency headers are managed by the client.

`KotpApiException` exposes HTTP `Status`, JSON `Envelope`, `RequestId`,
`RetryAfterMs` and lowercase `Headers`. `KotpTransportException.Outcome` is
`"unknown"`; a timed-out issue may have reached the server. Reconcile it using
the same idempotency key rather than starting a new operation.

The default timeout is 10 seconds; configure `timeoutMs` in the constructor.
Every method accepts a `CancellationToken`; caller cancellation propagates.
`baseUrl` accepts HTTPS or loopback HTTP for local tests. Default transport
rejects redirects; all requests are restricted to the configured API origin.
A supplied handler must also disable redirects. Dispose the client; it owns
the supplied handler. This is a local preview targeting .NET 8; additional
frameworks and production network environments remain under evaluation.
