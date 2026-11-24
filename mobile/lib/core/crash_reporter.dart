import 'dart:async';
import 'dart:convert';
import 'dart:io' show HandshakeException, SocketException;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../data/api_client.dart' show ApiException;
import 'app_info.dart';

/// Self-hosted crash reporting: an error nobody caught keeps the app alive and a SCRUBBED report goes to our own server (`POST /api/v1/app/errors`).
/// What leaves the phone: the error text with tokens / e-mail addresses / phone-like numbers / query strings removed, the stack (4 KB at most), the
/// screen the driver was on (ids replaced by `:id`), the app version, the platform, the OS version and the time. Never: sign-in tokens, names, phone
/// numbers, request or response bodies.
///
/// A report is fire-and-forget: a failure (offline, server down, a 4xx) drops it, nothing is queued and nothing is retried; at most [maxReports] are sent
/// per app run and an identical error is sent once. Reporting can never raise: whatever goes wrong inside is swallowed (otherwise reporting an error
/// could report itself in a loop).

/// Sends one report body. Throws (or returns) freely: [CrashReporter] ignores the outcome.
typedef ReportSender = Future<void> Function(Map<String, Object?> body);

const maxStackBytes = 4096;
const maxMessageChars = 600;

/// The screen the driver is on (the router keeps it up to date): a path with identifiers removed, like `/job/:id`.
class CurrentRoute {
  static String name = '/';
  static final _id = RegExp(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\b\d{4,}\b');
  static void set(String location) {
    final path = Uri.tryParse(location)?.path ?? location; // the query string is dropped: it can carry anything
    name = path.replaceAll(_id, ':id');
  }
}

final _bearer = RegExp(r'bearer\s+[A-Za-z0-9._~+/=\-]+', caseSensitive: false);
final _jwt = RegExp(r'eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.?[A-Za-z0-9_\-]*');
final _email = RegExp(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}');
final _query = RegExp(r'\?[^\s"\x27)>\]}]+');
final _phone = RegExp(r'(?<![\w.:])\+?\d[\d \-()]{6,}\d(?![\w:])');
final _home = RegExp(r'/(Users|home)/[^/\s)]+');

/// Removes what must never leave the phone from a piece of text (an error message). Safe on any input.
String scrubText(String s) => s
    .replaceAll(_bearer, 'Bearer <token>')
    .replaceAll(_jwt, '<token>')
    .replaceAll(_email, '<email>')
    .replaceAll(_query, '?<query>')
    .replaceAll(_phone, '<number>')
    .replaceAllMapped(_home, (m) => '/${m[1]}/<user>');

/// The stack as text, without personal paths and at most [maxStackBytes] bytes (cut on a character boundary).
String scrubStack(String s) {
  final t = s.replaceAll(_bearer, 'Bearer <token>').replaceAll(_jwt, '<token>').replaceAll(_email, '<email>').replaceAllMapped(_home, (m) => '/${m[1]}/<user>');
  final bytes = utf8.encode(t);
  if (bytes.length <= maxStackBytes) return t;
  return utf8.decode(bytes.sublist(0, maxStackBytes), allowMalformed: true).replaceAll('�', '');
}

/// A short, safe description of [e]. Server and network errors name their kind and status only: their text can quote a request or a response body.
String describeError(Object e) {
  if (e is ApiException) return 'ApiException(${e.code}, status ${e.status})';
  if (e is DioException) return 'DioException(${e.type.name}, status ${e.response?.statusCode ?? 0})';
  return scrubText('${e.runtimeType}: $e');
}

/// An error that only says "no signal" is not a bug: it must not use up the few reports a run may send.
bool isNetworkNoise(Object e) {
  if (e is SocketException || e is HandshakeException || e is TimeoutException) return true;
  if (e is ApiException) return e.isTransient || e.isAuth;
  if (e is DioException) return e.type != DioExceptionType.badResponse;
  return false;
}

class CrashReporter {
  CrashReporter({required this.app, required this.send, DateTime Function()? now, String Function()? route, this.maxReports = 5, this.sendTimeout = const Duration(seconds: 10)})
      : _now = now ?? DateTime.now, _route = route ?? (() => CurrentRoute.name);

  /// Updated once the real version has been read from the bundle.
  AppInfo app;
  final ReportSender send;
  final int maxReports;
  /// A sender that hangs (a captive portal, a dead socket) is abandoned after this long.
  final Duration sendTimeout;
  final DateTime Function() _now;
  final String Function() _route;
  final _seen = <String>{};
  int _attempts = 0;
  bool _inside = false;

  /// How many reports this run has used.
  int get used => _attempts;

  /// Builds and sends the report of [error]; returns the body that was handed to [send], or null when it was dropped (noise, duplicate, over the limit). Never throws.
  Future<Map<String, Object?>?> report(Object error, StackTrace? stack) async {
    final body = _build(error, stack);
    if (body == null) return null;
    try { await send(body).timeout(sendTimeout); } catch (_) {/* offline / server down / rejected: the report is simply dropped */}
    return body;
  }

  /// The synchronous part: decides whether to report at all and builds the body. An error raised while building must not report itself, so it is guarded;
  /// whatever is thrown here drops the report. (The asynchronous part is bounded by the per-run budget, so a sender that itself fails can never loop.)
  Map<String, Object?>? _build(Object error, StackTrace? stack) {
    if (_inside) return null;
    _inside = true;
    try {
      if (_attempts >= maxReports || isNetworkNoise(error)) return null;
      final message = describeError(error);
      final trimmedStack = scrubStack(stack?.toString() ?? '');
      final key = '${message.length > 200 ? message.substring(0, 200) : message}|${trimmedStack.split('\n').take(3).join('|')}';
      if (!_seen.add(key)) return null;
      _attempts++;
      return <String, Object?>{
        'message': message.length > maxMessageChars ? message.substring(0, maxMessageChars) : message,
        'stack': trimmedStack,
        'route': _route(),
        'appVersion': app.full,
        'platform': app.platform,
        'osVersion': app.osVersion,
        'at': _now().toUtc().toIso8601String(),
      };
    } catch (_) {
      return null;
    } finally {
      _inside = false;
    }
  }

  /// Fire-and-forget for the handlers below (they are synchronous callbacks).
  void capture(Object error, StackTrace? stack) { unawaited(report(error, stack)); }
}

/// The real sender: a plain POST without the session token (a report must not tie the error to a person), short timeouts, every status accepted.
ReportSender httpReportSender({required String baseUrl, required AppInfo Function() app, Dio? dio}) {
  Dio? client = dio;
  return (body) async {
    client ??= Dio(BaseOptions(baseUrl: '$baseUrl/api/v1', connectTimeout: const Duration(seconds: 5), sendTimeout: const Duration(seconds: 5), receiveTimeout: const Duration(seconds: 5), validateStatus: (_) => true, headers: {'Accept': 'application/json'}));
    final a = app();
    await client!.post('/app/errors', data: body, options: Options(headers: {'X-Client': 'mobile', 'X-App-Version': a.full, 'X-App-Platform': a.platform}));
  };
}

/// Installs the global handlers: a Flutter framework error and an uncaught asynchronous error are reported and the app carries on. The handler that was
/// there before still runs (in the app that is the default one — the console / red box in debug builds; under the integration-test binding it is the test
/// framework's, so a failing test still fails). Returns a function that puts the previous handlers back (tests).
/// `main` additionally wraps the app in [runGuarded] for errors thrown in the root zone.
VoidCallback installCrashHandlers(CrashReporter r) {
  final prevFlutter = FlutterError.onError, prevPlatform = PlatformDispatcher.instance.onError;
  FlutterError.onError = (details) {
    r.capture(details.exception, details.stack);
    if (prevFlutter != null) { prevFlutter(details); } else { FlutterError.presentError(details); }
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    r.capture(error, stack);
    if (prevPlatform != null) { prevPlatform(error, stack); } else if (kDebugMode) { debugPrint('Uncaught error: $error\n$stack'); }
    return true; // handled: the app stays alive
  };
  return () { FlutterError.onError = prevFlutter; PlatformDispatcher.instance.onError = prevPlatform; };
}

/// Runs [body] in a guarded zone so an error thrown anywhere in it is reported instead of ending the app.
void runGuarded(CrashReporter r, Future<void> Function() body) {
  runZonedGuarded<Future<void>>(body, (e, s) {
    if (kDebugMode) debugPrint('Uncaught zone error: $e\n$s');
    r.capture(e, s);
  });
}
