using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Kiota.Abstractions;
using Microsoft.Kiota.Abstractions.Authentication;
using Microsoft.Kiota.Abstractions.Serialization;
using Microsoft.Kiota.Http.HttpClientLibrary;
using Microsoft.Kiota.Serialization.Json;
using KOtp.Sdk.Generated;
using KOtp.Sdk.Generated.Issue;
using KOtp.Sdk.Generated.Verify;
using KOtp.Sdk.Generated.Models;

var fixture = JsonNode.Parse(File.ReadAllText(Environment.GetEnvironmentVariable("POC_FIXTURE")!))!;
var baseUrl = Environment.GetEnvironmentVariable("POC_BASE_URL")!;
var key = fixture["fakeSecretKey"]!.GetValue<string>();
if (!key.StartsWith("sk_") || !baseUrl.StartsWith("http://127.0.0.1:")) throw new ArgumentException("Secret key and loopback URL required");
var observations = new List<object>();
foreach (var test in fixture["cases"]!.AsArray()) {
    var item = test!.AsObject();
    using var handler = new LoopbackHandler(new Uri(baseUrl));
    using var http = item["defaultRetryProbe"]?.GetValue<bool>() == true ? KiotaClientFactory.Create(handler) : new HttpClient(handler);
    http.Timeout = TimeSpan.FromSeconds(10);
    http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
    var adapter = new HttpClientRequestAdapter(new AnonymousAuthenticationProvider(), httpClient: http);
    adapter.BaseUrl = baseUrl;
    var client = new KOtpApiClient(adapter);
    var observation = new Dictionary<string,object?> { ["id"] = item["id"]!.GetValue<string>() };
    using var cancel = new CancellationTokenSource(item["timeoutMs"]?.GetValue<int>() ?? 10000);
    try {
        IParsable? value;
        try { value = await Call(client, item, cancel.Token); }
        catch (ApiException error) { if (item["explicitRetry"]?.GetValue<bool>() == true && error.ResponseStatusCode == 503) value = await Call(client, item, cancel.Token); else throw; }
        observation["response"] = await Serialize(value);
    } catch (ApiException error) {
        observation["status"] = error.ResponseStatusCode; observation["headers"] = error.ResponseHeaders;
        observation["response"] = await Serialize(error as IParsable); observation["exception"] = error.GetType().Name;
    } catch (OperationCanceledException error) {
        observation["outcome"] = "unknown"; observation["exception"] = error.GetType().Name;
    } catch (ArgumentException error) {
        observation["outcome"] = "configuration_error"; observation["exception"] = error.GetType().Name;
    } catch (Exception error) {
        observation["outcome"] = "unexpected_exception"; observation["exception"] = error.GetType().Name; observation["diagnostic"] = error.Message;
    }
    observations.Add(observation);
}
await File.WriteAllTextAsync(Environment.GetEnvironmentVariable("POC_WIRE_RESULT")!, JsonSerializer.Serialize(observations));

static async Task<T> Model<T>(JsonNode value, ParsableFactory<T> factory) where T:IParsable {
    using var stream = new MemoryStream(Encoding.UTF8.GetBytes(value.ToJsonString()));
    var node = await new JsonParseNodeFactory().GetRootParseNodeAsync("application/json", stream);
    return node.GetObjectValue(factory)!;
}
static async Task<JsonNode?> Serialize(IParsable? value) {
    if (value is null) return null;
    using var writer = new JsonSerializationWriter(); writer.WriteObjectValue(null, value);
    using var stream = writer.GetSerializedContent();
    return await JsonNode.ParseAsync(stream);
}
static async Task<IParsable?> Call(KOtpApiClient client, JsonObject test, CancellationToken cancel) {
    var id = test["id"]!.GetValue<string>(); var query = test["query"]!.AsObject();
    switch(test["operation"]!.GetValue<string>()) {
        case "issue": {
            var input = test["request"]!.DeepClone().AsObject();
            var key = input["idempotencyKey"]?.GetValue<string>().Trim() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(key,"^[!-~]{1,128}$")) throw new ArgumentException("Invalid idempotency before HTTP");
            var webOtp = input["webOtp"]; input.Remove("webOtp");
            var body = await Model(input, IssuePostRequestBody.CreateFromDiscriminatorValue); body.IdempotencyKey = key;
            if (webOtp is not null) {
                var wrapper = new IssuePostRequestBody.IssuePostRequestBody_webOtp();
                if (webOtp is JsonValue primitive) wrapper.Boolean = primitive.GetValue<bool>();
                else wrapper.IssueWebOtpOptions = await Model(webOtp, IssueWebOtpOptions.CreateFromDiscriminatorValue);
                body.WebOtp = wrapper;
            }
            return await client.Issue.PostAsIssuePostResponseAsync(body,c => {c.Headers.Add("X-Poc-Case",id);c.Headers.Add("Idempotency-Key",key);c.Headers.Add("Origin","https://poc.example.com");},cancel);
        }
        case "verify": return await client.Verify.PostAsVerifyPostResponseAsync(await Model(test["request"]!,VerifyPostRequestBody.CreateFromDiscriminatorValue),c => c.Headers.Add("X-Poc-Case",id),cancel);
        case "status": return await client.Status.GetAsStatusGetResponseAsync(c => {c.Headers.Add("X-Poc-Case",id);c.QueryParameters.IssueId=query["issueId"]!.GetValue<string>();},cancel);
        case "issues": return await client.Issues.GetAsIssuesGetResponseAsync(c => {c.Headers.Add("X-Poc-Case",id);c.QueryParameters.Limit=query["limit"]!.GetValue<int>();c.QueryParameters.Cursor=query["cursor"]?.GetValue<string>();c.QueryParameters.VerificationStatusAsGetVerificationStatusQueryParameterType=Enum.Parse<KOtp.Sdk.Generated.Issues.GetVerificationStatusQueryParameterType>(query["verificationStatus"]!.GetValue<string>(),true);},cancel);
        case "issueDetail": return await client.Issues[Guid.Parse(test["pathValue"]!.GetValue<string>())].GetAsWithIssueGetResponseAsync(c => c.Headers.Add("X-Poc-Case",id),cancel);
        case "creditLedger": return await client.CreditLedger.GetAsCreditLedgerGetResponseAsync(c => {c.Headers.Add("X-Poc-Case",id);c.QueryParameters.Limit=query["limit"]!.GetValue<int>();c.QueryParameters.EntryTypeAsGetEntryTypeQueryParameterType=Enum.Parse<KOtp.Sdk.Generated.CreditLedger.GetEntryTypeQueryParameterType>(query["entryType"]!.GetValue<string>(),true);},cancel);
        case "balance": return await client.Balance.GetAsBalanceGetResponseAsync(c => c.Headers.Add("X-Poc-Case",id),cancel);
        case "templates": return await client.Templates.GetAsTemplatesGetResponseAsync(c => c.Headers.Add("X-Poc-Case",id),cancel);
        case "templateDetail": return await client.Templates[test["pathValue"]!.GetValue<string>()].GetAsWithTemplateGetResponseAsync(c => c.Headers.Add("X-Poc-Case",id),cancel);
        default: throw new ArgumentException("Unknown operation");
    }
}

sealed class LoopbackHandler(Uri allowed) : DelegatingHandler(new HttpClientHandler()) {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel) {
        if (request.RequestUri?.Host != "127.0.0.1" || request.RequestUri.Port != allowed.Port) throw new InvalidOperationException("Unexpected external network destination");
        return base.SendAsync(request,cancel);
    }
}
