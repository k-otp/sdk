package preview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	sdk "github.com/k-otp/sdk/poc/kiota/generated"
	"github.com/k-otp/sdk/poc/kiota/generated/balance"
	"github.com/k-otp/sdk/poc/kiota/generated/creditledger"
	"github.com/k-otp/sdk/poc/kiota/generated/issue"
	"github.com/k-otp/sdk/poc/kiota/generated/issues"
	"github.com/k-otp/sdk/poc/kiota/generated/models"
	"github.com/k-otp/sdk/poc/kiota/generated/status"
	"github.com/k-otp/sdk/poc/kiota/generated/templates"
	"github.com/k-otp/sdk/poc/kiota/generated/verify"
	abs "github.com/microsoft/kiota-abstractions-go"
	auth "github.com/microsoft/kiota-abstractions-go/authentication"
	ser "github.com/microsoft/kiota-abstractions-go/serialization"
	kiotahttp "github.com/microsoft/kiota-http-go"
	kjson "github.com/microsoft/kiota-serialization-json-go"
)

type ConfigurationError struct{ error }
type TransportError struct{ Cause error }

func (e *TransportError) Error() string   { return "The request outcome is unknown" }
func (e *TransportError) Unwrap() error   { return e.Cause }
func (e *TransportError) Outcome() string { return "unknown" }

type APIError struct {
	Status       int
	Envelope     map[string]any
	Headers      map[string][]string
	RequestID    string
	RetryAfterMs *float64
	Cause        error
}

func (e *APIError) Error() string {
	if message, ok := e.Envelope["message"].(string); ok {
		return message
	}
	return "K-OTP API request failed"
}
func (e *APIError) Unwrap() error { return e.Cause }

type Options struct {
	APIKey    string
	BaseURL   string
	Timeout   time.Duration
	Transport http.RoundTripper
}
type RequestOptions struct {
	Headers  map[string]string
	Origin   string
	Retry503 bool
}
type Client struct{ api *sdk.KOtpApiClient }
type originTransport struct {
	base  *url.URL
	key   string
	inner http.RoundTripper
}

func (t originTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Host != t.base.Host || request.URL.Scheme != t.base.Scheme {
		return nil, ConfigurationError{errors.New("Request destination differs from the configured API origin")}
	}
	clone := request.Clone(request.Context())
	clone.Header.Set("Authorization", "Bearer "+t.key)
	return t.inner.RoundTrip(clone)
}
func New(options Options) (*Client, error) {
	valid := strings.HasPrefix(options.APIKey, "sk_") && len(options.APIKey) > 3
	for _, r := range options.APIKey {
		if r < 33 || r > 126 {
			valid = false
		}
	}
	if !valid {
		return nil, ConfigurationError{errors.New("A server secret key is required")}
	}
	if options.BaseURL == "" {
		options.BaseURL = "https://api.k-otp.dev/v1"
	}
	base, err := url.Parse(options.BaseURL)
	if err != nil || base.User != nil || base.RawQuery != "" || base.Fragment != "" || !(base.Scheme == "https" || base.Scheme == "http" && base.Hostname() == "127.0.0.1") {
		return nil, ConfigurationError{errors.New("An HTTPS API base URL or loopback HTTP URL is required")}
	}
	if options.Timeout == 0 {
		options.Timeout = 10 * time.Second
	}
	if options.Timeout < 0 {
		return nil, ConfigurationError{errors.New("Timeout must be positive")}
	}
	if options.Transport == nil {
		options.Transport = http.DefaultTransport
	}
	httpClient := &http.Client{Transport: originTransport{base, options.APIKey, options.Transport}, Timeout: options.Timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	adapter, err := kiotahttp.NewNetHttpRequestAdapterWithParseNodeFactoryAndSerializationWriterFactoryAndHttpClient(&auth.AnonymousAuthenticationProvider{}, nil, nil, httpClient)
	if err != nil {
		return nil, err
	}
	adapter.SetBaseUrl(base.String())
	return &Client{sdk.NewKOtpApiClient(adapter)}, nil
}

type callInput struct {
	Operation string
	Request   json.RawMessage
	Query     map[string]any
	PathValue string
}

func (c *Client) Issue(ctx context.Context, input json.RawMessage, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "issue", Request: input}, options)
}
func (c *Client) Verify(ctx context.Context, input json.RawMessage, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "verify", Request: input}, options)
}
func (c *Client) Status(ctx context.Context, id string, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "status", Query: map[string]any{"issueId": id}}, options)
}
func (c *Client) Issues(ctx context.Context, query map[string]any, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "issues", Query: query}, options)
}
func (c *Client) IssueDetail(ctx context.Context, id string, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "issueDetail", PathValue: id}, options)
}
func (c *Client) CreditLedger(ctx context.Context, query map[string]any, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "creditLedger", Query: query}, options)
}
func (c *Client) Balance(ctx context.Context, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "balance"}, options)
}
func (c *Client) Templates(ctx context.Context, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "templates"}, options)
}
func (c *Client) TemplateDetail(ctx context.Context, id string, options RequestOptions) (any, error) {
	return c.send(ctx, callInput{Operation: "templateDetail", PathValue: id}, options)
}
func (c *Client) send(ctx context.Context, input callInput, options RequestOptions) (any, error) {
	if ctx == nil {
		return nil, ConfigurationError{errors.New("A context is required")}
	}
	headers := map[string]string{}
	for key, value := range options.Headers {
		if strings.EqualFold(key, "Authorization") || strings.EqualFold(key, "Idempotency-Key") {
			return nil, ConfigurationError{errors.New("Authentication and idempotency headers are managed by the client")}
		}
		headers[key] = value
	}
	options.Headers = headers
	input.Request = append(json.RawMessage(nil), input.Request...)
	if input.Query != nil {
		encoded, err := json.Marshal(input.Query)
		if err != nil {
			return nil, err
		}
		input.Query = nil
		if err = json.Unmarshal(encoded, &input.Query); err != nil {
			return nil, err
		}
	}
	value, err := call(c.api, input, options, ctx)
	if err != nil && input.Operation == "issue" && options.Retry503 {
		if status, ok := err.(interface{ GetStatusCode() int }); ok && status.GetStatusCode() == 503 {
			value, err = call(c.api, input, options, ctx)
		}
	}
	if err == nil {
		return serialize(value)
	}
	var configuration ConfigurationError
	if errors.As(err, &configuration) {
		return nil, err
	}
	if status, ok := err.(interface {
		GetStatusCode() int
		GetResponseHeaders() *abs.ResponseHeaders
	}); ok {
		envelope := map[string]any{}
		if parsed, ok := err.(ser.Parsable); ok {
			value, failure := serialize(parsed)
			if failure != nil {
				return nil, failure
			}
			if object, ok := value.(map[string]any); ok {
				envelope = object
			}
		}
		headers := map[string][]string{}
		if values := status.GetResponseHeaders(); values != nil {
			for _, key := range values.ListKeys() {
				headers[strings.ToLower(key)] = values.Get(key)
			}
		}
		result := &APIError{Status: status.GetStatusCode(), Envelope: envelope, Headers: headers, Cause: err}
		if values := headers["x-request-id"]; len(values) > 0 {
			result.RequestID = values[0]
		}
		if data, ok := envelope["data"].(map[string]any); ok {
			if ms, ok := data["retryAfterMs"].(float64); ok && ms >= 0 {
				result.RetryAfterMs = &ms
			}
		}
		if result.RetryAfterMs == nil {
			if values := headers["retry-after"]; len(values) > 0 {
				var seconds float64
				if _, e := fmt.Sscan(values[0], &seconds); e == nil && seconds >= 0 {
					ms := seconds * 1000
					result.RetryAfterMs = &ms
				}
			}
		}
		return nil, result
	}
	return nil, &TransportError{err}
}
func stringValue(query map[string]any, key string) *string {
	if value, ok := query[key].(string); ok {
		return &value
	}
	return nil
}
func queryValues(query map[string]any) (*int32, *time.Time, *time.Time, error) {
	var limit *int32
	if value, ok := query["limit"].(float64); ok {
		if value != float64(int32(value)) {
			return nil, nil, nil, ConfigurationError{errors.New("limit must be an integer")}
		}
		limit = ptr(int32(value))
	}
	parse := func(key string) (*time.Time, error) {
		if value, ok := query[key].(string); ok {
			parsed, err := time.Parse(time.RFC3339Nano, value)
			return &parsed, err
		}
		return nil, nil
	}
	from, err := parse("createdFrom")
	if err != nil {
		return nil, nil, nil, err
	}
	to, err := parse("createdTo")
	return limit, from, to, err
}
func ptr[T any](value T) *T { return &value }
func model(data []byte, factory ser.ParsableFactory) (ser.Parsable, error) {
	node, err := kjson.NewJsonParseNodeFactory().GetRootParseNode("application/json", data)
	if err != nil {
		return nil, err
	}
	return node.GetObjectValue(factory)
}
func serialize(value ser.Parsable) (any, error) {
	if value == nil {
		return nil, nil
	}
	writer := kjson.NewJsonSerializationWriter()
	if err := writer.WriteObjectValue("", value); err != nil {
		return nil, err
	}
	data, err := writer.GetSerializedContent()
	if err != nil {
		return nil, err
	}
	var output any
	err = json.Unmarshal(data, &output)
	return output, err
}
func call(client *sdk.KOtpApiClient, request callInput, options RequestOptions, ctx context.Context) (ser.Parsable, error) {
	headers := abs.NewRequestHeaders()
	for key, value := range options.Headers {
		headers.Add(key, value)
	}
	switch request.Operation {
	case "issue":
		var input map[string]json.RawMessage
		if err := json.Unmarshal(request.Request, &input); err != nil {
			return nil, err
		}
		var key string
		_ = json.Unmarshal(input["idempotencyKey"], &key)
		key = strings.TrimSpace(key)
		valid := len(key) > 0 && len(key) <= 128
		for _, value := range key {
			if value < 33 || value > 126 {
				valid = false
			}
		}
		if !valid {
			return nil, ConfigurationError{errors.New("invalid idempotency key before HTTP")}
		}
		web, hasWeb := input["webOtp"]
		delete(input, "webOtp")
		data, _ := json.Marshal(input)
		parsed, err := model(data, issue.CreateIssuePostRequestBodyFromDiscriminatorValue)
		if err != nil {
			return nil, err
		}
		body := parsed.(*issue.IssuePostRequestBody)
		body.SetIdempotencyKey(&key)
		if hasWeb {
			wrapper := issue.NewIssuePostRequestBody_IssuePostRequestBody_webOtp()
			var flag bool
			if json.Unmarshal(web, &flag) == nil {
				wrapper.SetBoolean(&flag)
			} else {
				value, err := model(web, models.CreateIssueWebOtpOptionsFromDiscriminatorValue)
				if err != nil {
					return nil, err
				}
				wrapper.SetIssueWebOtpOptions(value.(models.IssueWebOtpOptionsable))
			}
			body.SetWebOtp(wrapper)
		}
		headers.Add("Idempotency-Key", key)
		if options.Origin != "" {
			headers.Add("Origin", options.Origin)
		}
		return client.Issue().PostAsIssuePostResponse(ctx, body, &issue.IssueRequestBuilderPostRequestConfiguration{Headers: headers})
	case "verify":
		body, err := model(request.Request, verify.CreateVerifyPostRequestBodyFromDiscriminatorValue)
		if err != nil {
			return nil, err
		}
		return client.Verify().PostAsVerifyPostResponse(ctx, body.(verify.VerifyPostRequestBodyable), &verify.VerifyRequestBuilderPostRequestConfiguration{Headers: headers})
	case "status":
		return client.Status().GetAsStatusGetResponse(ctx, &status.StatusRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &status.StatusRequestBuilderGetQueryParameters{IssueId: ptr(request.Query["issueId"].(string))}})
	case "issues":
		var cursor *string
		if value, ok := request.Query["cursor"].(string); ok {
			cursor = &value
		}
		var statusType *issues.GetVerificationStatusQueryParameterType
		if value, ok := request.Query["verificationStatus"].(string); ok {
			parsed, err := issues.ParseGetVerificationStatusQueryParameterType(value)
			if err != nil {
				return nil, err
			}
			statusType = parsed.(*issues.GetVerificationStatusQueryParameterType)
		}
		limit, from, to, err := queryValues(request.Query)
		if err != nil {
			return nil, err
		}
		return client.Issues().GetAsIssuesGetResponse(ctx, &issues.IssuesRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &issues.IssuesRequestBuilderGetQueryParameters{Limit: limit, Cursor: cursor, VerificationStatusAsGetVerificationStatusQueryParameterType: statusType, CreatedFrom: from, CreatedTo: to}})
	case "issueDetail":
		return client.Issues().ByIssueId(request.PathValue).GetAsWithIssueGetResponse(ctx, &issues.WithIssueItemRequestBuilderGetRequestConfiguration{Headers: headers})
	case "creditLedger":
		var entryType *creditledger.GetEntryTypeQueryParameterType
		if value, ok := request.Query["entryType"].(string); ok {
			parsed, err := creditledger.ParseGetEntryTypeQueryParameterType(value)
			if err != nil {
				return nil, err
			}
			entryType = parsed.(*creditledger.GetEntryTypeQueryParameterType)
		}
		limit, from, to, err := queryValues(request.Query)
		if err != nil {
			return nil, err
		}
		return client.CreditLedger().GetAsCreditLedgerGetResponse(ctx, &creditledger.CreditLedgerRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &creditledger.CreditLedgerRequestBuilderGetQueryParameters{Limit: limit, EntryTypeAsGetEntryTypeQueryParameterType: entryType, Cursor: stringValue(request.Query, "cursor"), CreatedFrom: from, CreatedTo: to}})
	case "balance":
		return client.Balance().GetAsBalanceGetResponse(ctx, &balance.BalanceRequestBuilderGetRequestConfiguration{Headers: headers})
	case "templates":
		return client.Templates().GetAsTemplatesGetResponse(ctx, &templates.TemplatesRequestBuilderGetRequestConfiguration{Headers: headers})
	case "templateDetail":
		return client.Templates().ByTemplateId(request.PathValue).GetAsWithTemplateGetResponse(ctx, &templates.WithTemplateItemRequestBuilderGetRequestConfiguration{Headers: headers})
	default:
		return nil, errors.New("unknown operation")
	}
}
