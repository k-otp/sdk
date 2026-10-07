import 'dart:convert';
import 'dart:io';
import 'package:kotp_kiota_poc/kotp_kiota_preview.dart';
import 'package:kotp_kiota_poc/generated/issues/get_verification_status_query_parameter_type.dart';
import 'package:kotp_kiota_poc/generated/creditLedger/get_entry_type_query_parameter_type.dart';

Future<void> main() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final requests = <Map<String, String>>[];
  server.listen((request) async {
    requests.add(request.uri.queryParameters);
    if (request.headers.value('authorization') !=
        'Bearer sk_preview_never_valid')
      throw StateError('Scoped authentication changed');
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({'items': []}));
    await request.response.close();
  });
  final client = KotpClient(
    'sk_preview_never_valid',
    baseUrl: 'http://127.0.0.1:${server.port}/v1',
  );
  try {
    for (final value in GetEntryTypeQueryParameterType.values) {
      await client.creditLedger({
        'entryType': value.value,
        'createdFrom': '2026-10-07T00:00:00Z',
        'createdTo': '2026-10-08T00:00:00Z',
        'cursor': 'cursor +/한',
      });
      if (requests.last['entryType'] != value.value ||
          requests.last['cursor'] != 'cursor +/한' ||
          requests.last['createdFrom'] == null ||
          requests.last['createdTo'] == null)
        throw StateError('Public ledger filter changed');
    }
    for (final value in GetVerificationStatusQueryParameterType.values) {
      await client.issues({'verificationStatus': value.value});
      if (requests.last['verificationStatus'] != value.value)
        throw StateError('Public issue filter changed');
    }
    if (requests.length != 12) throw StateError('Unexpected repeated request');
    var rejected = false;
    try {
      await client.balance(
        options: const RequestOptions(headers: {'Authorization': 'override'}),
      );
    } on ArgumentError {
      rejected = true;
    }
    if (!rejected || requests.length != 12)
      throw StateError('Protected header reached transport');
    print(
      'Installed preview: 12 enum queries, date/cursor filters and zero-request protected-header guard passed',
    );
  } finally {
    client.close();
    await server.close(force: true);
  }
}
