# K-OTP server client for Go

```sh
go get github.com/k-otp/sdk/sdks/go@v0.1.0
```

```go
import kotp "github.com/k-otp/sdk/sdks/go"

client, err := kotp.New(kotp.Options{APIKey: os.Getenv("K_OTP_SECRET_KEY")})
if err != nil { return err }
balance, err := client.Balance(ctx, kotp.RequestOptions{})
```

This server client accepts `sk_` keys and returns ordinary JSON values.
Methods: `Issue`, `Verify`, `Status`, `Issues`, `IssueDetail`, `CreditLedger`,
`Balance`, `Templates`, `TemplateDetail`. Issue/verify accept `json.RawMessage`;
lists accept `map[string]any` using API JSON names: `limit`, `cursor`, RFC 3339
`createdFrom`/`createdTo`, and `verificationStatus` or `entryType`. Keep phone
numbers and codes as JSON strings.

Issue requires a trimmed nonempty ASCII `idempotencyKey` up to 128 characters.
The same key is sent in header and body. Automatic retries are disabled.
`RequestOptions{Retry503:true}` permits one issue retry after an explicit HTTP
503 response. Other operations never automatically retry. Request options also
accept `Headers` and `Origin`; authentication and idempotency headers cannot be
replaced.

Use `errors.As` to read `*kotp.APIError`: HTTP `Status`, JSON `Envelope`,
`RequestID`, `RetryAfterMs` and lowercase `Headers`. `*kotp.TransportError`
returns `Outcome()=="unknown"`; a timed-out issue may have reached the server.
Reconcile it with the original key rather than starting a new operation.

Every call accepts a context. `Options.Timeout` defaults to 10 seconds.
`Options.BaseURL` accepts HTTPS or loopback HTTP for local tests. Redirects and
requests to another origin are rejected. A supplied transport must honor the
request context. Supported runtime: Go 1.26.
