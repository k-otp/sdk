package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/k-otp/sdk/poc/kiota/generated/preview"
	"os"
	"time"
)

func main() {
	data, err := os.ReadFile(os.Getenv("POC_FIXTURE"))
	if err != nil {
		panic(err)
	}
	var fixture struct {
		FakeSecretKey string `json:"fakeSecretKey"`
		Cases         []struct {
			ID            string          `json:"id"`
			Operation     string          `json:"operation"`
			Request       json.RawMessage `json:"request"`
			Query         map[string]any  `json:"query"`
			PathValue     string          `json:"pathValue"`
			TimeoutMs     int             `json:"timeoutMs"`
			ExplicitRetry bool            `json:"explicitRetry"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		panic(err)
	}
	observations := []map[string]any{}
	for _, test := range fixture.Cases {
		timeout := 10 * time.Second
		if test.TimeoutMs > 0 {
			timeout = time.Duration(test.TimeoutMs) * time.Millisecond
		}
		client, e := preview.New(preview.Options{APIKey: fixture.FakeSecretKey, BaseURL: os.Getenv("POC_BASE_URL"), Timeout: timeout})
		if e != nil {
			panic(e)
		}
		options := preview.RequestOptions{Headers: map[string]string{"X-Poc-Case": test.ID}, Origin: "https://poc.example.com", Retry503: test.ExplicitRetry}
		ctx := context.Background()
		var value any
		switch test.Operation {
		case "issue":
			value, err = client.Issue(ctx, test.Request, options)
		case "verify":
			value, err = client.Verify(ctx, test.Request, options)
		case "status":
			value, err = client.Status(ctx, test.Query["issueId"].(string), options)
		case "issues":
			value, err = client.Issues(ctx, test.Query, options)
		case "issueDetail":
			value, err = client.IssueDetail(ctx, test.PathValue, options)
		case "creditLedger":
			value, err = client.CreditLedger(ctx, test.Query, options)
		case "balance":
			value, err = client.Balance(ctx, options)
		case "templates":
			value, err = client.Templates(ctx, options)
		case "templateDetail":
			value, err = client.TemplateDetail(ctx, test.PathValue, options)
		default:
			panic("Unknown fixture operation")
		}
		result := map[string]any{"id": test.ID}
		var api *preview.APIError
		var transport *preview.TransportError
		var config preview.ConfigurationError
		if err == nil {
			result["response"] = value
		} else if errors.As(err, &api) {
			result["response"] = api.Envelope
			result["status"] = api.Status
			result["headers"] = api.Headers
			result["requestId"] = api.RequestID
			result["retryAfterMs"] = api.RetryAfterMs
		} else if errors.As(err, &transport) {
			result["outcome"] = transport.Outcome()
		} else if errors.As(err, &config) {
			result["outcome"] = "configuration_error"
		} else {
			panic(err)
		}
		observations = append(observations, result)
	}
	output, err := json.Marshal(observations)
	if err != nil {
		panic(err)
	}
	if err = os.WriteFile(os.Getenv("POC_WIRE_RESULT"), output, 0600); err != nil {
		panic(err)
	}
}
