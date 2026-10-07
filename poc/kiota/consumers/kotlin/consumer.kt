import com.google.gson.*
import dev.kotp.sdk.KotpClient
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

fun main() {
    val fixture=JsonParser.parseString(Files.readString(Path.of(System.getenv("POC_FIXTURE")))).asJsonObject
    val observations=JsonArray()
    for(item in fixture.getAsJsonArray("cases")) {
        val test=item.asJsonObject
        val query=test.getAsJsonObject("query")
        val observation=JsonObject().apply { add("id",test.get("id")) }
        KotpClient(fixture.get("fakeSecretKey").asString,System.getenv("POC_BASE_URL"),test.get("timeoutMs")?.asInt ?: 10000).use { client ->
            val options=KotpClient.RequestOptions(mapOf("X-Poc-Case" to test.get("id").asString),"https://poc.example.com",test.get("explicitRetry")?.asBoolean == true)
            try {
                val value=when(test.get("operation").asString) {
                    "issue" -> client.issue(test.getAsJsonObject("request"),options)
                    "verify" -> client.verify(test.getAsJsonObject("request"),options)
                    "status" -> client.status(query.get("issueId").asString,options)
                    "issues" -> client.issues(query,options)
                    "issueDetail" -> client.issueDetail(UUID.fromString(test.get("pathValue").asString),options)
                    "creditLedger" -> client.creditLedger(query,options)
                    "balance" -> client.balance(options)
                    "templates" -> client.templates(options)
                    "templateDetail" -> client.templateDetail(test.get("pathValue").asString,options)
                    else -> error("Unknown fixture operation")
                }
                if(test.get("id").asString=="verify-false") check(value.asJsonObject.get("verified").asBoolean==false)
                observation.add("response",value)
            } catch(error:KotpClient.KotpApiException) {
                observation.addProperty("status",error.status); observation.add("response",error.envelope); observation.add("headers",Gson().toJsonTree(error.headers)); observation.addProperty("requestId",error.requestId); observation.addProperty("retryAfterMs",error.retryAfterMs)
            } catch(error:KotpClient.KotpTransportException) { observation.addProperty("outcome",error.outcome) }
            catch(error:IllegalArgumentException) { observation.addProperty("outcome","configuration_error") }
        }
        observations.add(observation)
    }
    Files.writeString(Path.of(System.getenv("POC_WIRE_RESULT")),observations.toString())
}
