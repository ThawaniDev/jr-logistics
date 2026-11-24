import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/app_info.dart';
import 'package:jr_driver/core/config.dart';
import 'package:jr_driver/core/version_gate.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/extra_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';

/// Update L / M — the version headers on every request, the forced-update signal (426) and the cold-start check against the catalog's minimum.
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

const _app = AppInfo(version: '1.4.0', build: '7', platform: 'ios', osVersion: 'iOS 17');

ApiClient _client(_Adapter a, {AppInfo app = _app, void Function(UpgradeInfo)? onUpgrade, TokenStore? tokens}) =>
    ApiClient(baseUrl: 'http://x', tokens: tokens ?? MemoryTokenStore(), app: app, dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a, onUpgradeRequired: onUpgrade, retryDelays: const []);

Map<String, Object?> _catalog({String? ios, String? android, String? iosUrl, String? androidUrl}) => {
      'policy': {'app': {'minVersion': {'ios': ios ?? '', 'android': android ?? ''}, 'storeUrl': {'ios': iosUrl ?? '', 'android': androidUrl ?? ''}}},
    };

void main() {
  group('version numbers (the server compares them the same way)', () {
    test('parseVersion reads 1–4 numbers and an optional +build, and nothing else', () {
      expect(parseVersion('1.2.3')!.parts, [1, 2, 3, 0]);
      expect(parseVersion('1.2')!.parts, [1, 2, 0, 0]);
      expect(parseVersion('v1.2.3+45')!.build, 45);
      expect(parseVersion('1.2.3.4')!.parts, [1, 2, 3, 4]);
      for (final bad in ['', 'abc', '1.x', '1..2', '1.2.3.4.5', '1.2.3+', null]) { expect(parseVersion(bad), isNull, reason: '$bad'); }
    });

    test('isVersionBelow: older parts lose, the build only counts when the minimum names one, an unreadable version is older than anything', () {
      bool below(String cur, String min) => isVersionBelow(parseVersion(cur), parseVersion(min)!);
      expect(below('1.0.0', '1.0.1'), isTrue);
      expect(below('1.0.1', '1.0.1'), isFalse);
      expect(below('1.2.0', '1.10.0'), isTrue, reason: 'numbers, not strings');
      expect(below('2.0.0', '1.99.99'), isFalse);
      expect(below('1.0.0+1', '1.0.0'), isFalse, reason: 'the minimum names no build');
      expect(below('1.0.0+1', '1.0.0+5'), isTrue);
      expect(below('1.0.0', '1.0.0+5'), isTrue, reason: 'no build counts as 0');
      expect(below('1.0.0+9', '1.0.0+5'), isFalse);
      expect(isVersionBelow(null, parseVersion('0.0.1')!), isTrue);
    });
  });

  group('catalog minimum (cold start; the catalog is exempt from the 426)', () {
    test('no policy, no minimum, a malformed minimum or an up-to-date app: nothing to do', () {
      expect(upgradeFromCatalog({}, _app), isNull);
      expect(upgradeFromCatalog(_catalog(), _app), isNull);
      expect(upgradeFromCatalog(_catalog(ios: 'soon'), _app), isNull, reason: 'a malformed minimum is never enforced');
      expect(upgradeFromCatalog(_catalog(ios: '1.4.0'), _app), isNull);
      expect(upgradeFromCatalog(_catalog(ios: '1.3.9+99'), _app), isNull);
    });

    test('the installed version below the minimum of ITS platform asks for the update, with that platform\'s store link', () {
      final u = upgradeFromCatalog(_catalog(ios: '1.5.0', android: '1.0.0', iosUrl: 'https://apps.apple.com/app/jr', androidUrl: 'https://play.google.com/store/apps/details?id=jr'), _app)!;
      expect([u.minVersion, u.currentVersion, u.platform], ['1.5.0', '1.4.0+7', 'ios']);
      expect(u.storeUri.toString(), 'https://apps.apple.com/app/jr');
      const android = AppInfo(version: '1.4.0', build: '7', platform: 'android');
      expect(upgradeFromCatalog(_catalog(ios: '9.0.0', android: '1.0.0'), android), isNull, reason: 'the iOS minimum is not the Android one');
      expect(upgradeFromCatalog(_catalog(android: '2.0.0', androidUrl: 'https://play.google.com/x'), android)!.storeUri.toString(), 'https://play.google.com/x');
    });

    test('a store link that is not https / http is not offered (the screen then says to open the store by hand)', () {
      expect(const UpgradeInfo(storeUrl: 'javascript:alert(1)').storeUri, isNull);
      expect(const UpgradeInfo(storeUrl: '').storeUri, isNull);
      expect(const UpgradeInfo(storeUrl: 'itms-apps://x').storeUri, isNull);
      expect(const UpgradeInfo(storeUrl: 'https://apps.apple.com/app/jr').storeUri, isNotNull);
    });

    test('UpgradeInfo.fromDetails reads the 426 details; odd types read as empty', () {
      final u = UpgradeInfo.fromDetails({'minVersion': '2.0.0', 'currentVersion': '1.0.0+1', 'platform': 'android', 'storeUrl': 'https://p/x'});
      expect([u.minVersion, u.currentVersion, u.platform, u.storeUrl], ['2.0.0', '1.0.0+1', 'android', 'https://p/x']);
      expect(UpgradeInfo.fromDetails({'minVersion': 5, 'storeUrl': null}).minVersion, '');
    });
  });

  group('every request says which build is asking', () {
    test('X-App-Version, X-App-Platform and X-Client go out on every call (GET, POST, with and without a stored token)', () async {
      final a = _Adapter((_) => _json(200, {'ok': true}));
      final tokens = MemoryTokenStore()..write('tok');
      final c = _client(a, tokens: tokens);
      await c.get('/driver/overview');
      await c.post('/offers/o1/accept', {'termsAccepted': true});
      await _client(a).get('/catalog');
      expect(a.seen.length, 3);
      for (final o in a.seen) {
        expect(o.headers['X-App-Version'], '1.4.0+7', reason: o.path);
        expect(o.headers['X-App-Platform'], 'ios', reason: o.path);
        expect(o.headers['X-Client'], 'mobile', reason: o.path);
      }
      expect(a.seen.first.headers['Authorization'], 'Bearer tok');
    });

    test('the default build is the pubspec one: AppConfig.version and build equal pubspec.yaml', () {
      final m = RegExp(r'^version:\s*([0-9.]+)\+(\d+)', multiLine: true).firstMatch(File('pubspec.yaml').readAsStringSync())!;
      expect(AppConfig.version, m.group(1));
      expect(AppConfig.build, m.group(2));
      final fb = AppInfo.fallback();
      expect(fb.full, '${m.group(1)}+${m.group(2)}');
      expect(const ['ios', 'android'], contains(fb.platform));
    });

    test('AppInfo.full omits an empty build', () {
      expect(const AppInfo(version: '1.0.0', build: '', platform: 'android').full, '1.0.0');
    });
  });

  group('426 UPGRADE_REQUIRED', () {
    Map<String, Object?> envelope(Map<String, Object?> details) => {'error': {'code': 'UPGRADE_REQUIRED', 'message': 'Please update the app to continue', 'details': details}};

    test('the details reach onUpgradeRequired and the error is still thrown to the caller', () async {
      final got = <UpgradeInfo>[];
      final c = _client(_Adapter((_) => _json(426, envelope({'minVersion': '2.0.0', 'currentVersion': '1.4.0+7', 'platform': 'ios', 'storeUrl': 'https://apps.apple.com/app/jr'}))), onUpgrade: got.add);
      await expectLater(c.get('/driver/overview'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UPGRADE_REQUIRED').having((e) => e.status, 'status', 426)));
      expect(got.length, 1);
      expect([got.first.minVersion, got.first.platform, got.first.storeUri.toString()], ['2.0.0', 'ios', 'https://apps.apple.com/app/jr']);
    });

    test('a 426 without the JSON envelope (a proxy rewrote the body) is the same signal, with no details', () async {
      final got = <UpgradeInfo>[];
      final c = _client(_Adapter((_) => ResponseBody.fromString('Upgrade Required', 426)), onUpgrade: got.add);
      await expectLater(c.get('/driver/jobs'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UPGRADE_REQUIRED')));
      expect(got.length, 1);
      expect(got.first.storeUrl, '');
    });

    test('a 426 does not look like a lost connection or a dead session (no offline strip, no sign-out)', () async {
      var online = true, unauthorized = 0;
      final c = ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter((_) => _json(426, envelope({}))), onConnectivity: (v) => online = v, onUnauthorized: () => unauthorized++, retryDelays: const []);
      await expectLater(c.get('/x'), throwsA(isA<ApiException>()));
      expect(online, isTrue);
      expect(unauthorized, 0);
    });

    test('other errors never raise the update signal', () async {
      var n = 0;
      for (final status in [400, 401, 403, 404, 409, 500]) {
        final c = _client(_Adapter((_) => _json(status, {'error': {'code': 'INTERNAL', 'message': 'x', 'details': {}}})), onUpgrade: (_) => n++);
        await expectLater(c.get('/x'), throwsA(isA<ApiException>()));
      }
      expect(n, 0);
    });

    test('attachment downloads (raw bytes) raise it too', () async {
      final got = <UpgradeInfo>[];
      final api = ExtraApi(_client(_Adapter((_) => ResponseBody.fromString('', 426)), onUpgrade: got.add));
      await expectLater(api.attachmentBytes('a1'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UPGRADE_REQUIRED')));
      expect(got.length, 1);
    });

    test('the provider keeps what it already knows when a bare 426 follows the catalog\'s store link', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final n = c.read(upgradeProvider.notifier);
      expect(c.read(upgradeProvider), isNull);
      n.require(const UpgradeInfo(minVersion: '2.0.0', storeUrl: 'https://apps.apple.com/app/jr', platform: 'ios'));
      n.require(const UpgradeInfo()); // a 426 without details
      expect([c.read(upgradeProvider)!.minVersion, c.read(upgradeProvider)!.storeUrl], ['2.0.0', 'https://apps.apple.com/app/jr']);
      n.require(const UpgradeInfo(minVersion: '2.1.0'));
      expect(c.read(upgradeProvider)!.minVersion, '2.1.0');
      n.clear();
      expect(c.read(upgradeProvider), isNull);
    });
  });
}
