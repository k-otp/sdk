import 'dart:convert';
import 'dart:typed_data';
import 'package:microsoft_kiota_abstractions/microsoft_kiota_abstractions.dart';
import 'package:microsoft_kiota_bundle/microsoft_kiota_bundle.dart';
import 'package:microsoft_kiota_serialization_json/microsoft_kiota_serialization_json.dart';
import 'lib/generated/balance/balance_get_response.dart';

class KotpJsonParseNodeFactory extends JsonParseNodeFactory {
  @override
  ParseNode getRootParseNode(String contentType, Uint8List content) {
    final raw = jsonDecode(utf8.decode(content));
    final mimeType = contentType.split(';').first.trim().toLowerCase();
    final node = super.getRootParseNode(mimeType, content);
    node.onAfterAssignFieldValues = (value) {
      if (value is BalanceGetResponse && raw is Map &&
          raw.containsKey('promoNextExpiry') && raw['promoNextExpiry'] == null) {
        value.promoNextExpiry = null;
      }
    };
    return node;
  }
}

// Correct these generated enum names before the real request adapter runs.
class KotpRequestAdapter extends DefaultRequestAdapter {
  KotpRequestAdapter({required super.authProvider, super.client})
      : super(pNodeFactory: KotpJsonParseNodeFactory());

  @override
  Future<T?> send<T extends Parsable>(RequestInformation requestInfo,
      ParsableFactory<T> factory, [Map<String, ParsableFactory<Parsable>>? errors]) {
    const entryTypes = {
      'promoCredit': 'promo_credit',
      'promoExpire': 'promo_expire',
      'promoRevoke': 'promo_revoke',
    };
    final entryType = requestInfo.queryParameters['entryType'];
    final entryName = entryType is Enum ? entryType.name : entryType;
    if (entryTypes.containsKey(entryName)) {
      requestInfo.queryParameters['entryType'] = entryTypes[entryName];
    }
    final status = requestInfo.queryParameters['verificationStatus'];
    final statusName = status is Enum ? status.name : status;
    if (statusName == 'maxAttempts') {
      requestInfo.queryParameters['verificationStatus'] = 'max_attempts';
    }
    return super.send<T>(requestInfo, factory, errors);
  }
}

Object? readField(ApiException error, Object? Function(dynamic) reader) {
  try { return reader(error); } on NoSuchMethodError { return null; }
}

Object? jsonValue(Object? value) {
  if (value is UntypedObject) {
    return value.properties.map((key, child) => MapEntry(key, jsonValue(child)));
  }
  if (value is UntypedArray) return value.collection.map(jsonValue).toList();
  if (value is UntypedNull) return null;
  if (value is UntypedNode) return jsonValue(value.getValue());
  if (value is List) return value.map(jsonValue).toList();
  if (value is Map) return value.map((key, child) => MapEntry(key, jsonValue(child)));
  if (value is Parsable) {
    final writer = JsonSerializationWriter();
    writer.writeObjectValue(null, value);
    return jsonDecode(utf8.decode(writer.getSerializedContent()));
  }
  return value;
}

Map<String, Object?> errorView(ApiException error) {
  final additional = error is AdditionalDataHolder
      ? (error as AdditionalDataHolder).additionalData : <String, Object?>{};
  return {
    'defined': jsonValue(readField(error, (value) => value.defined)),
    'code': jsonValue(readField(error, (value) => value.code)),
    'status': jsonValue(readField(error, (value) => value.status)),
    'message': additional['message'] ?? error.message,
    'data': jsonValue(additional['data']),
  };
}
