import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/config.dart';
import 'package:jr_driver/core/format.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';

/// Audit K / A6 — logic fixes of the driver app (see memory/audit/mobile.md).
class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  final seen = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async { seen.add(o); return respond(o); }
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

ApiClient _client(_Adapter a, {TokenStore? tokens, void Function()? onPasswordChange, void Function()? onUnauthorized}) =>
    ApiClient(baseUrl: 'http://x', tokens: tokens ?? MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a, onPasswordChange: onPasswordChange, onUnauthorized: onUnauthorized, retryDelays: const []);

Map<String, Object?> _job(int n) => {'offerId': 'o$n', 'requestId': 'r$n', 'ref': 'JR-$n', 'status': 'completed', 'service': 'delivery_driver'};

void main() {
  group('amounts (finding 7)', () {
    test('sarToCents never overflows or throws on a long input', () {
      expect(sarToCents('100'), 10000);
      expect(sarToCents('999999999.99'), 99999999999);
      expect(sarToCents('99999999999999999999'), isNull, reason: '20 digits used to throw a FormatException while the sheet was building');
      expect(sarToCents('99999999999999999'), isNull, reason: '17 digits used to wrap around to a negative number');
      expect(sarToCents('٠٫٥'), 50);
      expect(sarToCents(''), isNull);
    });
  });

  group('tolerant JSON readers (finding 9)', () {
    test('numOf / mapOf / listOf / strOf give null or empty for the wrong type instead of throwing', () {
      expect(numOf(3), 3);
      expect(numOf('4.5'), 4.5);
      expect(numOf('x'), isNull);
      expect(numOf({'a': 1}), isNull);
      expect(mapOf({'a': 1}), {'a': 1});
      expect(mapOf([1]), isNull);
      expect(listOf([1, 'a']), [1, 'a']);
      expect(listOf('nope'), isEmpty);
      expect(strOf(5), isNull);
      expect(strOf('a'), 'a');
    });
  });

  group('server values without a dictionary text (finding 8)', () {
    final t = Strings.fromMaps('en', {'jobstatus.completed': 'Completed'}, {'jobstatus.completed': 'Completed', 'jobstatus.offered': 'Offered'});
    test('a known value reads from the dictionary (active language, then English)', () {
      expect(t.val('jobstatus', 'completed'), 'Completed');
      expect(t.val('jobstatus', 'offered'), 'Offered');
    });
    test('an unknown value of a newer server reads as itself — never as a raw key', () {
      expect(t.val('jobstatus', 'on_hold'), 'on hold');
      expect(t.val('stopfail', null), '');
      expect(t.knows('jobstatus.offered'), isTrue);
      expect(t.knows('jobstatus.on_hold'), isFalse);
    });
  });

  group('ApiClient: sessions and the temporary password', () {
    test('403 PASSWORD_CHANGE_REQUIRED calls onPasswordChange (and is still thrown to the caller)', () async {
      var n = 0;
      final c = _client(_Adapter((_) => _json(403, {'error': {'code': 'PASSWORD_CHANGE_REQUIRED', 'message': 'x', 'details': {}}})), onPasswordChange: () => n++);
      await expectLater(c.get('/driver/overview'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'PASSWORD_CHANGE_REQUIRED')));
      expect(n, 1);
    });

    test('revokeSession logs out the GIVEN token, never the stored one, and never throws', () async {
      final tokens = MemoryTokenStore()..write('stored');
      final a = _Adapter((_) => _json(200, {'ok': true}));
      final c = _client(a, tokens: tokens);
      await c.revokeSession('refused-account-token');
      expect(a.seen.single.path, '/auth/logout');
      expect(a.seen.single.headers['Authorization'], 'Bearer refused-account-token');
      await c.get('/x');
      expect(a.seen.last.headers['Authorization'], 'Bearer stored', reason: 'other calls still use the stored token');
      final down = _client(_Adapter((_) => throw DioException.connectionError(requestOptions: RequestOptions(), reason: 'offline')));
      await down.revokeSession('t'); // no exception
    });

    test('a driver who signs out goes offline and loses his shared location (calls both, tolerates failures)', () async {
      final a = _Adapter((o) => o.path == '/driver/availability' ? _json(500, {'error': {'code': 'INTERNAL', 'message': 'boom', 'details': {}}}) : _json(200, {'ok': true}));
      await DriverApi(_client(a)).goOffline();
      expect(a.seen.map((o) => '${o.method} ${o.path}'), ['PUT /driver/availability', 'DELETE /driver/location'], reason: 'the second call is made even when the first failed');
      expect(a.seen.first.data, {'available': false});
    });
  });

  group('paged lists (finding 1)', () {
    test('jobsPage reads items, total and page size; page 1 sends no page parameter, later pages do', () async {
      final a = _Adapter((o) => _json(200, {'items': [_job(1), _job(2)], 'page': o.queryParameters['page'] ?? 1, 'pageSize': 2, 'total': 5}));
      final api = DriverApi(_client(a));
      final p1 = await api.jobsPage(active: false);
      expect([p1.items.length, p1.total, p1.page, p1.pageSize], [2, 5, 1, 2]);
      expect(a.seen.last.queryParameters, {'scope': 'history'});
      final p2 = await api.jobsPage(active: false, page: 2);
      expect(p2.page, 2);
      expect(a.seen.last.queryParameters, {'scope': 'history', 'page': 2});
      expect((await api.jobs(active: true)).length, 2, reason: 'jobs() is still the first page');
    });

    test('an older server without total/page still parses', () async {
      final api = DriverApi(_client(_Adapter((_) => _json(200, {'items': [_job(1)]}))));
      final p = await api.jobsPage(active: false);
      expect([p.items.length, p.total, p.page], [1, 0, 1]);
    });

    test('wallet and notifications ask for page 2 with ?page=2 only', () async {
      final a = _Adapter((_) => _json(200, {'entries': [], 'items': []}));
      final api = DriverApi(_client(a));
      await api.wallet();
      expect(a.seen.last.queryParameters, isEmpty);
      await api.wallet(page: 2);
      expect(a.seen.last.queryParameters, {'page': 2});
      await api.notifications(page: 3);
      expect(a.seen.last.queryParameters, {'page': 3});
    });

    test('HistoryJobs loads the next page on demand, appends without duplicates and stops at the total', () async {
      final api = FakeApi()..historyPageSize = 3..historyJobs = [for (var i = 1; i <= 7; i++) Job(_job(i))];
      final c = ProviderContainer(retry: (_, _) => null, overrides: [apiProvider.overrideWithValue(api)]);
      addTearDown(c.dispose);
      c.listen(historyJobsProvider, (_, _) {});
      final first = await c.read(historyJobsProvider.future);
      final n = c.read(historyJobsProvider.notifier);
      expect([first.length, n.total, n.hasMore], [3, 7, true]);
      await n.loadMore();
      expect(c.read(historyJobsProvider).value!.map((j) => j.offerId), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']);
      expect(n.hasMore, isTrue);
      // a job that arrived meanwhile shifts the pages: the one already shown is not repeated
      api.historyJobs = [Job(_job(0)), ...api.historyJobs];
      api.historyTotal = 8;
      await n.loadMore();
      final ids = c.read(historyJobsProvider).value!.map((j) => j.offerId).toList();
      expect(ids.toSet().length, ids.length, reason: 'no duplicates');
      expect(api.pagesAsked, [1, 2, 3]);
      expect(n.hasMore, isTrue, reason: 'the job that shifted away is still missing from what is shown');
      await n.loadMore();
      expect(api.pagesAsked, [1, 2, 3, 4]);
      expect(n.hasMore, isFalse, reason: 'an empty page ends it — the "Load more" row must not stay forever');
    });
  });

  group('configuration (finding 23)', () {
    test('AppConfig.version equals the version in pubspec.yaml', () {
      final v = RegExp(r'^version:\s*([0-9.]+)', multiLine: true).firstMatch(File('pubspec.yaml').readAsStringSync())!.group(1);
      expect(AppConfig.version, v);
    });
    test('a debug / test build is never "misconfigured" (it may use the localhost default)', () {
      expect(AppConfig.misconfigured, isFalse);
    });
  });

  group('platform files (findings 16 and the launch screens)', () {
    test('the Android manifest does not require a camera and does not back the session up', () {
      final m = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
      expect(m, contains('android:name="android.hardware.camera" android:required="false"'));
      expect(m, contains('android:allowBackup="false"'));
      expect(RegExp(r'ACCESS_BACKGROUND_LOCATION').hasMatch(m), isFalse, reason: 'foreground-only location is the launch decision (D1)');
    });

    test('the native launch window follows the system appearance on Android (dark and light, also the Android 12 splash)', () {
      String read(String p) => File('android/app/src/main/res/$p').readAsStringSync();
      expect(read('values/colors.xml'), contains('#FFF6F8FB'));
      expect(read('values-night/colors.xml'), contains('#FF0B132B'));
      for (final d in ['drawable', 'drawable-v21']) { expect(read('$d/launch_background.xml'), contains('@color/jr_launch_bg')); expect(read('$d/launch_background.xml'), isNot(contains('@android:color/white'))); }
      expect(read('values/styles.xml'), contains('@color/jr_launch_bg'));
      expect(read('values-night/styles.xml'), contains('@color/jr_launch_bg'));
      expect(read('values-v31/styles.xml'), contains('windowSplashScreenBackground'));
      expect(read('values-night-v31/styles.xml'), contains('windowSplashScreenBackground'));
    });

    test('the iOS launch screen uses a named colour with a dark variant', () {
      final story = File('ios/Runner/Base.lproj/LaunchScreen.storyboard').readAsStringSync();
      expect(story, contains('name="LaunchBackground"'));
      expect(story, isNot(contains('red="1" green="1" blue="1"')), reason: 'the hard-coded white background is gone');
      final set = jsonDecode(File('ios/Runner/Assets.xcassets/LaunchBackground.colorset/Contents.json').readAsStringSync()) as Map;
      final colors = (set['colors'] as List).cast<Map>();
      expect(colors.length, 2);
      expect(colors.any((c) => c['appearances'] != null && ((c['appearances'] as List).first as Map)['value'] == 'dark'), isTrue);
    });
  });
}
