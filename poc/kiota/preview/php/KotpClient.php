<?php
declare(strict_types=1);
namespace KOtp\Preview;
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


final class KotpApiError extends \RuntimeException {
    public readonly int $status;
    public readonly object $envelope;
    public readonly array $headers;
    public readonly ?string $requestId;
    public readonly int|float|null $retryAfterMs;
    public function __construct(ApiException $error, object $envelope) {
        parent::__construct($envelope->message ?? 'K-OTP API request failed', 0, $error);
        $this->status=$error->getResponseStatusCode(); $this->envelope=$envelope;
        $headers=[]; foreach($error->getResponseHeaders() ?? [] as $key=>$value) $headers[strtolower($key)]=is_array($value)?$value:[$value]; $this->headers=$headers;
        $this->requestId=$headers['x-request-id'][0] ?? null;
        $ms=$envelope->data->retryAfterMs ?? null; $seconds=$headers['retry-after'][0] ?? '';
        $this->retryAfterMs=(is_int($ms)||is_float($ms)) && is_finite((float)$ms) && $ms>=0 ? $ms : (ctype_digit((string)$seconds) ? ((int)$seconds)*1000 : null);
    }
}
final class KotpTransportError extends \RuntimeException {
    public readonly string $outcome;
    public function __construct(\Throwable $cause) { parent::__construct('The request outcome is unknown',0,$cause); $this->outcome='unknown'; }
}
final class KotpClient {
    private KOtpApiClient $api;
    public function __construct(string $apiKey, string $baseUrl='https://api.k-otp.dev/v1', int $timeoutMs=10000) {
        if(preg_match('/^sk_[!-~]+$/D',$apiKey)!==1) throw new \InvalidArgumentException('A server secret key is required');
        $base=parse_url($baseUrl);
        if(!$base || isset($base['user']) || isset($base['pass']) || isset($base['query']) || isset($base['fragment']) || !(($base['scheme'] ?? '')==='https' || (($base['scheme'] ?? '')==='http' && ($base['host'] ?? '')==='127.0.0.1'))) throw new \InvalidArgumentException('An HTTPS API base URL or loopback HTTP URL is required');
        if($timeoutMs<=0) throw new \InvalidArgumentException('timeoutMs must be positive');
        $curl=new CurlHandler();
        $guard=function($request,$options) use($curl,$base,$apiKey) {
            $uri=$request->getUri(); $port=$base['port'] ?? ($base['scheme']==='https'?443:80);
            if($uri->getScheme()!==$base['scheme'] || $uri->getHost()!==$base['host'] || ($uri->getPort() ?? ($uri->getScheme()==='https'?443:80))!==$port) throw new \InvalidArgumentException('Request destination differs from the configured API origin');
            return $curl($request->withHeader('Authorization','Bearer '.$apiKey),$options);
        };
        $http=new Client(['handler'=>HandlerStack::create($guard),'http_errors'=>false,'allow_redirects'=>false,'timeout'=>$timeoutMs/1000]);
        $adapter=new GuzzleRequestAdapter(new AnonymousAuthenticationProvider(),null,null,$http); $adapter->setBaseUrl($baseUrl); $this->api=new KOtpApiClient($adapter);
    }
    public function issue(array $input,array $options=[]):mixed { return $this->send('issue',$input,[],'',$options); }
    public function verify(array $input,array $options=[]):mixed { return $this->send('verify',$input,[],'',$options); }
    public function status(string $issueId,array $options=[]):mixed { return $this->send('status',[],['issueId'=>$issueId],'',$options); }
    public function issues(array $query=[],array $options=[]):mixed { return $this->send('issues',[],$query,'',$options); }
    public function issueDetail(string $issueId,array $options=[]):mixed { return $this->send('issueDetail',[],[],$issueId,$options); }
    public function creditLedger(array $query=[],array $options=[]):mixed { return $this->send('creditLedger',[],$query,'',$options); }
    public function balance(array $options=[]):mixed { return $this->send('balance',[],[],'',$options); }
    public function templates(array $options=[]):mixed { return $this->send('templates',[],[],'',$options); }
    public function templateDetail(string $templateId,array $options=[]):mixed { return $this->send('templateDetail',[],[],$templateId,$options); }
    private static function model(array $value,string $class):Parsable {
        $node=(new JsonParseNodeFactory())->getRootParseNode('application/json',Utils::streamFor(json_encode($value,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)));
        return $node->getObjectValue([$class,'createFromDiscriminatorValue']);
    }
    private static function json(mixed $value):mixed {
        if(!$value instanceof Parsable) return null;
        $writer=new JsonSerializationWriter(); $writer->writeObjectValue(null,$value);
        return json_decode((string)$writer->getSerializedContent(),false,512,JSON_THROW_ON_ERROR);
    }
    private function config(string $name,array $options,$query=null) {
        $class='KOtp\\Sdk\\Generated\\'.$name; $config=new $class($options['headers'] ?? []);
        if($query!==null) $config->queryParameters=$query;
        return $config;
    }
    private function send(string $operation,array $input,array $query,string $path,array $options):mixed {
        foreach(array_keys($options['headers'] ?? []) as $name) if(in_array(strtolower($name),['authorization','idempotency-key'],true)) throw new \InvalidArgumentException('Authentication and idempotency headers are managed by the client');
        if($operation==='issue') {
            $key=isset($input['idempotencyKey'])&&is_string($input['idempotencyKey'])?trim($input['idempotencyKey']):'';
            if(preg_match('/^[!-~]{1,128}$/D',$key)!==1) throw new \InvalidArgumentException('Invalid issue idempotency key before HTTP');
            $input['idempotencyKey']=$key; $options['headers']['Idempotency-Key']=$key;
            if(isset($options['origin'])) $options['headers']['Origin']=$options['origin'];
        }
        try {
            try { $value=$this->call($operation,$input,$query,$path,$options); }
            catch(ApiException $error) { if($operation==='issue' && ($options['retry503'] ?? false) && $error->getResponseStatusCode()===503) $value=$this->call($operation,$input,$query,$path,$options); else throw $error; }
            return self::json($value);
        } catch(ApiException $error) { throw new KotpApiError($error,self::json($error)); }
        catch(\GuzzleHttp\Exception\TransferException $error) { throw new KotpTransportError($error); }
    }
private function call(string $operation, array $input, array $query, string $path, array $options) {
    $client = $this->api;
    switch ($operation) {
        case 'issue':
            $key = trim($input['idempotencyKey'] ?? '');
            if (preg_match('/^[!-~]{1,128}$/D', $key) !== 1) throw new InvalidArgumentException('Invalid idempotency key before HTTP');
            $hasWebOtp = array_key_exists('webOtp', $input); $webOtp = $input['webOtp'] ?? null; unset($input['webOtp']);
            $body = self::model($input, IssuePostRequestBody::class); $body->setIdempotencyKey($key);
            if ($hasWebOtp) {
                $wrapper = new IssuePostRequestBody_webOtp();
                if (is_bool($webOtp)) $wrapper->setBoolean($webOtp);
                else $wrapper->setIssueWebOtpOptions(self::model($webOtp, IssueWebOtpOptions::class));
                $body->setWebOtp($wrapper);
            }
            return $client->issue()->post($body, $this->config('Issue\\IssueRequestBuilderPostRequestConfiguration', $options))->wait();
        case 'verify': return $client->verify()->post(self::model($input, VerifyPostRequestBody::class), $this->config('Verify\\VerifyRequestBuilderPostRequestConfiguration', $options))->wait();
        case 'status':
            $params = new \KOtp\Sdk\Generated\Status\StatusRequestBuilderGetQueryParameters(); $params->issueId = $query['issueId'];
            return $client->status()->get($this->config('Status\\StatusRequestBuilderGetRequestConfiguration', $options, $params))->wait();
        case 'issues':
            $params = new \KOtp\Sdk\Generated\Issues\IssuesRequestBuilderGetQueryParameters(); $params->limit = $query['limit'] ?? null; $params->cursor = $query['cursor'] ?? null;
            $params->verificationStatus = isset($query['verificationStatus']) ? new \KOtp\Sdk\Generated\Issues\GetVerificationStatusQueryParameterType($query['verificationStatus']) : null;
            $params->createdFrom = isset($query['createdFrom']) ? new \DateTime($query['createdFrom']) : null; $params->createdTo = isset($query['createdTo']) ? new \DateTime($query['createdTo']) : null;
            return $client->issues()->get($this->config('Issues\\IssuesRequestBuilderGetRequestConfiguration', $options, $params))->wait();
        case 'issueDetail': return $client->issues()->byIssueId($path)->get($this->config('Issues\\Item\\WithIssueItemRequestBuilderGetRequestConfiguration', $options))->wait();
        case 'creditLedger':
            $params = new \KOtp\Sdk\Generated\CreditLedger\CreditLedgerRequestBuilderGetQueryParameters(); $params->limit = $query['limit'] ?? null;
            $params->entryType = isset($query['entryType']) ? new \KOtp\Sdk\Generated\CreditLedger\GetEntryTypeQueryParameterType($query['entryType']) : null;
            $params->cursor = $query['cursor'] ?? null; $params->createdFrom = isset($query['createdFrom']) ? new \DateTime($query['createdFrom']) : null; $params->createdTo = isset($query['createdTo']) ? new \DateTime($query['createdTo']) : null;
            return $client->creditLedger()->get($this->config('CreditLedger\\CreditLedgerRequestBuilderGetRequestConfiguration', $options, $params))->wait();
        case 'balance': return $client->balance()->get($this->config('Balance\\BalanceRequestBuilderGetRequestConfiguration', $options))->wait();
        case 'templates': return $client->templates()->get($this->config('Templates\\TemplatesRequestBuilderGetRequestConfiguration', $options))->wait();
        case 'templateDetail': return $client->templates()->byTemplateId($path)->get($this->config('Templates\\Item\\WithTemplateItemRequestBuilderGetRequestConfiguration', $options))->wait();
        default: throw new RuntimeException('Unknown operation');
    }
}
}
