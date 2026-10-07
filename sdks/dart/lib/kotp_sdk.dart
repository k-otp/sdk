import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:uuid/uuid.dart';
import 'package:microsoft_kiota_abstractions/microsoft_kiota_abstractions.dart';
import 'package:microsoft_kiota_serialization_json/microsoft_kiota_serialization_json.dart';
import 'generated/k_otp_api_client.dart';
import 'generated/issue/issue_post_request_body.dart';
import 'generated/issue/issue_post_request_body_web_otp.dart';
import 'generated/models/issue_web_otp_options.dart';
import 'generated/verify/verify_post_request_body.dart';
import 'generated/issues/get_verification_status_query_parameter_type.dart';
import 'generated/creditLedger/get_entry_type_query_parameter_type.dart';
import 'src/compatibility.dart';

class RequestOptions {
  const RequestOptions({
    this.headers = const {},
    this.origin,
    this.retry503 = false,
  });
  final Map<String, String> headers;
  final String? origin;
  final bool retry503;
}

class KotpApiError implements Exception {
  KotpApiError(ApiException error)
    : status = error.statusCode ?? 0,
      envelope = errorView(error) {
    headers = {
      for (final entry in (error.responseHeaders ?? {}).entries)
        entry.key.toLowerCase(): List<String>.from(entry.value),
    };
    requestId = headers['x-request-id']?.firstOrNull;
    final data = envelope['data'];
    final bodyMs = data is Map ? data['retryAfterMs'] : null;
    final seconds = headers['retry-after']?.firstOrNull;
    retryAfterMs = bodyMs is num && bodyMs.isFinite && bodyMs >= 0
        ? bodyMs
        : seconds != null && RegExp(r'^\d+$').hasMatch(seconds)
        ? int.parse(seconds) * 1000
        : null;
  }
  final int status;
  final Map<String, Object?> envelope;
  late final Map<String, List<String>> headers;
  late final String? requestId;
  late final num? retryAfterMs;
  @override
  String toString() =>
      envelope['message']?.toString() ?? 'K-OTP API request failed';
}

class KotpTransportError implements Exception {
  KotpTransportError(this.cause);
  final Object cause;
  String get outcome => 'unknown';
  @override
  String toString() => 'The request outcome is unknown';
}

class _ScopedClient extends http.BaseClient {
  _ScopedClient(this.base, this.key, this.inner);
  final Uri base;
  final String key;
  final http.Client inner;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (request.url.scheme != base.scheme ||
        request.url.host != base.host ||
        request.url.port != base.port)
      throw ArgumentError(
        'Request destination differs from the configured API origin',
      );
    request.followRedirects = false;
    request.headers['Authorization'] = 'Bearer $key';
    return inner.send(request);
  }

  @override
  void close() => inner.close();
}

class KotpClient {
  KotpClient(
    String apiKey, {
    String baseUrl = 'https://api.k-otp.dev/v1',
    int timeoutMs = 10000,
    http.Client? transport,
  }) {
    if (!RegExp(r'^sk_[!-~]+$').hasMatch(apiKey))
      throw ArgumentError('A server secret key is required');
    final base = Uri.parse(baseUrl);
    if (base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment ||
        !(base.scheme == 'https' ||
            base.scheme == 'http' && base.host == '127.0.0.1'))
      throw ArgumentError(
        'An HTTPS API base URL or loopback HTTP URL is required',
      );
    if (timeoutMs <= 0) throw ArgumentError('timeoutMs must be positive');
    _timeout = Duration(milliseconds: timeoutMs);
    _http = _ScopedClient(base, apiKey, transport ?? IOClient());
    final adapter = KotpRequestAdapter(
      authProvider: AnonymousAuthenticationProvider(),
      client: _http,
    )..baseUrl = base.toString();
    _api = KOtpApiClient(adapter);
  }
  late final KOtpApiClient _api;
  late final _ScopedClient _http;
  late final Duration _timeout;
  void close() => _http.close();
  Future<Object?> issue(
    Map<String, dynamic> input, {
    RequestOptions options = const RequestOptions(),
  }) => _send('issue', input, {}, '', options);
  Future<Object?> verify(
    Map<String, dynamic> input, {
    RequestOptions options = const RequestOptions(),
  }) => _send('verify', input, {}, '', options);
  Future<Object?> status(
    String issueId, {
    RequestOptions options = const RequestOptions(),
  }) => _send('status', {}, {'issueId': issueId}, '', options);
  Future<Object?> issues([
    Map<String, dynamic> query = const {},
    RequestOptions options = const RequestOptions(),
  ]) => _send('issues', {}, query, '', options);
  Future<Object?> issueDetail(
    String issueId, {
    RequestOptions options = const RequestOptions(),
  }) => _send('issueDetail', {}, {}, issueId, options);
  Future<Object?> creditLedger([
    Map<String, dynamic> query = const {},
    RequestOptions options = const RequestOptions(),
  ]) => _send('creditLedger', {}, query, '', options);
  Future<Object?> balance({RequestOptions options = const RequestOptions()}) =>
      _send('balance', {}, {}, '', options);
  Future<Object?> templates({
    RequestOptions options = const RequestOptions(),
  }) => _send('templates', {}, {}, '', options);
  Future<Object?> templateDetail(
    String templateId, {
    RequestOptions options = const RequestOptions(),
  }) => _send('templateDetail', {}, {}, templateId, options);
  T _model<T extends Parsable>(dynamic value, ParsableFactory<T> factory) =>
      JsonParseNodeFactory()
          .getRootParseNode(
            'application/json',
            Uint8List.fromList(utf8.encode(jsonEncode(value))),
          )
          .getObjectValue<T>(factory)!;
  Object? _json(Parsable? value) {
    if (value == null) return null;
    final writer = JsonSerializationWriter();
    writer.writeObjectValue(null, value);
    return jsonDecode(utf8.decode(writer.getSerializedContent()));
  }

  Future<Object?> _send(
    String operation,
    Map<String, dynamic> input,
    Map<String, dynamic> query,
    String path,
    RequestOptions settings,
  ) async {
    final headers = Map<String, String>.from(settings.headers);
    if (headers.keys.any(
      (key) => ['authorization', 'idempotency-key'].contains(key.toLowerCase()),
    ))
      throw ArgumentError(
        'Authentication and idempotency headers are managed by the client',
      );
    input = Map<String, dynamic>.from(jsonDecode(jsonEncode(input)));
    query = Map<String, dynamic>.from(jsonDecode(jsonEncode(query)));
    final key = input['idempotencyKey'] is String
        ? (input['idempotencyKey'] as String).trim()
        : '';
    if (operation == 'issue') {
      if (!RegExp(r'^[!-~]{1,128}$').hasMatch(key))
        throw ArgumentError('Invalid issue idempotency key before HTTP');
      headers['Idempotency-Key'] = key;
      if (settings.origin != null) headers['Origin'] = settings.origin!;
    }
    void configure<T extends AbstractQueryParameters>(
      RequestConfiguration<T> config,
    ) {
      for (final entry in headers.entries)
        config.headers[entry.key] = {entry.value};
    }

    Future<Parsable?> call() {
      switch (operation) {
        case 'issue':
          final request = Map<String, dynamic>.from(input);
          final web = request.remove('webOtp');
          final body = _model(
            request,
            IssuePostRequestBody.createFromDiscriminatorValue,
          )..idempotencyKey = key;
          if (web != null) {
            final wrapper = IssuePostRequestBodyWebOtp();
            if (web is bool) {
              wrapper.boolean = web;
            } else {
              wrapper.issueWebOtpOptions = _model(
                web,
                IssueWebOtpOptions.createFromDiscriminatorValue,
              );
            }
            body.webOtp = wrapper;
          }
          return _api.issue.postAsync(body, configure);
        case 'verify':
          return _api.verify.postAsync(
            _model(input, VerifyPostRequestBody.createFromDiscriminatorValue),
            configure,
          );
        case 'status':
          return _api.status.getAsync((c) {
            configure(c);
            c.queryParameters.issueId = query['issueId'];
          });
        case 'issues':
          return _api.issues.getAsync((c) {
            configure(c);
            c.queryParameters.limit = query['limit'];
            c.queryParameters.cursor = query['cursor'];
            c.queryParameters.verificationStatus =
                query['verificationStatus'] == null
                ? null
                : GetVerificationStatusQueryParameterType.values.firstWhere(
                    (v) => v.value == query['verificationStatus'],
                  );
            c.queryParameters.createdFrom = query['createdFrom'] == null
                ? null
                : DateTime.parse(query['createdFrom']);
            c.queryParameters.createdTo = query['createdTo'] == null
                ? null
                : DateTime.parse(query['createdTo']);
          });
        case 'issueDetail':
          return _api.issues
              .byIssueId(UuidValue.fromString(path))
              .getAsync(configure);
        case 'creditLedger':
          return _api.creditLedger.getAsync((c) {
            configure(c);
            c.queryParameters.limit = query['limit'];
            c.queryParameters.cursor = query['cursor'];
            c.queryParameters.entryType = query['entryType'] == null
                ? null
                : GetEntryTypeQueryParameterType.values.firstWhere(
                    (v) => v.value == query['entryType'],
                  );
            c.queryParameters.createdFrom = query['createdFrom'] == null
                ? null
                : DateTime.parse(query['createdFrom']);
            c.queryParameters.createdTo = query['createdTo'] == null
                ? null
                : DateTime.parse(query['createdTo']);
          });
        case 'balance':
          return _api.balance.getAsync(configure);
        case 'templates':
          return _api.templates.getAsync(configure);
        case 'templateDetail':
          return _api.templates.byTemplateId(path).getAsync(configure);
        default:
          throw ArgumentError('Unknown operation');
      }
    }

    Future<Parsable?> attempt() async {
      try {
        return await call();
      } on ApiException catch (error) {
        if (operation == 'issue' &&
            settings.retry503 &&
            error.statusCode == 503)
          return call();
        rethrow;
      }
    }

    try {
      return _json(await attempt().timeout(_timeout));
    } on ApiException catch (error) {
      throw KotpApiError(error);
    } on TimeoutException catch (error) {
      throw KotpTransportError(error);
    } on SocketException catch (error) {
      throw KotpTransportError(error);
    } on http.ClientException catch (error) {
      throw KotpTransportError(error);
    }
  }
}
