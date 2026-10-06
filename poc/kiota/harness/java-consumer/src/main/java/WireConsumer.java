import com.google.gson.*;
import com.microsoft.kiota.ApiException;
import com.microsoft.kiota.BaseRequestConfiguration;
import com.microsoft.kiota.authentication.AnonymousAuthenticationProvider;
import com.microsoft.kiota.http.OkHttpRequestAdapter;
import com.microsoft.kiota.serialization.*;
import dev.kotp.sdk.generated.KOtpApiClient;
import dev.kotp.sdk.generated.issue.IssuePostRequestBody;
import dev.kotp.sdk.generated.models.IssueWebOtpOptions;
import dev.kotp.sdk.generated.verify.VerifyPostRequestBody;
import dev.kotp.sdk.generated.issues.GetVerificationStatusQueryParameterType;
import dev.kotp.sdk.generated.creditledger.GetEntryTypeQueryParameterType;
import okhttp3.OkHttpClient;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Independent JAR consumer; deliberately uses synchronous Java builders. */
public class WireConsumer {
    public static <T extends Parsable> T model(JsonElement value, ParsableFactory<T> factory) {
        return new JsonParseNodeFactory().getParseNode("application/json", new ByteArrayInputStream(value.toString().getBytes(StandardCharsets.UTF_8))).getObjectValue(factory);
    }
    public static JsonElement serialize(Object value) throws IOException {
        if (!(value instanceof Parsable)) return JsonNull.INSTANCE;
        try (JsonSerializationWriter writer = new JsonSerializationWriter()) {
            writer.writeObjectValue(null, (Parsable)value);
            return JsonParser.parseString(new String(writer.getSerializedContent().readAllBytes(), StandardCharsets.UTF_8));
        }
    }
    public static void configure(BaseRequestConfiguration config, JsonObject test) {
        config.headers.add("X-Poc-Case", test.get("id").getAsString());
    }
    public static Object call(KOtpApiClient client, JsonObject test) {
        String operation = test.get("operation").getAsString();
        JsonObject q = test.getAsJsonObject("query");
        switch (operation) {
            case "issue": {
                JsonObject request = test.getAsJsonObject("request");
                String key = request.has("idempotencyKey") ? request.get("idempotencyKey").getAsString().trim() : "";
                if (!key.matches("[!-~]{1,128}")) throw new IllegalArgumentException("Invalid issue idempotency key before HTTP");
                JsonObject input = request.deepCopy();
                JsonElement webOtp = input.remove("webOtp");
                IssuePostRequestBody body = model(input, IssuePostRequestBody::createFromDiscriminatorValue);
                if (webOtp != null) {
                    IssuePostRequestBody.IssuePostRequestBodyWebOtp wrapper = new IssuePostRequestBody.IssuePostRequestBodyWebOtp();
                    if (webOtp.isJsonPrimitive()) wrapper.setBoolean(webOtp.getAsBoolean());
                    else wrapper.setIssueWebOtpOptions(model(webOtp, IssueWebOtpOptions::createFromDiscriminatorValue));
                    body.setWebOtp(wrapper);
                }
                body.setIdempotencyKey(key);
                return client.issue().post(body, c -> { configure(c,test); c.headers.add("Idempotency-Key", key); c.headers.add("Origin", "https://poc.example.com"); });
            }
            case "verify": return client.verify().post(model(test.get("request"), VerifyPostRequestBody::createFromDiscriminatorValue), c -> configure(c,test));
            case "status": return client.status().get(c -> { configure(c,test); c.queryParameters.issueId = q.get("issueId").getAsString(); });
            case "issues": return client.issues().get(c -> { configure(c,test); c.queryParameters.limit=q.get("limit").getAsInt(); c.queryParameters.cursor=q.has("cursor")?q.get("cursor").getAsString():null; c.queryParameters.verificationStatus=GetVerificationStatusQueryParameterType.forValue(q.get("verificationStatus").getAsString()); });
            case "issueDetail": return client.issues().byIssueId(UUID.fromString(test.get("pathValue").getAsString())).get(c -> configure(c,test));
            case "creditLedger": return client.creditLedger().get(c -> { configure(c,test); c.queryParameters.limit=q.get("limit").getAsInt(); c.queryParameters.entryType=GetEntryTypeQueryParameterType.forValue(q.get("entryType").getAsString()); });
            case "balance": return client.balance().get(c -> configure(c,test));
            case "templates": return client.templates().get(c -> configure(c,test));
            case "templateDetail": return client.templates().byTemplateId(test.get("pathValue").getAsString()).get(c -> configure(c,test));
            default: throw new IllegalArgumentException("Unknown operation");
        }
    }
    public static void main(String[] args) throws Exception {
        JsonObject fixture = JsonParser.parseString(Files.readString(Path.of(System.getenv("POC_FIXTURE")))).getAsJsonObject();
        String base = System.getenv("POC_BASE_URL");
        String key = fixture.get("fakeSecretKey").getAsString();
        if (!key.startsWith("sk_") || !base.startsWith("http://127.0.0.1:")) throw new IllegalArgumentException("Secret key and loopback URL required");
        JsonArray observations = new JsonArray();
        for (JsonElement item : fixture.getAsJsonArray("cases")) {
            JsonObject test = item.getAsJsonObject();
            JsonObject observation = new JsonObject(); observation.add("id", test.get("id"));
            OkHttpClient http = (test.has("defaultRetryProbe") ? com.microsoft.kiota.http.KiotaClientFactory.create() : new OkHttpClient.Builder()).retryOnConnectionFailure(false).callTimeout(test.has("timeoutMs") ? test.get("timeoutMs").getAsInt() : 10000, TimeUnit.MILLISECONDS)
                .addInterceptor(chain -> {
                    if (!chain.request().url().host().equals("127.0.0.1") || chain.request().url().port() != java.net.URI.create(base).getPort()) throw new IOException("Unexpected external network destination");
                    return chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer " + key).build());
                }).build();
            OkHttpRequestAdapter adapter = new OkHttpRequestAdapter(new AnonymousAuthenticationProvider(), null, null, http);
            adapter.setBaseUrl(base);
            KOtpApiClient client = new KOtpApiClient(adapter);
            try {
                Object value;
                try { value = call(client,test); }
                catch (ApiException error) { if (test.has("explicitRetry") && error.getResponseStatusCode()==503) value=call(client,test); else throw error; }
                observation.add("response", serialize(value));
            } catch (ApiException error) {
                observation.addProperty("status", error.getResponseStatusCode());
                observation.add("headers", new Gson().toJsonTree(error.getResponseHeaders()));
                observation.add("response", serialize(error));
                observation.addProperty("exception", error.getClass().getSimpleName()); observation.addProperty("diagnostic", error.getMessage());
            } catch (IllegalArgumentException error) {
                observation.addProperty("outcome", "configuration_error");
                observation.addProperty("exception", error.getClass().getSimpleName()); observation.addProperty("diagnostic", error.getMessage());
            } catch (Exception error) {
                observation.addProperty("outcome", test.has("timeoutMs") ? "unknown" : "unexpected_exception");
                observation.addProperty("exception", error.getClass().getSimpleName()); observation.addProperty("diagnostic", error.getMessage());
            } finally {
                http.dispatcher().executorService().shutdown(); http.connectionPool().evictAll();
            }
            observations.add(observation);
        }
        Files.writeString(Path.of(System.getenv("POC_WIRE_RESULT")), observations.toString());
    }
}
