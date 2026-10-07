using System.Text.Json;
using System.Text.Json.Nodes;
using KOtp;
var fixture = JsonNode.Parse(File.ReadAllText(Environment.GetEnvironmentVariable("POC_FIXTURE")!))!;
var observations = new List<object>();
foreach(var raw in fixture["cases"]!.AsArray()) {
    var test = raw!.AsObject(); var query = test["query"]!.AsObject();
    using var client = new KotpClient(fixture["fakeSecretKey"]!.GetValue<string>(), Environment.GetEnvironmentVariable("POC_BASE_URL")!, test["timeoutMs"]?.GetValue<int>() ?? 10000);
    var options = new RequestOptions(new Dictionary<string,string> { ["X-Poc-Case"] = test["id"]!.GetValue<string>() }, "https://poc.example.com", test["explicitRetry"]?.GetValue<bool>() == true);
    var observation = new Dictionary<string,object?> { ["id"] = test["id"]!.GetValue<string>() };
    try {
        observation["response"] = test["operation"]!.GetValue<string>() switch {
            "issue" => await client.IssueAsync(test["request"]!.AsObject(), options),
            "verify" => await client.VerifyAsync(test["request"]!.AsObject(), options),
            "status" => await client.StatusAsync(query["issueId"]!.GetValue<string>(), options),
            "issues" => await client.IssuesAsync(query, options),
            "issueDetail" => await client.IssueDetailAsync(Guid.Parse(test["pathValue"]!.GetValue<string>()), options),
            "creditLedger" => await client.CreditLedgerAsync(query, options),
            "balance" => await client.BalanceAsync(options),
            "templates" => await client.TemplatesAsync(options),
            "templateDetail" => await client.TemplateDetailAsync(test["pathValue"]!.GetValue<string>(), options),
            _ => throw new Exception("Unknown fixture operation")
        };
    } catch (KotpApiException error) { observation["status"] = error.Status; observation["response"] = error.Envelope; observation["headers"] = error.Headers; observation["requestId"] = error.RequestId; observation["retryAfterMs"] = error.RetryAfterMs; }
    catch(KotpTransportException error) { observation["outcome"] = error.Outcome; }
    catch(ArgumentException) { observation["outcome"] = "configuration_error"; }
    observations.Add(observation);
}
File.WriteAllText(Environment.GetEnvironmentVariable("POC_WIRE_RESULT")!, JsonSerializer.Serialize(observations));
