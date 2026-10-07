using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Kiota.Abstractions;
using Microsoft.Kiota.Abstractions.Authentication;
using Microsoft.Kiota.Abstractions.Serialization;
using Microsoft.Kiota.Http.HttpClientLibrary;
using Microsoft.Kiota.Serialization.Json;
using KOtp.Sdk.Generated;
using KOtp.Sdk.Generated.Issue;
using KOtp.Sdk.Generated.Verify;
using KOtp.Sdk.Generated.Models;

namespace KOtp.Preview;

public sealed record RequestOptions(IReadOnlyDictionary<string,string>? Headers = null, string? Origin = null, bool Retry503 = false);
public sealed class KotpApiException : Exception {
    public int Status { get; }
    public JsonNode? Envelope { get; }
    public IReadOnlyDictionary<string,string[]> Headers { get; }
    public string? RequestId { get; }
    public double? RetryAfterMs { get; }
    internal KotpApiException(ApiException error, JsonNode? envelope) : base(envelope?["message"]?.GetValue<string>() ?? "K-OTP API request failed", error) {
        Status = error.ResponseStatusCode; Envelope = envelope;
        Headers = (error.ResponseHeaders ?? new Dictionary<string,IEnumerable<string>>()).ToDictionary(pair => pair.Key.ToLowerInvariant(), pair => pair.Value.ToArray());
        RequestId = Headers.TryGetValue("x-request-id", out var ids) ? ids.FirstOrDefault() : null;
        if (envelope?["data"] is JsonObject data && data["retryAfterMs"] is JsonValue value && value.TryGetValue<double>(out var ms) && double.IsFinite(ms) && ms >= 0) RetryAfterMs = ms;
        else if (Headers.TryGetValue("retry-after", out var values) && long.TryParse(values.FirstOrDefault(), out var seconds) && seconds >= 0) RetryAfterMs = seconds * 1000d;
    }
}
public sealed class KotpTransportException(Exception cause) : Exception("The request outcome is unknown", cause) {
    public string Outcome => "unknown";
}

public sealed class KotpClient : IDisposable {
    private readonly HttpClient http;
    private readonly KOtpApiClient api;
    public KotpClient(string apiKey, string baseUrl = "https://api.k-otp.dev/v1", int timeoutMs = 10000, HttpMessageHandler? transport = null) {
        if (!Regex.IsMatch(apiKey, "^sk_[!-~]+$")) throw new ArgumentException("A server secret key is required");
        var uri = new Uri(baseUrl);
        if (uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || !(uri.Scheme == "https" || uri.Scheme == "http" && uri.Host == "127.0.0.1")) throw new ArgumentException("An HTTPS API base URL or loopback HTTP URL is required");
        if (timeoutMs <= 0) throw new ArgumentException("timeoutMs must be positive");
        http = new HttpClient(new OriginHandler(uri, apiKey, transport ?? new HttpClientHandler { AllowAutoRedirect = false })) { Timeout = TimeSpan.FromMilliseconds(timeoutMs) };
        var adapter = new HttpClientRequestAdapter(new AnonymousAuthenticationProvider(), httpClient: http) { BaseUrl = baseUrl };
        api = new KOtpApiClient(adapter);
    }
    public void Dispose() => http.Dispose();
    public Task<JsonNode?> IssueAsync(JsonObject input, RequestOptions? options = null, CancellationToken cancel = default) => Send("issue", input, new(), "", options, cancel);
    public Task<JsonNode?> VerifyAsync(JsonObject input, RequestOptions? options = null, CancellationToken cancel = default) => Send("verify", input, new(), "", options, cancel);
    public Task<JsonNode?> StatusAsync(string issueId, RequestOptions? options = null, CancellationToken cancel = default) => Send("status", new(), new() { ["issueId"] = issueId }, "", options, cancel);
    public Task<JsonNode?> IssuesAsync(JsonObject? query = null, RequestOptions? options = null, CancellationToken cancel = default) => Send("issues", new(), query ?? new(), "", options, cancel);
    public Task<JsonNode?> IssueDetailAsync(Guid issueId, RequestOptions? options = null, CancellationToken cancel = default) => Send("issueDetail", new(), new(), issueId.ToString(), options, cancel);
    public Task<JsonNode?> CreditLedgerAsync(JsonObject? query = null, RequestOptions? options = null, CancellationToken cancel = default) => Send("creditLedger", new(), query ?? new(), "", options, cancel);
    public Task<JsonNode?> BalanceAsync(RequestOptions? options = null, CancellationToken cancel = default) => Send("balance", new(), new(), "", options, cancel);
    public Task<JsonNode?> TemplatesAsync(RequestOptions? options = null, CancellationToken cancel = default) => Send("templates", new(), new(), "", options, cancel);
    public Task<JsonNode?> TemplateDetailAsync(string templateId, RequestOptions? options = null, CancellationToken cancel = default) => Send("templateDetail", new(), new(), templateId, options, cancel);

    private static async Task<T> Model<T>(JsonNode value, ParsableFactory<T> factory) where T:IParsable {
        using var stream = new System.IO.MemoryStream(Encoding.UTF8.GetBytes(value.ToJsonString()));
        var node = await new JsonParseNodeFactory().GetRootParseNodeAsync("application/json", stream);
        return node.GetObjectValue(factory)!;
    }
    private static async Task<JsonNode?> Json(IParsable? value) {
        if (value is null) return null;
        using var writer = new JsonSerializationWriter(); writer.WriteObjectValue(null, value);
        using var stream = writer.GetSerializedContent(); return await JsonNode.ParseAsync(stream);
    }
    private static void Configure(RequestHeaders headers, RequestOptions options) {
        foreach (var pair in options.Headers ?? new Dictionary<string,string>()) headers.Add(pair.Key, pair.Value);
    }
    private async Task<JsonNode?> Send(string operation, JsonObject input, JsonObject query, string path, RequestOptions? settings, CancellationToken cancel) {
        var options = settings ?? new RequestOptions();
        options = options with { Headers = options.Headers?.ToDictionary(pair => pair.Key, pair => pair.Value) };
        if (options.Headers?.Keys.Any(key => key.Equals("Authorization", StringComparison.OrdinalIgnoreCase) || key.Equals("Idempotency-Key", StringComparison.OrdinalIgnoreCase)) == true) throw new ArgumentException("Authentication and idempotency headers are managed by the client");
        input = input.DeepClone().AsObject(); query = query.DeepClone().AsObject();
        var key = operation == "issue" ? input["idempotencyKey"]?.GetValue<string>().Trim() ?? "" : "";
        if (operation == "issue" && !Regex.IsMatch(key, "^[!-~]{1,128}$")) throw new ArgumentException("Invalid issue idempotency key before HTTP");
        async Task<IParsable?> Call() {
            switch (operation) {
                case "issue": {
                    var request = input.DeepClone().AsObject(); var web = request["webOtp"]; request.Remove("webOtp");
                    var body = await Model(request, IssuePostRequestBody.CreateFromDiscriminatorValue); body.IdempotencyKey = key;
                    if (web is not null) {
                        var wrapper = new IssuePostRequestBody.IssuePostRequestBody_webOtp();
                        if (web is JsonValue primitive) wrapper.Boolean = primitive.GetValue<bool>(); else wrapper.IssueWebOtpOptions = await Model(web, IssueWebOtpOptions.CreateFromDiscriminatorValue);
                        body.WebOtp = wrapper;
                    }
                    return await api.Issue.PostAsIssuePostResponseAsync(body, c => { Configure(c.Headers, options); c.Headers.Add("Idempotency-Key", key); if (options.Origin is not null) c.Headers.Add("Origin", options.Origin); }, cancel);
                }
                case "verify": return await api.Verify.PostAsVerifyPostResponseAsync(await Model(input, VerifyPostRequestBody.CreateFromDiscriminatorValue), c => Configure(c.Headers, options), cancel);
                case "status": return await api.Status.GetAsStatusGetResponseAsync(c => { Configure(c.Headers, options); c.QueryParameters.IssueId = query["issueId"]?.GetValue<string>(); }, cancel);
                case "issues": return await api.Issues.GetAsIssuesGetResponseAsync(c => { Configure(c.Headers, options); c.QueryParameters.Limit = query["limit"]?.GetValue<int>(); c.QueryParameters.Cursor = query["cursor"]?.GetValue<string>(); if (query["verificationStatus"] is JsonNode status) c.QueryParameters.VerificationStatusAsGetVerificationStatusQueryParameterType = Enum.Parse<KOtp.Sdk.Generated.Issues.GetVerificationStatusQueryParameterType>(status.GetValue<string>(), true); if(query["createdFrom"] is JsonNode from) c.QueryParameters.CreatedFrom = DateTimeOffset.Parse(from.GetValue<string>()); if(query["createdTo"] is JsonNode to) c.QueryParameters.CreatedTo = DateTimeOffset.Parse(to.GetValue<string>()); }, cancel);
                case "issueDetail": return await api.Issues[Guid.Parse(path)].GetAsWithIssueGetResponseAsync(c => Configure(c.Headers, options), cancel);
                case "creditLedger": return await api.CreditLedger.GetAsCreditLedgerGetResponseAsync(c => { Configure(c.Headers, options); c.QueryParameters.Limit = query["limit"]?.GetValue<int>(); c.QueryParameters.Cursor = query["cursor"]?.GetValue<string>(); if(query["entryType"] is JsonNode type) c.QueryParameters.EntryTypeAsGetEntryTypeQueryParameterType = Enum.Parse<KOtp.Sdk.Generated.CreditLedger.GetEntryTypeQueryParameterType>(type.GetValue<string>(), true); if(query["createdFrom"] is JsonNode from) c.QueryParameters.CreatedFrom = DateTimeOffset.Parse(from.GetValue<string>()); if(query["createdTo"] is JsonNode to) c.QueryParameters.CreatedTo = DateTimeOffset.Parse(to.GetValue<string>()); }, cancel);
                case "balance": return await api.Balance.GetAsBalanceGetResponseAsync(c => Configure(c.Headers, options), cancel);
                case "templates": return await api.Templates.GetAsTemplatesGetResponseAsync(c => Configure(c.Headers, options), cancel);
                case "templateDetail": return await api.Templates[path].GetAsWithTemplateGetResponseAsync(c => Configure(c.Headers, options), cancel);
                default: throw new ArgumentException("Unknown operation");
            }
        }
        try {
            IParsable? value;
            try { value = await Call(); }
            catch (ApiException error) { if(operation == "issue" && options.Retry503 && error.ResponseStatusCode == 503) value = await Call(); else throw; }
            return await Json(value);
        } catch (ApiException error) { throw new KotpApiException(error, await Json(error as IParsable)); }
        catch (OperationCanceledException error) when (!cancel.IsCancellationRequested) { throw new KotpTransportException(error); }
        catch (HttpRequestException error) { throw new KotpTransportException(error); }
    }
    private sealed class OriginHandler(Uri allowed, string key, HttpMessageHandler inner) : DelegatingHandler(inner) {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel) {
            if (request.RequestUri?.GetLeftPart(UriPartial.Authority) != allowed.GetLeftPart(UriPartial.Authority)) throw new ArgumentException("Request destination differs from the configured API origin");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
            return base.SendAsync(request, cancel);
        }
    }
}
