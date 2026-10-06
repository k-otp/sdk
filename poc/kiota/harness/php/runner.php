<?php
// Installed-package consumer. All HTTP requests use the real Guzzle adapter.
require __DIR__ . '/vendor/autoload.php';

use GuzzleHttp\Client;
use GuzzleHttp\Handler\CurlHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Utils;
use KOtp\Sdk\Generated\KOtpApiClient;
use KOtp\Sdk\Generated\Issue\IssuePostRequestBody;
use KOtp\Sdk\Generated\Issue\IssuePostRequestBody_webOtp;
use KOtp\Sdk\Generated\Models\IssueWebOtpOptions;
use KOtp\Sdk\Generated\Verify\VerifyPostRequestBody;
use Microsoft\Kiota\Abstractions\ApiException;
use Microsoft\Kiota\Abstractions\Authentication\AnonymousAuthenticationProvider;
use Microsoft\Kiota\Abstractions\Serialization\Parsable;
use Microsoft\Kiota\Http\GuzzleRequestAdapter;
use Microsoft\Kiota\Serialization\Json\JsonParseNodeFactory;
use Microsoft\Kiota\Serialization\Json\JsonSerializationWriter;

function model(array $value, string $class): Parsable {
    $node = (new JsonParseNodeFactory())->getRootParseNode('application/json', Utils::streamFor(json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)));
    return $node->getObjectValue([$class, 'createFromDiscriminatorValue']);
}
function serializeModel($value) {
    if (!$value instanceof Parsable) return null;
    $writer = new JsonSerializationWriter();
    $writer->writeObjectValue(null, $value);
    return json_decode((string)$writer->getSerializedContent(), true, 512, JSON_THROW_ON_ERROR);
}
function config(string $name, array $test, $query = null) {
    $class = 'KOtp\\Sdk\\Generated\\' . $name;
    $headers = ['X-Poc-Case' => $test['id']];
    if ($test['operation'] === 'issue') {
        $headers['Idempotency-Key'] = trim($test['request']['idempotencyKey'] ?? '');
        $headers['Origin'] = 'https://poc.example.com';
    }
    $value = new $class($headers);
    if ($query !== null) $value->queryParameters = $query;
    return $value;
}
function callClient(KOtpApiClient $client, array $test) {
    $query = $test['query'];
    switch ($test['operation']) {
        case 'issue':
            $input = $test['request'];
            $key = trim($input['idempotencyKey'] ?? '');
            if (preg_match('/^[!-~]{1,128}$/D', $key) !== 1) throw new InvalidArgumentException('Invalid idempotency key before HTTP');
            $hasWebOtp = array_key_exists('webOtp', $input); $webOtp = $input['webOtp'] ?? null; unset($input['webOtp']);
            $body = model($input, IssuePostRequestBody::class); $body->setIdempotencyKey($key);
            if ($hasWebOtp) {
                $wrapper = new IssuePostRequestBody_webOtp();
                if (is_bool($webOtp)) $wrapper->setBoolean($webOtp);
                else $wrapper->setIssueWebOtpOptions(model($webOtp, IssueWebOtpOptions::class));
                $body->setWebOtp($wrapper);
            }
            return $client->issue()->post($body, config('Issue\\IssueRequestBuilderPostRequestConfiguration', $test))->wait();
        case 'verify': return $client->verify()->post(model($test['request'], VerifyPostRequestBody::class), config('Verify\\VerifyRequestBuilderPostRequestConfiguration', $test))->wait();
        case 'status':
            $params = new \KOtp\Sdk\Generated\Status\StatusRequestBuilderGetQueryParameters(); $params->issueId = $query['issueId'];
            return $client->status()->get(config('Status\\StatusRequestBuilderGetRequestConfiguration', $test, $params))->wait();
        case 'issues':
            $params = new \KOtp\Sdk\Generated\Issues\IssuesRequestBuilderGetQueryParameters(); $params->limit = $query['limit']; $params->cursor = $query['cursor'] ?? null;
            $params->verificationStatus = new \KOtp\Sdk\Generated\Issues\GetVerificationStatusQueryParameterType($query['verificationStatus']);
            return $client->issues()->get(config('Issues\\IssuesRequestBuilderGetRequestConfiguration', $test, $params))->wait();
        case 'issueDetail': return $client->issues()->byIssueId($test['pathValue'])->get(config('Issues\\Item\\WithIssueItemRequestBuilderGetRequestConfiguration', $test))->wait();
        case 'creditLedger':
            $params = new \KOtp\Sdk\Generated\CreditLedger\CreditLedgerRequestBuilderGetQueryParameters(); $params->limit = $query['limit'];
            $params->entryType = new \KOtp\Sdk\Generated\CreditLedger\GetEntryTypeQueryParameterType($query['entryType']);
            return $client->creditLedger()->get(config('CreditLedger\\CreditLedgerRequestBuilderGetRequestConfiguration', $test, $params))->wait();
        case 'balance': return $client->balance()->get(config('Balance\\BalanceRequestBuilderGetRequestConfiguration', $test))->wait();
        case 'templates': return $client->templates()->get(config('Templates\\TemplatesRequestBuilderGetRequestConfiguration', $test))->wait();
        case 'templateDetail': return $client->templates()->byTemplateId($test['pathValue'])->get(config('Templates\\Item\\WithTemplateItemRequestBuilderGetRequestConfiguration', $test))->wait();
        default: throw new RuntimeException('Unknown operation');
    }
}

$fixture = json_decode(file_get_contents(getenv('POC_FIXTURE')), true, 512, JSON_THROW_ON_ERROR);
$base = getenv('POC_BASE_URL'); $key = $fixture['fakeSecretKey'];
if (!str_starts_with($key, 'sk_') || !str_starts_with($base, 'http://127.0.0.1:')) throw new InvalidArgumentException('Secret key and loopback URL required');
$observations = [];
foreach ($fixture['cases'] as $test) {
    $observation = ['id' => $test['id']];
    $curl = new CurlHandler();
    $guard = function ($request, $options) use ($curl, $base) {
        if ($request->getUri()->getHost() !== '127.0.0.1' || $request->getUri()->getPort() !== parse_url($base, PHP_URL_PORT)) throw new RuntimeException('Unexpected external network destination');
        return $curl($request, $options);
    };
    $stack = ($test['defaultRetryProbe'] ?? false) ? \Microsoft\Kiota\Http\KiotaClientFactory::getDefaultHandlerStack() : HandlerStack::create($guard);
    $stack->setHandler($guard);
    $http = new Client(['handler' => $stack, 'http_errors' => false, 'headers' => ['Authorization' => 'Bearer ' . $key], 'timeout' => ($test['timeoutMs'] ?? 10000) / 1000]);
    $adapter = new GuzzleRequestAdapter(new AnonymousAuthenticationProvider(), null, null, $http); $adapter->setBaseUrl($base);
    $client = new KOtpApiClient($adapter);
    try {
        try { $value = callClient($client, $test); }
        catch (ApiException $error) { if (($test['explicitRetry'] ?? false) && $error->getResponseStatusCode() === 503) $value = callClient($client, $test); else throw $error; }
        $observation['response'] = serializeModel($value);
    } catch (ApiException $error) {
        $observation += ['response' => serializeModel($error), 'status' => $error->getResponseStatusCode(), 'headers' => $error->getResponseHeaders(), 'exception' => get_class($error)];
    } catch (InvalidArgumentException $error) {
        $observation += ['outcome' => 'configuration_error', 'exception' => get_class($error)];
    } catch (Throwable $error) {
        $observation += ['outcome' => isset($test['timeoutMs']) ? 'unknown' : 'unexpected_exception', 'exception' => get_class($error), 'diagnostic' => $error->getMessage()];
    }
    $observations[] = $observation;
}
file_put_contents(getenv('POC_WIRE_RESULT'), json_encode($observations, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
