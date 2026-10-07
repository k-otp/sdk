<?php
require __DIR__.'/vendor/autoload.php';
use KOtp\Preview\KotpClient;
use KOtp\Preview\KotpApiError;
use KOtp\Preview\KotpTransportError;
$fixture=json_decode(file_get_contents(getenv('POC_FIXTURE')),true,512,JSON_THROW_ON_ERROR);
$observations=[];
foreach($fixture['cases'] as $case) {
    $client=new KotpClient($fixture['fakeSecretKey'],getenv('POC_BASE_URL'),$case['timeoutMs'] ?? 10000);
    $options=['headers'=>['X-Poc-Case'=>$case['id']],'origin'=>'https://poc.example.com','retry503'=>$case['explicitRetry'] ?? false];
    $observation=['id'=>$case['id']];
    try {
        $observation['response']=match($case['operation']) {
            'issue'=>$client->issue($case['request'],$options),
            'verify'=>$client->verify($case['request'],$options),
            'status'=>$client->status($case['query']['issueId'],$options),
            'issues'=>$client->issues($case['query'],$options),
            'issueDetail'=>$client->issueDetail($case['pathValue'],$options),
            'creditLedger'=>$client->creditLedger($case['query'],$options),
            'balance'=>$client->balance($options),
            'templates'=>$client->templates($options),
            'templateDetail'=>$client->templateDetail($case['pathValue'],$options),
            default=>throw new RuntimeException('Unknown fixture operation')
        };
    } catch(KotpApiError $error) { $observation+=['response'=>$error->envelope,'status'=>$error->status,'headers'=>$error->headers,'requestId'=>$error->requestId,'retryAfterMs'=>$error->retryAfterMs]; }
    catch(KotpTransportError $error) { $observation['outcome']=$error->outcome; }
    catch(InvalidArgumentException $error) { $observation['outcome']='configuration_error'; }
    $observations[]=$observation;
}
file_put_contents(getenv('POC_WIRE_RESULT'),json_encode($observations,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
