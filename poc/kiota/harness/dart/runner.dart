import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:uuid/uuid.dart';
import 'package:microsoft_kiota_abstractions/microsoft_kiota_abstractions.dart';
import 'package:microsoft_kiota_bundle/microsoft_kiota_bundle.dart';
import 'package:microsoft_kiota_serialization_json/microsoft_kiota_serialization_json.dart';
import 'lib/generated/k_otp_api_client.dart';
import 'lib/generated/issue/issue_post_request_body.dart';
import 'lib/generated/issue/issue_post_request_body_web_otp.dart';
import 'lib/generated/models/issue_web_otp_options.dart';
import 'lib/generated/verify/verify_post_request_body.dart';

class GuardClient extends http.BaseClient {
  GuardClient(this.allowed,this.key);
  final Uri allowed;
  final String key;
  final IOClient inner=IOClient();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if(request.url.host!='127.0.0.1'||request.url.port!=allowed.port)throw StateError('Unexpected external network destination');
    request.headers['Authorization']='Bearer $key';
    return inner.send(request);
  }
  @override
  void close()=>inner.close();
}
T model<T extends Parsable>(dynamic value,ParsableFactory<T> factory) => JsonParseNodeFactory().getRootParseNode('application/json',Uint8List.fromList(utf8.encode(jsonEncode(value)))).getObjectValue<T>(factory)!;
dynamic serialize(Object? value) {
  if(value is! Parsable)return null;
  final writer=JsonSerializationWriter();writer.writeObjectValue(null,value);
  return jsonDecode(utf8.decode(writer.getSerializedContent()));
}
Future<Parsable?> call(KOtpApiClient client,Map<String,dynamic> test) {
  final query=test['query'] as Map<String,dynamic>;final id=test['id'] as String;
  switch(test['operation']) {
    case 'issue':
      final input=Map<String,dynamic>.from(test['request']);final key=(input['idempotencyKey']??'').toString().trim();
      if(!RegExp(r'^[!-~]{1,128}$').hasMatch(key))throw ArgumentError('Invalid idempotency before HTTP');
      final web=input.remove('webOtp');final body=model(input,IssuePostRequestBody.createFromDiscriminatorValue)..idempotencyKey=key;
      if(web!=null){final wrapper=IssuePostRequestBodyWebOtp();if(web is bool){wrapper.boolean=web;}else{wrapper.issueWebOtpOptions=model(web,IssueWebOtpOptions.createFromDiscriminatorValue);}body.webOtp=wrapper;}
      return client.issue.postAsync(body,(c){c.headers['X-Poc-Case']={id};c.headers['Idempotency-Key']={key};c.headers['Origin']={'https://poc.example.com'};});
    case 'verify':return client.verify.postAsync(model(test['request'],VerifyPostRequestBody.createFromDiscriminatorValue),(c){c.headers['X-Poc-Case']={id};});
    case 'status':return client.status.getAsync((c){c.headers['X-Poc-Case']={id};c.queryParameters.issueId=query['issueId'];});
    case 'issues':return client.issues.getAsync((c){c.headers['X-Poc-Case']={id};c.queryParameters.limit=query['limit'];c.queryParameters.cursor=query['cursor'];c.queryParameters.verificationStatus=query['verificationStatus'];});
    case 'issueDetail':return client.issues.byIssueId(UuidValue.fromString(test['pathValue'])).getAsync((c){c.headers['X-Poc-Case']={id};});
    case 'creditLedger':return client.creditLedger.getAsync((c){c.headers['X-Poc-Case']={id};c.queryParameters.limit=query['limit'];c.queryParameters.entryType=query['entryType'];});
    case 'balance':return client.balance.getAsync((c){c.headers['X-Poc-Case']={id};});
    case 'templates':return client.templates.getAsync((c){c.headers['X-Poc-Case']={id};});
    case 'templateDetail':return client.templates.byTemplateId(test['pathValue']).getAsync((c){c.headers['X-Poc-Case']={id};});
    default:throw StateError('Unknown operation');
  }
}
Future<void> main()async {
  final fixture=jsonDecode(File(Platform.environment['POC_FIXTURE']!).readAsStringSync());final base=Uri.parse(Platform.environment['POC_BASE_URL']!);final key=fixture['fakeSecretKey'] as String;
  if(base.host!='127.0.0.1'||!key.startsWith('sk_'))throw ArgumentError('Secret key and loopback URL required');
  final observations=<Map<String,dynamic>>[];
  for(final input in fixture['cases']) {
    final test=Map<String,dynamic>.from(input);final httpClient=GuardClient(base,key);final adapter=DefaultRequestAdapter(authProvider:AnonymousAuthenticationProvider(),client:httpClient)..baseUrl=base.toString();final client=KOtpApiClient(adapter);
    final observation=<String,dynamic>{'id':test['id']};
    try {
      Future<Parsable?> attempt()async{try{return await call(client,test);}on ApiException catch(error){if(test['explicitRetry']==true&&error.statusCode==503)return call(client,test);rethrow;}}
      final value=await attempt().timeout(Duration(milliseconds:test['timeoutMs']??10000));observation['response']=serialize(value);
    }on TimeoutException{observation['outcome']='unknown';}
    on ArgumentError catch(error){observation['outcome']='configuration_error';observation['diagnostic']=error.message;}
    on ApiException catch(error){observation['response']=serialize(error);observation['status']=error.statusCode;observation['headers']=error.responseHeaders;observation['exception']=error.runtimeType.toString();}
    catch(error){observation['outcome']='unexpected_exception';observation['diagnostic']=error.toString();}
    finally{httpClient.close();}
    observations.add(observation);
  }
  File(Platform.environment['POC_WIRE_RESULT']!).writeAsStringSync(jsonEncode(observations));
}
