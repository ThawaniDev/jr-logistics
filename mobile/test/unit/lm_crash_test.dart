import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/app_info.dart';
import 'package:jr_driver/core/crash_reporter.dart';
import 'package:jr_driver/data/api_client.dart';

/// Update L / M — crash reporting: what leaves the phone, what never does, and that reporting can never loop or take the app down.
const _app = AppInfo(version: '1.4.0', build: '7', platform: 'android', osVersion: 'Android 14');

class _Capture {
  final bodies = <Map<String, Object?>>[];
  Object? failWith;
  Future<void> send(Map<String, Object?> b) async { bodies.add(b); if (failWith != null) throw failWith!; }
}

CrashReporter _reporter(_Capture c, {int max = 5, String route = '/job/:id'}) => CrashReporter(app: _app, send: c.send, route: () => route, now: () => DateTime.utc(2026, 11, 22, 9, 30), maxReports: max);

StackTrace _stack([String extra = '']) => StackTrace.fromString('#0      main (package:jr_driver/main.dart:12:3)\n#1      _run (package:jr_driver/app.dart:40:9)\n$extra');

void main() {
  group('what is sent', () {
    test('message, stack, route, app version, platform, OS version and time — and nothing else', () async {
      final c = _Capture();
      final body = await _reporter(c).report(StateError('boom'), _stack());
      expect(body, isNotNull);
      expect(c.bodies.single.keys.toSet(), {'message', 'stack', 'route', 'appVersion', 'platform', 'osVersion', 'at'});
      final b = c.bodies.single;
      expect(b['message'], 'StateError: Bad state: boom');
      expect(b['route'], '/job/:id');
      expect([b['appVersion'], b['platform'], b['osVersion'], b['at']], ['1.4.0+7', 'android', 'Android 14', '2026-11-22T09:30:00.000Z']);
      expect(b['stack'], contains('package:jr_driver/main.dart:12:3'));
    });

    test('tokens, e-mail addresses, phone numbers and query strings are removed from the text', () {
      expect(scrubText('Bearer abc.DEF-123_xyz failed'), 'Bearer <token> failed');
      expect(scrubText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk x'), contains('<token>'));
      expect(scrubText('user omar.test@example.com not found'), 'user <email> not found');
      expect(scrubText('call +966 50 000 0011 or 0500000011'), 'call <number> or <number>');
      expect(scrubText('GET /auth/me?token=secret&x=1 failed'), 'GET /auth/me?<query> failed');
      expect(scrubText('RangeError (index): Invalid value: Not in inclusive range 0..2: 5'), 'RangeError (index): Invalid value: Not in inclusive range 0..2: 5', reason: 'ordinary numbers stay');
      expect(scrubText('at /Users/omar/work/app/lib/main.dart'), 'at /Users/<user>/work/app/lib/main.dart');
    });

    test('an exception that quotes a name, a phone number and a token reaches the server without them', () async {
      final c = _Capture();
      await _reporter(c).report(FormatException('bad body {"name":"Omar Test","phone":"+966500000011","token":"Bearer sekrit.token.value"} for omar@x.com'), _stack());
      final text = jsonEncode(c.bodies.single);
      expect(text, isNot(contains('+966500000011')));
      expect(text, isNot(contains('sekrit')));
      expect(text, isNot(contains('omar@x.com')));
    });

    test('server and network errors are described by kind and status only (their text can quote a request or a response)', () async {
      final c = _Capture();
      final r = _reporter(c);
      await r.report(ApiException('INTERNAL', 'name Omar Test phone 0500000011 {"password":"hunter2"}', status: 500), _stack('a'));
      await r.report(DioException(requestOptions: RequestOptions(path: '/x?token=abc'), type: DioExceptionType.badResponse, response: Response(requestOptions: RequestOptions(path: '/x'), statusCode: 502, data: 'Omar Test 0500000011'), message: 'Omar Test'), _stack('b'));
      expect(c.bodies.map((b) => b['message']), ['ApiException(INTERNAL, status 500)', 'DioException(badResponse, status 502)']);
      expect(jsonEncode(c.bodies), isNot(anyOf(contains('hunter2'), contains('Omar'), contains('0500000011'))));
    });

    test('the stack is cut at 4 KB, on a character boundary, and the message at 600 characters', () async {
      final c = _Capture();
      final long = List.generate(400, (i) => '#$i      method$i (package:jr_driver/very/long/path/file$i.dart:$i:1)').join('\n');
      await _reporter(c).report(StateError('x' * 2000), StackTrace.fromString(long));
      expect(utf8.encode(c.bodies.single['stack'] as String).length, lessThanOrEqualTo(maxStackBytes));
      expect((c.bodies.single['stack'] as String).length, greaterThan(3500));
      expect((c.bodies.single['message'] as String).length, lessThanOrEqualTo(maxMessageChars));
      expect(utf8.encode(scrubStack('é' * 5000)).length, lessThanOrEqualTo(maxStackBytes));
    });

    test('the current screen is a path without identifiers or query', () {
      CurrentRoute.set('/job/3f2b8c9e-1111-4222-8333-444455556666/chat?x=1');
      expect(CurrentRoute.name, '/job/:id/chat');
      CurrentRoute.set('/support/1234567');
      expect(CurrentRoute.name, '/support/:id');
      CurrentRoute.set('/offers');
      expect(CurrentRoute.name, '/offers');
    });
  });

  group('limits and safety', () {
    test('at most 5 reports per app run', () async {
      final c = _Capture();
      final r = _reporter(c);
      for (var i = 0; i < 12; i++) { await r.report(StateError('distinct $i'), _stack('$i')); }
      expect(c.bodies.length, 5);
      expect(r.used, 5);
    });

    test('the same error twice is sent once; a different one still goes', () async {
      final c = _Capture();
      final r = _reporter(c);
      await r.report(StateError('same'), _stack());
      await r.report(StateError('same'), _stack());
      await r.report(StateError('other'), _stack());
      expect(c.bodies.length, 2);
    });

    test('"no signal" errors are not bugs: they are not reported and do not use up the budget', () async {
      final c = _Capture();
      final r = _reporter(c);
      for (final e in <Object>[const SocketException('x'), TimeoutException('t'), ApiException('NETWORK', 'x'), ApiException('UNAUTHENTICATED', 'x', status: 401), DioException(requestOptions: RequestOptions(), type: DioExceptionType.connectionTimeout)]) {
        expect(await r.report(e, _stack()), isNull, reason: '$e');
      }
      expect(c.bodies, isEmpty);
      expect(r.used, 0);
    });

    test('a sender that fails (offline, server down, rejected) drops the report: no retry, no loop, no exception', () async {
      final c = _Capture()..failWith = const SocketException('offline');
      final r = _reporter(c);
      await r.report(StateError('a'), _stack('a'));
      await r.report(StateError('b'), _stack('b'));
      expect(c.bodies.length, 2, reason: 'one attempt each, never a retry');
      expect(r.used, 2);
    });

    test('a sender that hangs does not hold the app: the report times out and is dropped', () async {
      final r = CrashReporter(app: _app, send: (_) => Completer<void>().future, route: () => '/', sendTimeout: const Duration(milliseconds: 50));
      expect(await r.report(StateError('hang'), _stack()).timeout(const Duration(seconds: 5)), isNotNull);
    });

    test('a sender that itself keeps raising new errors can never loop: the per-run budget ends it', () async {
      late CrashReporter r;
      var calls = 0;
      r = CrashReporter(app: _app, route: () => '/', send: (b) async { calls++; await r.report(StateError('from inside $calls'), _stack('$calls')); });
      await r.report(StateError('outer'), _stack());
      expect(calls, 5);
    });

    test('an error while the body is being built drops the report (and does not throw)', () async {
      final r = CrashReporter(app: _app, send: (_) async {}, route: () => throw StateError('route broke'));
      expect(await r.report(StateError('x'), _stack()), isNull);
    });
  });

  group('global handlers', () {
    test('a framework error and an uncaught async error are reported and the app is told they are handled', () async {
      final c = _Capture();
      final r = _reporter(c);
      final seen = <FlutterErrorDetails>[];
      final before = FlutterError.onError;
      FlutterError.onError = seen.add; // the handler that was there before (the test framework's would fail this test)
      final restore = installCrashHandlers(r);
      addTearDown(() { restore(); FlutterError.onError = before; });
      FlutterError.onError!(FlutterErrorDetails(exception: StateError('widget exploded'), stack: _stack()));
      final handled = PlatformDispatcher.instance.onError!(ArgumentError('async boom'), _stack('x'));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(handled, isTrue, reason: 'true = handled, the app keeps running');
      expect(seen.length, 1, reason: 'the previous handler (the console in a real app) still sees it');
      expect(c.bodies.map((b) => b['message']), ['StateError: Bad state: widget exploded', 'ArgumentError: Invalid argument(s): async boom']);
    });

    test('runGuarded reports an error thrown in the zone instead of ending the app', () async {
      final c = _Capture();
      final done = Completer<void>();
      runGuarded(_reporter(c), () async { Future<void>.delayed(const Duration(milliseconds: 5), () => throw StateError('zone boom')); Future<void>.delayed(const Duration(milliseconds: 60), done.complete); });
      await done.future;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(c.bodies.single['message'], 'StateError: Bad state: zone boom');
    });
  });

  group('the real sender', () {
    test('posts the body to /app/errors with the version headers and WITHOUT a session token; every status is accepted', () async {
      final seen = <RequestOptions>[];
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1', validateStatus: (_) => true))..httpClientAdapter = _Fixed((o) { seen.add(o); return ResponseBody.fromString('', 204); });
      final send = httpReportSender(baseUrl: 'http://x', app: () => _app, dio: dio);
      await send({'message': 'm'});
      expect(seen.single.method, 'POST');
      expect(seen.single.path, '/app/errors');
      expect(seen.single.headers['Authorization'], isNull);
      expect([seen.single.headers['X-App-Version'], seen.single.headers['X-App-Platform'], seen.single.headers['X-Client']], ['1.4.0+7', 'android', 'mobile']);
      expect(seen.single.data, {'message': 'm'});
      final c = CrashReporter(app: _app, send: httpReportSender(baseUrl: 'http://x', app: () => _app, dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1', validateStatus: (_) => true))..httpClientAdapter = _Fixed((_) => ResponseBody.fromString('', 429))), route: () => '/');
      expect(await c.report(StateError('rate limited'), _stack()), isNotNull, reason: 'a 429 is just dropped');
    });
  });
}

class _Fixed implements HttpClientAdapter {
  _Fixed(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async => respond(o);
  @override
  void close({bool force = false}) {}
}
