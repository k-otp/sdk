import com.google.gson.*;
import dev.kotp.sdk.preview.KotpClient;
import java.nio.file.*;
import java.util.*;

class WireConsumer {
    public static void main(String[] args) throws Exception {
        JsonObject fixture = JsonParser.parseString(Files.readString(Path.of(System.getenv("POC_FIXTURE")))).getAsJsonObject();
        JsonArray observations = new JsonArray();
        for(JsonElement item:fixture.getAsJsonArray("cases")) {
            JsonObject test=item.getAsJsonObject(), query=test.getAsJsonObject("query"), observation=new JsonObject(); observation.add("id",test.get("id"));
            try(KotpClient client=new KotpClient(fixture.get("fakeSecretKey").getAsString(),System.getenv("POC_BASE_URL"),test.has("timeoutMs")?test.get("timeoutMs").getAsInt():10000)) {
                KotpClient.RequestOptions options=new KotpClient.RequestOptions(Map.of("X-Poc-Case",test.get("id").getAsString()),"https://poc.example.com",test.has("explicitRetry")&&test.get("explicitRetry").getAsBoolean());
                try {
                    JsonElement value=switch(test.get("operation").getAsString()) {
                        case "issue" -> client.issue(test.getAsJsonObject("request"),options);
                        case "verify" -> client.verify(test.getAsJsonObject("request"),options);
                        case "status" -> client.status(query.get("issueId").getAsString(),options);
                        case "issues" -> client.issues(query,options);
                        case "issueDetail" -> client.issueDetail(UUID.fromString(test.get("pathValue").getAsString()),options);
                        case "creditLedger" -> client.creditLedger(query,options);
                        case "balance" -> client.balance(options);
                        case "templates" -> client.templates(options);
                        case "templateDetail" -> client.templateDetail(test.get("pathValue").getAsString(),options);
                        default -> throw new IllegalStateException("Unknown fixture operation");
                    };
                    observation.add("response",value);
                } catch(KotpClient.KotpApiException error) { observation.addProperty("status",error.status); observation.add("response",error.envelope); observation.add("headers",new Gson().toJsonTree(error.headers)); observation.addProperty("requestId",error.requestId); observation.addProperty("retryAfterMs",error.retryAfterMs); }
                catch(KotpClient.KotpTransportException error) { observation.addProperty("outcome",error.outcome); }
                catch(IllegalArgumentException error) { observation.addProperty("outcome","configuration_error"); }
            }
            observations.add(observation);
        }
        Files.writeString(Path.of(System.getenv("POC_WIRE_RESULT")),observations.toString());
    }
}
