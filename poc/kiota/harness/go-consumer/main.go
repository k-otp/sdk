package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	sdk "github.com/k-otp/sdk/sdks/go/generated"
	"github.com/k-otp/sdk/sdks/go/generated/balance"
	"github.com/k-otp/sdk/sdks/go/generated/creditledger"
	"github.com/k-otp/sdk/sdks/go/generated/issue"
	"github.com/k-otp/sdk/sdks/go/generated/issues"
	"github.com/k-otp/sdk/sdks/go/generated/models"
	"github.com/k-otp/sdk/sdks/go/generated/status"
	"github.com/k-otp/sdk/sdks/go/generated/templates"
	"github.com/k-otp/sdk/sdks/go/generated/verify"
	abs "github.com/microsoft/kiota-abstractions-go"
	auth "github.com/microsoft/kiota-abstractions-go/authentication"
	ser "github.com/microsoft/kiota-abstractions-go/serialization"
	bundle "github.com/microsoft/kiota-bundle-go"
	kiotahttp "github.com/microsoft/kiota-http-go"
	kjson "github.com/microsoft/kiota-serialization-json-go"
)

type TestCase struct {
	DefaultRetryProbe bool            `json:"defaultRetryProbe"`
	ID                string          `json:"id"`
	Operation         string          `json:"operation"`
	Request           json.RawMessage `json:"request"`
	Query             map[string]any  `json:"query"`
	PathValue         string          `json:"pathValue"`
	TimeoutMs         int             `json:"timeoutMs"`
	ExplicitRetry     bool            `json:"explicitRetry"`
}
type configurationError struct{ error }
type guardedTransport struct {
	allowed *url.URL
	key     string
	inner   http.RoundTripper
}

func (t guardedTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Host != t.allowed.Host || request.URL.Scheme != "http" {
		return nil, errors.New("unexpected external network destination")
	}
	clone := request.Clone(request.Context())
	clone.Header.Set("Authorization", "Bearer "+t.key)
	if t.inner != nil {
		return t.inner.RoundTrip(clone)
	}
	return http.DefaultTransport.RoundTrip(clone)
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
func call(client *sdk.KOtpApiClient, test TestCase, ctx context.Context) (ser.Parsable, error) {
	headers := abs.NewRequestHeaders()
	headers.Add("X-Poc-Case", test.ID)
	switch test.Operation {
	case "issue":
		var input map[string]json.RawMessage
		if err := json.Unmarshal(test.Request, &input); err != nil {
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
			return nil, configurationError{errors.New("invalid idempotency key before HTTP")}
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
		headers.Add("Origin", "https://poc.example.com")
		return client.Issue().PostAsIssuePostResponse(ctx, body, &issue.IssueRequestBuilderPostRequestConfiguration{Headers: headers})
	case "verify":
		body, err := model(test.Request, verify.CreateVerifyPostRequestBodyFromDiscriminatorValue)
		if err != nil {
			return nil, err
		}
		return client.Verify().PostAsVerifyPostResponse(ctx, body.(verify.VerifyPostRequestBodyable), &verify.VerifyRequestBuilderPostRequestConfiguration{Headers: headers})
	case "status":
		return client.Status().GetAsStatusGetResponse(ctx, &status.StatusRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &status.StatusRequestBuilderGetQueryParameters{IssueId: ptr(test.Query["issueId"].(string))}})
	case "issues":
		var cursor *string
		if value, ok := test.Query["cursor"].(string); ok {
			cursor = &value
		}
		enum, err := issues.ParseGetVerificationStatusQueryParameterType(test.Query["verificationStatus"].(string))
		if err != nil {
			return nil, err
		}
		return client.Issues().GetAsIssuesGetResponse(ctx, &issues.IssuesRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &issues.IssuesRequestBuilderGetQueryParameters{Limit: ptr(int32(test.Query["limit"].(float64))), Cursor: cursor, VerificationStatusAsGetVerificationStatusQueryParameterType: enum.(*issues.GetVerificationStatusQueryParameterType)}})
	case "issueDetail":
		return client.Issues().ByIssueId(test.PathValue).GetAsWithIssueGetResponse(ctx, &issues.WithIssueItemRequestBuilderGetRequestConfiguration{Headers: headers})
	case "creditLedger":
		enum, err := creditledger.ParseGetEntryTypeQueryParameterType(test.Query["entryType"].(string))
		if err != nil {
			return nil, err
		}
		return client.CreditLedger().GetAsCreditLedgerGetResponse(ctx, &creditledger.CreditLedgerRequestBuilderGetRequestConfiguration{Headers: headers, QueryParameters: &creditledger.CreditLedgerRequestBuilderGetQueryParameters{Limit: ptr(int32(test.Query["limit"].(float64))), EntryTypeAsGetEntryTypeQueryParameterType: enum.(*creditledger.GetEntryTypeQueryParameterType)}})
	case "balance":
		return client.Balance().GetAsBalanceGetResponse(ctx, &balance.BalanceRequestBuilderGetRequestConfiguration{Headers: headers})
	case "templates":
		return client.Templates().GetAsTemplatesGetResponse(ctx, &templates.TemplatesRequestBuilderGetRequestConfiguration{Headers: headers})
	case "templateDetail":
		return client.Templates().ByTemplateId(test.PathValue).GetAsWithTemplateGetResponse(ctx, &templates.WithTemplateItemRequestBuilderGetRequestConfiguration{Headers: headers})
	default:
		return nil, errors.New("unknown operation")
	}
}
func main() {
	data, err := os.ReadFile(os.Getenv("POC_FIXTURE"))
	if err != nil {
		panic(err)
	}
	var fixture struct {
		FakeSecretKey string     `json:"fakeSecretKey"`
		Cases         []TestCase `json:"cases"`
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		panic(err)
	}
	base, err := url.Parse(os.Getenv("POC_BASE_URL"))
	if err != nil || base.Hostname() != "127.0.0.1" || !strings.HasPrefix(fixture.FakeSecretKey, "sk_") {
		panic("secret key and loopback URL required")
	}
	httpClient := &http.Client{Transport: guardedTransport{allowed: base, key: fixture.FakeSecretKey}, Timeout: 10 * time.Second}
	adapter, err := bundle.NewDefaultRequestAdapterWithParseNodeFactoryAndSerializationWriterFactoryAndHttpClient(&auth.AnonymousAuthenticationProvider{}, nil, nil, httpClient)
	if err != nil {
		panic(err)
	}
	adapter.SetBaseUrl(base.String())
	client := sdk.NewKOtpApiClient(adapter)
	observations := []map[string]any{}
	for _, test := range fixture.Cases {
		if test.DefaultRetryProbe {
			defaultHttp := kiotahttp.GetDefaultClient()
			defaultHttp.Transport = guardedTransport{allowed: base, key: fixture.FakeSecretKey, inner: defaultHttp.Transport}
			defaultAdapter, createErr := bundle.NewDefaultRequestAdapterWithParseNodeFactoryAndSerializationWriterFactoryAndHttpClient(&auth.AnonymousAuthenticationProvider{}, nil, nil, defaultHttp)
			if createErr != nil {
				panic(createErr)
			}
			defaultAdapter.SetBaseUrl(base.String())
			client = sdk.NewKOtpApiClient(defaultAdapter)
		}
		ctx := context.Background()
		cancel := func() {}
		if test.TimeoutMs > 0 {
			ctx, cancel = context.WithTimeout(ctx, time.Duration(test.TimeoutMs)*time.Millisecond)
		}
		value, err := call(client, test, ctx)
		if err != nil && test.ExplicitRetry {
			if api, ok := err.(interface{ GetStatusCode() int }); ok && api.GetStatusCode() == 503 {
				value, err = call(client, test, ctx)
			}
		}
		cancel()
		observation := map[string]any{"id": test.ID}
		if err == nil {
			observation["response"], err = serialize(value)
		}
		if err != nil {
			observation["exception"] = fmt.Sprintf("%T", err)
			if _, ok := err.(configurationError); ok {
				observation["outcome"] = "configuration_error"
			} else if test.TimeoutMs > 0 {
				observation["outcome"] = "unknown"
			} else if api, ok := err.(interface {
				GetStatusCode() int
				GetResponseHeaders() *abs.ResponseHeaders
			}); ok {
				observation["status"] = api.GetStatusCode()
				observation["headers"] = map[string][]string{"X-Request-Id": api.GetResponseHeaders().Get("X-Request-Id"), "Retry-After": api.GetResponseHeaders().Get("Retry-After")}
				if parsed, ok := err.(ser.Parsable); ok {
					observation["response"], _ = serialize(parsed)
				}
			} else {
				observation["outcome"] = "unexpected_exception"
				observation["diagnostic"] = err.Error()
			}
		}
		observations = append(observations, observation)
	}
	output, err := json.Marshal(observations)
	if err != nil {
		panic(err)
	}
	if err = os.WriteFile(os.Getenv("POC_WIRE_RESULT"), output, 0600); err != nil {
		panic(err)
	}
}
