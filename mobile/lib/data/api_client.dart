import 'package:dio/dio.dart';
import 'token_store.dart';

typedef Json = Map<String, dynamic>;

/// Stable server error codes (see web src/lib/errors.ts). The UI localizes `err.<code>`.
/// Client-side codes (never sent by the server): NETWORK (no connection), TIMEOUT (too slow), UNAVAILABLE (502/503/504 from a proxy,
/// no JSON envelope), BAD_RESPONSE (a 2xx that is not JSON, e.g. a captive portal), FILE_TOO_LARGE (413).
class ApiException implements Exception {
  ApiException(this.code, this.message, {this.status = 0, this.details = const {}});
  final String code;
  final String message;
  final int status;
  final Json details;
  /// The request never reached the server (or the answer never came back): the action may or may not have been applied.
  bool get isNetwork => code == 'NETWORK' || code == 'TIMEOUT';
  bool get isAuth => code == 'UNAUTHENTICATED';
  /// Worth retrying automatically for a read; for a write the outcome must be checked first.
  bool get isTransient => isNetwork || code == 'UNAVAILABLE' || code == 'DEPENDENCY_UNAVAILABLE';
  @override
  String toString() => 'ApiException($code, $message)';
}

class ApiClient {
  ApiClient({required String baseUrl, required this.tokens, Dio? dio, this.onUnauthorized, this.onConnectivity, this.retryDelays = const [Duration(milliseconds: 500), Duration(milliseconds: 1500)]})
      : dio = dio ?? Dio(BaseOptions(baseUrl: '$baseUrl/api/v1', connectTimeout: const Duration(seconds: 12), sendTimeout: const Duration(seconds: 30), receiveTimeout: const Duration(seconds: 25), headers: {'X-Client': 'mobile', 'Accept': 'application/json'})) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      final t = await tokens.read();
      if (t != null) o.headers['Authorization'] = 'Bearer $t';
      h.next(o);
    }));
  }

  final Dio dio;
  final TokenStore tokens;
  final void Function()? onUnauthorized;
  /// Called with `false` when a request fails for lack of connectivity and `true` as soon as the server answers anything.
  final void Function(bool online)? onConnectivity;
  /// Reads (GET) are retried after these delays when the connection drops or a proxy answers 502/503/504. Writes never are:
  /// a repeated deliver/fail could double-apply, so the UI verifies the outcome instead (see stops_panel).
  final List<Duration> retryDelays;

  Future<T> _run<T>(Future<Response<dynamic>> Function() call, {bool idempotent = false}) async {
    var attempt = 0;
    while (true) {
      try {
        return await _once<T>(call);
      } on ApiException catch (e) {
        final retryable = idempotent && attempt < retryDelays.length && (e.code == 'NETWORK' || e.code == 'UNAVAILABLE');
        if (!retryable) rethrow;
        await Future<void>.delayed(retryDelays[attempt++]);
      }
    }
  }

  Future<T> _once<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final r = await call();
      onConnectivity?.call(true);
      final d = r.data;
      if (d is T) return d;
      if (d == null || (d is String && d.trim().isEmpty)) return <String, dynamic>{} as T; // 204 / empty body
      throw ApiException('BAD_RESPONSE', 'unexpected response body', status: r.statusCode ?? 0);
    } on DioException catch (e) {
      final status = e.response?.statusCode ?? 0;
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        onConnectivity?.call(true);
        final er = data['error'] as Map;
        final det = er['details'];
        final ex = ApiException('${er['code']}', '${er['message']}', status: status, details: det is Map ? det.cast<String, dynamic>() : const {});
        if (ex.isAuth && !(e.requestOptions.path.contains('/auth/'))) onUnauthorized?.call();
        throw ex;
      }
      switch (e.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          onConnectivity?.call(false);
          throw ApiException('TIMEOUT', e.message ?? 'timeout');
        case DioExceptionType.badResponse:
          onConnectivity?.call(true);
          // A proxy/gateway answered without our JSON envelope.
          if (status == 401 && !e.requestOptions.path.contains('/auth/')) { onUnauthorized?.call(); throw ApiException('UNAUTHENTICATED', 'unauthenticated', status: status); }
          throw ApiException(switch (status) { 429 => 'RATE_LIMITED', 413 => 'FILE_TOO_LARGE', 502 || 503 || 504 => 'UNAVAILABLE', _ => 'INTERNAL' }, e.message ?? 'bad response', status: status);
        default:
          onConnectivity?.call(false);
          throw ApiException('NETWORK', e.message ?? 'network error');
      }
    }
  }

  Future<Json> get(String path, {Json? query}) => _run<Json>(() => dio.get(path, queryParameters: query), idempotent: true);
  /// [receiveTimeout] lets a slow-but-legitimate call (route planning calls Google several times) wait longer than the default.
  Future<Json> post(String path, [Json? body, Duration? receiveTimeout]) => _run<Json>(() => dio.post(path, data: body ?? {}, options: receiveTimeout == null ? null : Options(receiveTimeout: receiveTimeout)));
  Future<Json> put(String path, [Json? body]) => _run<Json>(() => dio.put(path, data: body ?? {}));
  Future<Json> patch(String path, [Json? body]) => _run<Json>(() => dio.patch(path, data: body ?? {}));
  Future<Json> delete(String path) => _run<Json>(() => dio.delete(path));
  /// Uploads get a long send window (photos on a weak signal) and report progress (0..1) so the UI can show it.
  Future<Json> postForm(String path, FormData form, {void Function(double progress)? onProgress}) => _run<Json>(() => dio.post(
        path, data: form,
        options: Options(sendTimeout: const Duration(seconds: 90), receiveTimeout: const Duration(seconds: 60)),
        onSendProgress: onProgress == null ? null : (sent, total) { if (total > 0) onProgress(sent / total); },
      ));
}
