import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:microsoft_kiota_abstractions/microsoft_kiota_abstractions.dart';
import 'lib/generated/k_otp_api_client.dart';
import 'lib/generated/balance/balance_get_response.dart';
import 'lib/generated/issues/get_verification_status_query_parameter_type.dart';
import 'lib/generated/creditLedger/get_entry_type_query_parameter_type.dart';
import 'runner.dart' show GuardClient;
import 'usage.dart';

void check(bool value, String message) { if (!value) throw StateError(message); }

Future<void> main() async {
  final factory = KotpJsonParseNodeFactory();
  ParseNode node(Object? value) => factory.getRootParseNode('application/json; charset=utf-8', Uint8List.fromList(utf8.encode(jsonEncode({'promoNextExpiry': value}))));
  final nullable = node(null);
  final empty = node({});
  final object = node({'at': '2026-10-08T00:00:00Z', 'amount': 20});
  check(empty.getObjectValue(BalanceGetResponse.createFromDiscriminatorValue)!.promoNextExpiry != null, 'empty object was mistaken for null');
  check(object.getObjectValue(BalanceGetResponse.createFromDiscriminatorValue)!.promoNextExpiry!.amount == 20, 'object changed');
  check(nullable.getObjectValue(BalanceGetResponse.createFromDiscriminatorValue)!.promoNextExpiry == null, 'null response changed across parse nodes');

  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final requests = <Map<String, String>>[];
  server.listen((request) async {
    requests.add(request.uri.queryParameters);
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({'items': []}));
    await request.response.close();
  });
  final base = Uri.parse('http://127.0.0.1:${server.port}/v1');
  final http = GuardClient(base, 'sk_poc_never_valid');
  try {
    final adapter = KotpRequestAdapter(authProvider: AnonymousAuthenticationProvider(), client: http)..baseUrl = base.toString();
    final client = KOtpApiClient(adapter);
    for (final value in GetEntryTypeQueryParameterType.values) {
      await client.creditLedger.getAsync((config) { config.queryParameters.entryType = value; });
      check(requests.last['entryType'] == value.value, 'entryType enum wire value changed');
    }
    for (final value in GetVerificationStatusQueryParameterType.values) {
      await client.issues.getAsync((config) { config.queryParameters.verificationStatus = value; });
      check(requests.last['verificationStatus'] == value.value, 'verificationStatus enum wire value changed');
    }
    check(requests.length == GetEntryTypeQueryParameterType.values.length + GetVerificationStatusQueryParameterType.values.length, 'requests were repeated');
    print('Dart nullable/MIME guards and ${requests.length} actual SDK enum query requests passed');
  } finally {
    http.close();
    await server.close(force: true);
  }
}
