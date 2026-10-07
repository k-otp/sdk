import com.google.gson.*
import com.microsoft.kiota.ApiException
import com.microsoft.kiota.BaseRequestConfiguration
import com.microsoft.kiota.authentication.AnonymousAuthenticationProvider
import com.microsoft.kiota.http.OkHttpRequestAdapter
import com.microsoft.kiota.serialization.*
import dev.kotp.sdk.generated.KOtpApiClient
import dev.kotp.sdk.generated.issue.IssuePostRequestBody
import dev.kotp.sdk.generated.verify.VerifyPostRequestBody
import dev.kotp.sdk.generated.verify.VerifyPostResponse
import dev.kotp.sdk.generated.models.IssueWebOtpOptions
import dev.kotp.sdk.generated.issues.GetVerificationStatusQueryParameterType
import dev.kotp.sdk.generated.creditledger.GetEntryTypeQueryParameterType
import okhttp3.OkHttpClient
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.TimeUnit

fun <T : Parsable> model(value: JsonElement, factory: ParsableFactory<T>): T =
    JsonParseNodeFactory().getParseNode("application/json", ByteArrayInputStream(value.toString().toByteArray(Charsets.UTF_8))).getObjectValue(factory)

fun serialize(value: Any?): JsonElement {
    if (value !is Parsable) return JsonNull.INSTANCE
    JsonSerializationWriter().use { writer ->
        writer.writeObjectValue(null, value)
        return JsonParser.parseString(writer.serializedContent.readAllBytes().toString(Charsets.UTF_8))
    }
}

fun configure(config: BaseRequestConfiguration, test: JsonObject) {
    config.headers.add("X-Poc-Case", test.get("id").asString)
}

// This calls the synchronous methods in the installed Java JAR directly.
fun call(client: KOtpApiClient, test: JsonObject): Parsable? {
    val query = test.getAsJsonObject("query")
    return when (test.get("operation").asString) {
        "issue" -> {
            val input = test.getAsJsonObject("request").deepCopy()
            val key = input.get("idempotencyKey")?.asString?.trim() ?: ""
            require(key.matches(Regex("[!-~]{1,128}"))) { "Invalid idempotency key before HTTP" }
            val webOtp = input.remove("webOtp")
            val body = model(input, IssuePostRequestBody::createFromDiscriminatorValue)
            body.idempotencyKey = key
            if (webOtp != null) {
                val union = IssuePostRequestBody.IssuePostRequestBodyWebOtp()
                if (webOtp.isJsonPrimitive) union.boolean = webOtp.asBoolean
                else union.issueWebOtpOptions = model(webOtp, IssueWebOtpOptions::createFromDiscriminatorValue)
                body.webOtp = union
                if (webOtp.isJsonPrimitive) check(body.webOtp?.boolean == webOtp.asBoolean)
                else check(body.webOtp?.issueWebOtpOptions?.origin == webOtp.asJsonObject.get("origin").asString)
            }
            client.issue().post(body) { c -> configure(c, test); c.headers.add("Idempotency-Key", key); c.headers.add("Origin", "https://poc.example.com") }
        }
        "verify" -> client.verify().post(model(test.get("request"), VerifyPostRequestBody::createFromDiscriminatorValue)) { c -> configure(c, test) }
        "status" -> client.status().get { c -> configure(c, test); c.queryParameters.issueId = query.get("issueId").asString }
        "issues" -> client.issues().get { c -> configure(c, test); c.queryParameters.limit = query.get("limit").asInt; c.queryParameters.cursor = query.get("cursor")?.asString; c.queryParameters.verificationStatus = GetVerificationStatusQueryParameterType.forValue(query.get("verificationStatus").asString) }
        "issueDetail" -> client.issues().byIssueId(UUID.fromString(test.get("pathValue").asString)).get { c -> configure(c, test) }
        "creditLedger" -> client.creditLedger().get { c -> configure(c, test); c.queryParameters.limit = query.get("limit").asInt; c.queryParameters.entryType = GetEntryTypeQueryParameterType.forValue(query.get("entryType").asString) }
        "balance" -> client.balance().get { c -> configure(c, test) }
        "templates" -> client.templates().get { c -> configure(c, test) }
        "templateDetail" -> client.templates().byTemplateId(test.get("pathValue").asString).get { c -> configure(c, test) }
        else -> error("Unknown operation")
    }
}

fun main() {
    val fixture = JsonParser.parseString(Files.readString(Path.of(System.getenv("POC_FIXTURE")))).asJsonObject
    val base = System.getenv("POC_BASE_URL")
    val key = fixture.get("fakeSecretKey").asString
    require(key.startsWith("sk_") && base.startsWith("http://127.0.0.1:"))
    val observations = JsonArray()
    for (item in fixture.getAsJsonArray("cases")) {
        val test = item.asJsonObject
        val observation = JsonObject().apply { add("id", test.get("id")) }
        val http = (if (test.has("defaultRetryProbe")) com.microsoft.kiota.http.KiotaClientFactory.create() else OkHttpClient.Builder()).retryOnConnectionFailure(false).callTimeout(test.get("timeoutMs")?.asLong ?: 10000L, TimeUnit.MILLISECONDS).addInterceptor { chain ->
            if (chain.request().url.host != "127.0.0.1" || chain.request().url.port != URI.create(base).port) throw IOException("Unexpected external network destination")
            chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer $key").build())
        }.build()
        val adapter = OkHttpRequestAdapter(AnonymousAuthenticationProvider(), null, null, http).apply { baseUrl = base }
        val client = KOtpApiClient(adapter)
        try {
            val value = try { call(client, test) } catch (error: ApiException) {
                if (test.get("explicitRetry")?.asBoolean == true && error.responseStatusCode == 503) call(client, test) else throw error
            }
            if (test.get("id").asString == "verify-false") check((value as VerifyPostResponse?)?.verified == false)
            observation.add("response", serialize(value))
        } catch (error: ApiException) {
            observation.addProperty("status", error.responseStatusCode)
            observation.add("headers", Gson().toJsonTree(error.responseHeaders))
            observation.add("response", serialize(error))
            observation.addProperty("exception", error.javaClass.simpleName)
        } catch (error: IllegalArgumentException) {
            observation.addProperty("outcome", "configuration_error")
        } catch (error: Exception) {
            observation.addProperty("outcome", if (test.has("timeoutMs")) "unknown" else "unexpected_exception")
            observation.addProperty("exception", error.javaClass.simpleName)
        } finally {
            http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
        }
        observations.add(observation)
    }
    Files.writeString(Path.of(System.getenv("POC_WIRE_RESULT")), observations.toString())
}
