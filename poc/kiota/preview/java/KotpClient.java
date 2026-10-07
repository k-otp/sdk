package dev.kotp.sdk.preview;
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
import java.util.*;
import okhttp3.HttpUrl;
import java.util.UUID;
import java.util.concurrent.TimeUnit;


public final class KotpClient implements AutoCloseable {
    private final OkHttpClient http;
    private final KOtpApiClient client;
    public record RequestOptions(Map<String,String> headers, String origin, boolean retry503) {
        public RequestOptions { headers = headers == null ? Map.of() : Map.copyOf(headers); }
        public RequestOptions() { this(Map.of(), null, false); }
    }
    public static final class KotpApiException extends RuntimeException {
        public final int status;
        public final JsonObject envelope;
        public final Map<String,List<String>> headers;
        public final String requestId;
        public final Double retryAfterMs;
        private KotpApiException(ApiException error, JsonElement response) {
            super(response.isJsonObject() && response.getAsJsonObject().has("message") ? response.getAsJsonObject().get("message").getAsString() : "K-OTP API request failed", error);
            status = error.getResponseStatusCode(); envelope = response.isJsonObject() ? response.getAsJsonObject() : new JsonObject();
            Map<String,List<String>> values = new LinkedHashMap<>();
            if(error.getResponseHeaders()!=null) error.getResponseHeaders().forEach((key,value) -> values.put(key.toLowerCase(Locale.ROOT), List.copyOf(value)));
            headers = Collections.unmodifiableMap(values);
            requestId = first(headers.get("x-request-id"));
            JsonElement data = envelope.get("data");
            Double ms = data!=null && data.isJsonObject() && data.getAsJsonObject().has("retryAfterMs") ? data.getAsJsonObject().get("retryAfterMs").getAsDouble() : null;
            String seconds = first(headers.get("retry-after"));
            retryAfterMs = ms!=null && Double.isFinite(ms) && ms>=0 ? ms : seconds!=null && seconds.matches("[0-9]+") ? Double.parseDouble(seconds)*1000 : null;
        }
        private static String first(List<String> values) { return values==null || values.isEmpty() ? null : values.get(0); }
    }
    public static final class KotpTransportException extends RuntimeException {
        public final String outcome = "unknown";
        private KotpTransportException(Throwable cause) { super("The request outcome is unknown", cause); }
    }
    public KotpClient(String apiKey) { this(apiKey, "https://api.k-otp.dev/v1", 10000); }
    public KotpClient(String apiKey, String baseUrl, int timeoutMs) {
        if(!apiKey.matches("sk_[!-~]+")) throw new IllegalArgumentException("A server secret key is required");
        HttpUrl base = HttpUrl.get(baseUrl);
        if(!base.username().isEmpty() || !base.password().isEmpty() || base.query()!=null || base.fragment()!=null || !(base.isHttps() || base.scheme().equals("http") && base.host().equals("127.0.0.1"))) throw new IllegalArgumentException("An HTTPS API base URL or loopback HTTP URL is required");
        if(timeoutMs<=0) throw new IllegalArgumentException("timeoutMs must be positive");
        http = new OkHttpClient.Builder().retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).callTimeout(timeoutMs, TimeUnit.MILLISECONDS).addInterceptor(chain -> {
            HttpUrl url = chain.request().url();
            if(!url.host().equals(base.host()) || url.port()!=base.port() || !url.scheme().equals(base.scheme())) throw new IllegalArgumentException("Request destination differs from the configured API origin");
            return chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer "+apiKey).build());
        }).build();
        OkHttpRequestAdapter adapter = new OkHttpRequestAdapter(new AnonymousAuthenticationProvider(), null, null, http);
        adapter.setBaseUrl(baseUrl); client = new KOtpApiClient(adapter);
    }
    public void close() { http.dispatcher().executorService().shutdown(); http.connectionPool().evictAll(); }
    public JsonElement issue(JsonObject input, RequestOptions options) { return send("issue", input, new JsonObject(), "", options); }
    public JsonElement verify(JsonObject input, RequestOptions options) { return send("verify", input, new JsonObject(), "", options); }
    public JsonElement status(String issueId, RequestOptions options) { JsonObject q=new JsonObject(); q.addProperty("issueId",issueId); return send("status",new JsonObject(),q,"",options); }
    public JsonElement issues(JsonObject query, RequestOptions options) { return send("issues",new JsonObject(),query,"",options); }
    public JsonElement issueDetail(UUID issueId, RequestOptions options) { return send("issueDetail",new JsonObject(),new JsonObject(),issueId.toString(),options); }
    public JsonElement creditLedger(JsonObject query, RequestOptions options) { return send("creditLedger",new JsonObject(),query,"",options); }
    public JsonElement balance(RequestOptions options) { return send("balance",new JsonObject(),new JsonObject(),"",options); }
    public JsonElement templates(RequestOptions options) { return send("templates",new JsonObject(),new JsonObject(),"",options); }
    public JsonElement templateDetail(String templateId, RequestOptions options) { return send("templateDetail",new JsonObject(),new JsonObject(),templateId,options); }
    public JsonElement issue(JsonObject input) { return issue(input,new RequestOptions()); }
    public JsonElement verify(JsonObject input) { return verify(input,new RequestOptions()); }
    public JsonElement status(String id) { return status(id,new RequestOptions()); }
    public JsonElement issues(JsonObject query) { return issues(query,new RequestOptions()); }
    public JsonElement issueDetail(UUID id) { return issueDetail(id,new RequestOptions()); }
    public JsonElement creditLedger(JsonObject query) { return creditLedger(query,new RequestOptions()); }
    public JsonElement balance() { return balance(new RequestOptions()); }
    public JsonElement templates() { return templates(new RequestOptions()); }
    public JsonElement templateDetail(String id) { return templateDetail(id,new RequestOptions()); }
    private JsonElement send(String operation, JsonObject input, JsonObject query, String path, RequestOptions options) {
        input = input.deepCopy(); query = query==null ? new JsonObject() : query.deepCopy();
        for(String name:options.headers().keySet()) if(name.equalsIgnoreCase("Authorization") || name.equalsIgnoreCase("Idempotency-Key")) throw new IllegalArgumentException("Authentication and idempotency headers are managed by the client");
        try {
            Object value;
            try { value=call(operation,input,query,path,options); }
            catch(ApiException error) { if(operation.equals("issue") && options.retry503() && error.getResponseStatusCode()==503) value=call(operation,input,query,path,options); else throw error; }
            return serialize(value);
        } catch(ApiException error) {
            try { throw new KotpApiException(error,serialize(error)); } catch(IOException failure) { throw new IllegalStateException("API error could not be read",failure); }
        } catch(IOException error) { throw new KotpTransportException(error); }
        catch(RuntimeException error) {
            for(Throwable cause=error;cause!=null;cause=cause.getCause()) if(cause instanceof IOException) throw new KotpTransportException(error);
            throw error;
        }
    }
    private static <T extends Parsable> T model(JsonElement value, ParsableFactory<T> factory) {
        return new JsonParseNodeFactory().getParseNode("application/json", new ByteArrayInputStream(value.toString().getBytes(StandardCharsets.UTF_8))).getObjectValue(factory);
    }
    private static JsonElement serialize(Object value) throws IOException {
        if(!(value instanceof Parsable)) return JsonNull.INSTANCE;
        try(JsonSerializationWriter writer=new JsonSerializationWriter()) { writer.writeObjectValue(null,(Parsable)value); return JsonParser.parseString(new String(writer.getSerializedContent().readAllBytes(),StandardCharsets.UTF_8)); }
    }
    private static void configure(BaseRequestConfiguration config, RequestOptions options) { options.headers().forEach((key,value)->config.headers.add(key,value)); }
    private Object call(String operation, JsonObject request, JsonObject q, String path, RequestOptions options) {
        switch (operation) {
            case "issue": {
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
                return client.issue().post(body, c -> { configure(c,options); c.headers.add("Idempotency-Key", key); if(options.origin()!=null) c.headers.add("Origin", options.origin()); });
            }
            case "verify": return client.verify().post(model(request, VerifyPostRequestBody::createFromDiscriminatorValue), c -> configure(c,options));
            case "status": return client.status().get(c -> { configure(c,options); c.queryParameters.issueId = q.get("issueId").getAsString(); });
            case "issues": return client.issues().get(c -> { configure(c,options); c.queryParameters.limit=q.has("limit") ? q.get("limit").getAsInt() : null; c.queryParameters.cursor=q.has("cursor")?q.get("cursor").getAsString():null; if(q.has("createdFrom")) c.queryParameters.createdFrom=java.time.OffsetDateTime.parse(q.get("createdFrom").getAsString()); if(q.has("createdTo")) c.queryParameters.createdTo=java.time.OffsetDateTime.parse(q.get("createdTo").getAsString()); c.queryParameters.verificationStatus=q.has("verificationStatus") ? GetVerificationStatusQueryParameterType.forValue(q.get("verificationStatus").getAsString()) : null; });
            case "issueDetail": return client.issues().byIssueId(UUID.fromString(path)).get(c -> configure(c,options));
            case "creditLedger": return client.creditLedger().get(c -> { configure(c,options); c.queryParameters.limit=q.has("limit") ? q.get("limit").getAsInt() : null; c.queryParameters.cursor=q.has("cursor")?q.get("cursor").getAsString():null; if(q.has("createdFrom")) c.queryParameters.createdFrom=java.time.OffsetDateTime.parse(q.get("createdFrom").getAsString()); if(q.has("createdTo")) c.queryParameters.createdTo=java.time.OffsetDateTime.parse(q.get("createdTo").getAsString()); c.queryParameters.entryType=q.has("entryType") ? GetEntryTypeQueryParameterType.forValue(q.get("entryType").getAsString()) : null; });
            case "balance": return client.balance().get(c -> configure(c,options));
            case "templates": return client.templates().get(c -> configure(c,options));
            case "templateDetail": return client.templates().byTemplateId(path).get(c -> configure(c,options));
            default: throw new IllegalArgumentException("Unknown operation");
        }
    }
}
