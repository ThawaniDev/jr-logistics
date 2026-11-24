import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../core/version_gate.dart';
import 'api_client.dart';

String? _s(Object? v) => v is String ? v : null;
int? _i(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
Json? _m(Object? v) => v is Map ? v.cast<String, dynamic>() : null;

/// One thing that stops an account from being erased: `{code, count?, amountCents?}`; the text is `pv.blocker_<code>` (`{n}` = count, `{amount}` = money).
class PrivacyBlocker {
  PrivacyBlocker(this.j);
  final Json j;
  String get code => _s(j['code']) ?? '';
  int get count => _i(j['count']) ?? 0;
  int get amountCents => _i(j['amountCents']) ?? 0;
}

/// The person's last erasure request (`requested` | `completed` | `rejected` | `cancelled`).
class DeletionRequest {
  DeletionRequest(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get status => _s(j['status']) ?? '';
  String? get reason => _s(j['reason']);
  String? get requestedAt => _s(j['requestedAt']);
  String? get decisionNote => _s(j['decisionNote']);
  bool get open => status == 'requested';
  bool get rejected => status == 'rejected';
}

/// `GET /privacy/status`: can the person ask, what blocks it, the state of their last request, when they last downloaded their data.
class PrivacyStatus {
  PrivacyStatus(this.j);
  final Json j;
  Json get _export => _m(j['export']) ?? const {};
  Json get _deletion => _m(j['deletion']) ?? const {};
  Json get _retention => _m(j['retention']) ?? const {};
  Json get _contact => _m(j['contact']) ?? const {};
  bool get exportAvailable => _export['available'] != false;
  String? get lastExportAt => _s(_export['lastAt']);
  /// False for accounts this tool does not erase (staff): the section says so instead of offering a button that cannot work.
  bool get deletionSupported => _deletion['supported'] != false;
  bool get eligible => _deletion['eligible'] == true;
  bool get canRequest => _deletion['canRequest'] == true;
  List<PrivacyBlocker> get blockers { final b = _deletion['blockers']; return b is List ? [for (final e in b) if (e is Map) PrivacyBlocker(e.cast<String, dynamic>())] : const []; }
  DeletionRequest? get request { final r = _m(_deletion['request']); return r == null ? null : DeletionRequest(r); }
  int? get notificationDays => _i(_retention['notificationDays']);
  int? get recipientPiiMonths => _i(_retention['recipientPiiMonths']);
  int? get closedAccountYears => _i(_retention['closedAccountYears']);
  bool get hasRetention => notificationDays != null && recipientPiiMonths != null && closedAccountYears != null;
  String? get privacyEmail { final e = _s(_contact['privacyEmail']); return e == null || e.trim().isEmpty ? null : e.trim(); }
}

/// The self-service privacy endpoints behind one small class, so the screens never know the URLs (and a change of contract is one edit here).
class PrivacyRepository {
  PrivacyRepository(this.c);
  final ApiClient c;

  Future<PrivacyStatus> status() async => PrivacyStatus(await c.get('/privacy/status'));

  /// `GET /privacy/export` — NOT a JSON envelope but a JSON *attachment* (`jr-my-data-YYYY-MM-DD.json`): the bytes are returned as they are, to be saved and shared.
  /// Rate limited (5 an hour: `429 RATE_LIMITED`). Errors come back as the usual `{error}` envelope.
  Future<Uint8List> exportData() async {
    try {
      final r = await c.dio.get<List<int>>('/privacy/export', options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(seconds: 60)));
      c.onConnectivity?.call(true);
      final d = r.data;
      if (d == null || d.isEmpty) throw ApiException('BAD_RESPONSE', 'empty export', status: r.statusCode ?? 0);
      return Uint8List.fromList(d);
    } on DioException catch (e) {
      throw _asApiException(e);
    }
  }

  /// `POST /privacy/delete-request` `{reason?, confirm: true}` → the new request. `409 ERASURE_BLOCKED` carries `details.blockers`; `409 CONFLICT` = one is already open.
  Future<DeletionRequest> requestDeletion(String? reason) async {
    final r = reason?.trim();
    final res = await c.post('/privacy/delete-request', {'reason': ?(r == null || r.isEmpty ? null : (r.length > 500 ? r.substring(0, 500) : r)), 'confirm': true});
    return DeletionRequest(_m(res['request']) ?? const {});
  }

  /// `POST /privacy/delete-request/cancel` — withdraws the open request (`409 NOTHING_TO_DO` when none is open).
  Future<DeletionRequest> cancelDeletion() async => DeletionRequest(_m((await c.post('/privacy/delete-request/cancel'))['request']) ?? const {});

  /// A failed raw request, read the way [ApiClient] reads a JSON one (the body of an error is still `{error: {code, message, details}}`, here as bytes).
  ApiException _asApiException(DioException e) {
    final status = e.response?.statusCode ?? 0;
    final data = e.response?.data;
    Object? parsed;
    try { parsed = data is List<int> ? jsonDecode(utf8.decode(data, allowMalformed: true)) : data; } catch (_) { parsed = null; }
    final er = parsed is Map ? parsed['error'] : null;
    if (er is Map) {
      c.onConnectivity?.call(true);
      final det = er['details'];
      final ex = ApiException('${er['code']}', '${er['message']}', status: status, details: det is Map ? det.cast<String, dynamic>() : const {});
      if (ex.isAuth) c.onUnauthorized?.call();
      if (ex.code == 'UPGRADE_REQUIRED') c.onUpgradeRequired?.call(UpgradeInfo.fromDetails(ex.details));
      return ex;
    }
    if (e.type == DioExceptionType.badResponse) {
      c.onConnectivity?.call(true);
      if (status == 426) { c.onUpgradeRequired?.call(const UpgradeInfo()); return ApiException('UPGRADE_REQUIRED', e.message ?? 'upgrade required', status: status); }
      if (status == 401) c.onUnauthorized?.call();
      return ApiException(status == 429 ? 'RATE_LIMITED' : status == 401 ? 'UNAUTHENTICATED' : 'INTERNAL', e.message ?? 'bad response', status: status);
    }
    c.onConnectivity?.call(false);
    final slow = e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout;
    return ApiException(slow ? 'TIMEOUT' : 'NETWORK', e.message ?? 'network error');
  }
}
