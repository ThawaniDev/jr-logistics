import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/version_gate.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/privacy_repo.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/providers_extra.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';

/// Update L / M — the privacy repository (the one place that knows the URLs) and the "session ended while a deletion request was open" memory.
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
ResponseBody _bytes(int status, List<int> b, {String type = 'application/json'}) => ResponseBody.fromBytes(b, status, headers: {Headers.contentTypeHeader: [type]});
Map<String, Object?> _envelope(String code, {Map<String, Object?> details = const {}}) => {'error': {'code': code, 'message': 'x', 'details': details}};

PrivacyRepository _repo(_Adapter a, {void Function(UpgradeInfo)? onUpgrade, void Function()? onUnauthorized, void Function(bool)? onConnectivity}) =>
    PrivacyRepository(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a, onUpgradeRequired: onUpgrade, onUnauthorized: onUnauthorized, onConnectivity: onConnectivity, retryDelays: const []));

void main() {
  group('PrivacyRepository', () {
    test('status reads GET /privacy/status', () async {
      final a = _Adapter((_) => _json(200, {'role': 'driver', 'deletion': {'supported': true, 'canRequest': true, 'blockers': [{'code': 'open_jobs', 'count': 1}]}}));
      final s = await _repo(a).status();
      expect([a.seen.single.method, a.seen.single.path], ['GET', '/privacy/status']);
      expect(s.blockers.single.code, 'open_jobs');
    });

    test('the export is the raw attachment: the bytes arrive exactly as sent (not parsed, not re-encoded), also with non-ASCII text', () async {
      final payload = utf8.encode('{"profile":{"name":"عمر"},"jobs":[]}');
      final a = _Adapter((_) => _bytes(200, payload));
      final got = await _repo(a).exportData();
      expect(a.seen.single.path, '/privacy/export');
      expect(a.seen.single.responseType, ResponseType.bytes);
      expect(got, Uint8List.fromList(payload));
      expect(jsonDecode(utf8.decode(got))['profile']['name'], 'عمر');
    });

    test('an empty export is an error, not an empty file', () async {
      await expectLater(_repo(_Adapter((_) => _bytes(200, const []))).exportData(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'BAD_RESPONSE')));
    });

    test('export errors keep the server\'s envelope: 429 RATE_LIMITED, 401 signs out, 426 asks for the update', () async {
      var unauthorized = 0;
      final upgrades = <UpgradeInfo>[];
      Future<void> run(int status, ResponseBody Function() body) => expectLater(_repo(_Adapter((_) => body()), onUnauthorized: () => unauthorized++, onUpgrade: upgrades.add).exportData(), throwsA(isA<ApiException>()));
      await expectLater(_repo(_Adapter((_) => _bytes(429, utf8.encode(jsonEncode(_envelope('RATE_LIMITED')))))).exportData(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'RATE_LIMITED').having((e) => e.status, 'status', 429)));
      await run(401, () => _bytes(401, utf8.encode(jsonEncode(_envelope('UNAUTHENTICATED')))));
      expect(unauthorized, 1);
      await run(426, () => _bytes(426, utf8.encode(jsonEncode(_envelope('UPGRADE_REQUIRED', details: {'minVersion': '2.0.0', 'storeUrl': 'https://apps.apple.com/app/jr'})))));
      expect(upgrades.single.minVersion, '2.0.0');
      await run(426, () => ResponseBody.fromString('', 426));
      expect(upgrades.length, 2, reason: 'a bare 426 raises it too');
      await run(401, () => ResponseBody.fromString('', 401));
      expect(unauthorized, 2);
    });

    test('a lost connection is NETWORK / TIMEOUT, and tells the offline strip', () async {
      var online = true;
      final r = _repo(_Adapter((o) => throw DioException.connectionError(requestOptions: o, reason: 'offline')), onConnectivity: (v) => online = v);
      await expectLater(r.exportData(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NETWORK')));
      expect(online, isFalse);
      await expectLater(_repo(_Adapter((o) => throw DioException.receiveTimeout(timeout: const Duration(seconds: 1), requestOptions: o))).exportData(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TIMEOUT')));
    });

    test('requestDeletion posts {reason, confirm: true}; the reason is trimmed, left out when blank and cut at 500 characters', () async {
      final a = _Adapter((_) => _json(201, {'request': {'id': 'pr1', 'status': 'requested'}}));
      final r = _repo(a);
      expect((await r.requestDeletion('  Changing jobs ')).open, isTrue);
      expect([a.seen.last.method, a.seen.last.path, a.seen.last.data], ['POST', '/privacy/delete-request', {'reason': 'Changing jobs', 'confirm': true}]);
      await r.requestDeletion('   ');
      expect(a.seen.last.data, {'confirm': true});
      await r.requestDeletion(null);
      expect(a.seen.last.data, {'confirm': true});
      await r.requestDeletion('x' * 900);
      expect((a.seen.last.data as Map)['reason'].toString().length, 500);
    });

    test('409 ERASURE_BLOCKED carries the blockers in its details; 409 CONFLICT = one is already open', () async {
      final blocked = _repo(_Adapter((_) => _json(409, _envelope('ERASURE_BLOCKED', details: {'role': 'driver', 'blockers': [{'code': 'wallet_funds', 'amountCents': 100}]}))));
      await expectLater(blocked.requestDeletion('x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'ERASURE_BLOCKED').having((e) => (e.details['blockers'] as List).length, 'blockers', 1)));
      await expectLater(_repo(_Adapter((_) => _json(409, _envelope('CONFLICT')))).requestDeletion('x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CONFLICT')));
    });

    test('cancelDeletion posts to /privacy/delete-request/cancel; 409 NOTHING_TO_DO when none is open', () async {
      final a = _Adapter((_) => _json(200, {'request': {'id': 'pr1', 'status': 'cancelled'}}));
      expect((await _repo(a).cancelDeletion()).status, 'cancelled');
      expect([a.seen.single.method, a.seen.single.path], ['POST', '/privacy/delete-request/cancel']);
      await expectLater(_repo(_Adapter((_) => _json(409, _envelope('NOTHING_TO_DO')))).cancelDeletion(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NOTHING_TO_DO')));
    });
  });

  group('the session ends while a deletion request is open', () {
    Future<ProviderContainer> signedIn({Map<String, Object> prefs = const {}}) async {
      SharedPreferences.setMockInitialValues({installMarkerKey: '1', ...prefs});
      final store = MemoryTokenStore();
      await store.write('tok');
      final c = ProviderContainer(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(await SharedPreferences.getInstance()), apiProvider.overrideWithValue(FakeApi()), tokenStoreProvider.overrideWithValue(store)]);
      addTearDown(c.dispose);
      await c.read(authProvider.future);
      return c;
    }

    test('with a request open, a 401 means "probably approved": the sign-in page can say so, once', () async {
      final c = await signedIn(prefs: {deletionRequestKey: true});
      expect(c.read(authProvider).value!.signedIn, isTrue);
      c.read(authProvider.notifier).expire();
      final s = c.read(authProvider).value!;
      expect([s.signedIn, s.expired, s.afterDeletionRequest], [false, true, true]);
      expect(c.read(prefsProvider).containsKey(deletionRequestKey), isFalse, reason: 'said once');
    });

    test('without one it is the usual "session expired"', () async {
      final c = await signedIn();
      c.read(authProvider.notifier).expire();
      final s = c.read(authProvider).value!;
      expect([s.expired, s.afterDeletionRequest], [true, false]);
    });

    test('the status keeps the memory current: open → remembered; withdrawn / declined → forgotten', () async {
      SharedPreferences.setMockInitialValues({installMarkerKey: '1'});
      final prefs = await SharedPreferences.getInstance();
      final repo = FakePrivacyRepo();
      final c = ProviderContainer(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(prefs), privacyRepoProvider.overrideWithValue(repo)]);
      addTearDown(c.dispose);
      repo.statusJson = {'deletion': {'supported': true, 'request': {'id': 'p', 'status': 'requested'}}};
      await c.read(privacyStatusProvider.future);
      expect(prefs.getBool(deletionRequestKey), isTrue);
      c.invalidate(privacyStatusProvider);
      repo.statusJson = {'deletion': {'supported': true, 'request': {'id': 'p', 'status': 'cancelled'}}};
      await c.read(privacyStatusProvider.future);
      expect(prefs.containsKey(deletionRequestKey), isFalse);
    });
  });
}
