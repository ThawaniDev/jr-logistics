import 'package:dio/dio.dart';
import 'token_store.dart';

typedef Json = Map<String, dynamic>;

/// Stable server error codes (see web src/lib/errors.ts). The UI localizes `err.<code>`.
class ApiException implements Exception {
  ApiException(this.code, this.message, {this.status = 0, this.details = const {}});
  final String code;
  final String message;
  final int status;
  final Json details;
  bool get isNetwork => code == 'NETWORK';
  bool get isAuth => code == 'UNAUTHENTICATED';
  @override
  String toString() => 'ApiException($code, $message)';
}

class ApiClient {
  ApiClient({required String baseUrl, required this.tokens, Dio? dio, this.onUnauthorized})
      : dio = dio ?? Dio(BaseOptions(baseUrl: '$baseUrl/api/v1', connectTimeout: const Duration(seconds: 12), receiveTimeout: const Duration(seconds: 25), headers: {'X-Client': 'mobile', 'Accept': 'application/json'})) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      final t = await tokens.read();
      if (t != null) o.headers['Authorization'] = 'Bearer $t';
      h.next(o);
    }));
  }

  final Dio dio;
  final TokenStore tokens;
  final void Function()? onUnauthorized;

  Future<T> _run<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final r = await call();
      return r.data as T;
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        final er = data['error'] as Map;
        final ex = ApiException('${er['code']}', '${er['message']}', status: e.response?.statusCode ?? 0, details: (er['details'] as Map?)?.cast<String, dynamic>() ?? const {});
        if (ex.isAuth && !(e.requestOptions.path.contains('/auth/'))) onUnauthorized?.call();
        throw ex;
      }
      throw ApiException(e.type == DioExceptionType.badResponse ? 'INTERNAL' : 'NETWORK', e.message ?? 'network error', status: e.response?.statusCode ?? 0);
    }
  }

  Future<Json> get(String path, {Json? query}) => _run<Json>(() => dio.get(path, queryParameters: query));
  Future<Json> post(String path, [Json? body]) => _run<Json>(() => dio.post(path, data: body ?? {}));
  Future<Json> put(String path, [Json? body]) => _run<Json>(() => dio.put(path, data: body ?? {}));
  Future<Json> patch(String path, [Json? body]) => _run<Json>(() => dio.patch(path, data: body ?? {}));
  Future<Json> postForm(String path, FormData form) => _run<Json>(() => dio.post(path, data: form));
}
