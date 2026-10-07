import 'dart:convert';
import 'dart:io';
import 'package:kotp_sdk/kotp_sdk.dart';

Future<void> main() async {
  final fixture = jsonDecode(
    File(Platform.environment['POC_FIXTURE']!).readAsStringSync(),
  );
  final observations = <Map<String, dynamic>>[];
  for (final test in fixture['cases']) {
    final client = KotpClient(
      fixture['fakeSecretKey'],
      baseUrl: Platform.environment['POC_BASE_URL']!,
      timeoutMs: test['timeoutMs'] ?? 10000,
    );
    final options = RequestOptions(
      headers: {'X-Poc-Case': test['id']},
      origin: 'https://poc.example.com',
      retry503: test['explicitRetry'] == true,
    );
    final result = <String, dynamic>{'id': test['id']};
    try {
      result['response'] = switch (test['operation']) {
        'issue' => await client.issue(
          Map<String, dynamic>.from(test['request']),
          options: options,
        ),
        'verify' => await client.verify(
          Map<String, dynamic>.from(test['request']),
          options: options,
        ),
        'status' => await client.status(
          test['query']['issueId'],
          options: options,
        ),
        'issues' => await client.issues(
          Map<String, dynamic>.from(test['query']),
          options,
        ),
        'issueDetail' => await client.issueDetail(
          test['pathValue'],
          options: options,
        ),
        'creditLedger' => await client.creditLedger(
          Map<String, dynamic>.from(test['query']),
          options,
        ),
        'balance' => await client.balance(options: options),
        'templates' => await client.templates(options: options),
        'templateDetail' => await client.templateDetail(
          test['pathValue'],
          options: options,
        ),
        _ => throw StateError('Unknown fixture operation'),
      };
    } on KotpApiError catch (error) {
      result.addAll({
        'status': error.status,
        'response': error.envelope,
        'headers': error.headers,
        'requestId': error.requestId,
        'retryAfterMs': error.retryAfterMs,
      });
    } on KotpTransportError catch (error) {
      result['outcome'] = error.outcome;
    } on ArgumentError {
      result['outcome'] = 'configuration_error';
    } finally {
      client.close();
    }
    observations.add(result);
  }
  File(
    Platform.environment['POC_WIRE_RESULT']!,
  ).writeAsStringSync(jsonEncode(observations));
}
