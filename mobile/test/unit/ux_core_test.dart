import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:jr_driver/core/format.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/stops_panel.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions o, int n) respond;
  int calls = 0;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async => respond(o, ++calls);
  @override
  void close({bool force = false}) {}
}

ResponseBody _res(int status, String body, {String type = 'application/json'}) => ResponseBody.fromString(body, status, headers: {Headers.contentTypeHeader: [type]});

ApiClient _client(_Adapter a, {void Function()? onUnauth, void Function(bool)? onConn, List<Duration> retry = const []}) =>
    ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a, onUnauthorized: onUnauth, onConnectivity: onConn, retryDelays: retry);

DioException _conn() => DioException.connectionError(requestOptions: RequestOptions(), reason: 'offline');

void main() {
  group('ApiClient — poor-network behaviour', () {
    test('timeouts become TIMEOUT (still "network": the action may or may not have been applied)', () async {
      final a = _Adapter((o, n) => throw DioException.receiveTimeout(timeout: const Duration(seconds: 1), requestOptions: o));
      await expectLater(_client(a).post('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TIMEOUT').having((e) => e.isNetwork, 'network', true)));
    });

    test('a proxy 502/503/504 without our JSON envelope is UNAVAILABLE, not a crash', () async {
      for (final st in [502, 503, 504]) {
        final a = _Adapter((o, n) => _res(st, '<html>Bad gateway</html>', type: 'text/html'));
        await expectLater(_client(a).get('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNAVAILABLE').having((e) => e.isTransient, 'transient', true)), reason: '$st');
      }
    });

    test('a bare 401 (no envelope) still signs the driver out, except on /auth', () async {
      var n = 0;
      final a = _Adapter((o, c) => _res(401, 'nope', type: 'text/plain'));
      final c = _client(a, onUnauth: () => n++);
      await expectLater(c.get('/driver/overview'), throwsA(isA<ApiException>().having((e) => e.isAuth, 'auth', true)));
      expect(n, 1);
      await expectLater(c.post('/auth/login'), throwsA(isA<ApiException>()));
      expect(n, 1);
    });

    test('413 and 429 map to their own codes', () async {
      await expectLater(_client(_Adapter((o, n) => _res(413, 'too big', type: 'text/plain'))).post('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FILE_TOO_LARGE')));
      await expectLater(_client(_Adapter((o, n) => _res(429, 'slow down', type: 'text/plain'))).post('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'RATE_LIMITED')));
    });

    test('a 200 that is not JSON (captive portal) is BAD_RESPONSE, an empty 204 is {}', () async {
      await expectLater(_client(_Adapter((o, n) => _res(200, '<html>Wi-Fi login</html>', type: 'text/html'))).get('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'BAD_RESPONSE')));
      expect(await _client(_Adapter((o, n) => ResponseBody.fromString('', 204))).post('/x'), isEmpty);
    });

    test('GET is retried after a dropped connection and succeeds; POST is never retried', () async {
      final get = _Adapter((o, n) => n < 3 ? throw _conn() : _res(200, '{"ok":true}'));
      expect(await _client(get, retry: const [Duration.zero, Duration.zero]).get('/x'), {'ok': true});
      expect(get.calls, 3);
      final post = _Adapter((o, n) => throw _conn());
      await expectLater(_client(post, retry: const [Duration.zero, Duration.zero]).post('/offers/1/stops/2/deliver'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NETWORK')));
      expect(post.calls, 1, reason: 'a repeated deliver could double-apply: the UI verifies the outcome instead');
    });

    test('connectivity callback: false on a dropped connection, true as soon as the server answers anything', () async {
      final seen = <bool>[];
      final down = _Adapter((o, n) => throw _conn());
      await expectLater(_client(down, onConn: seen.add).get('/x'), throwsA(isA<ApiException>()));
      final err = _Adapter((o, n) => _res(409, '{"error":{"code":"CONFLICT","message":"m"}}'));
      await expectLater(_client(err, onConn: seen.add).get('/x'), throwsA(isA<ApiException>()));
      expect(seen, [false, true]);
    });

    test('lists tolerate a missing or odd `items` and skip non-object rows', () async {
      final a = _Adapter((o, n) => _res(200, o.path.endsWith('/driver/jobs') ? '{"items":[1,{"offerId":"o1","ref":"R"},{"noOfferId":true}]}' : '{}'));
      final api = DriverApi(_client(a));
      final jobs = await api.jobs(active: true);
      expect(jobs.map((j) => j.offerId), ['o1']);
      expect(await api.withdrawals(), isEmpty);
      expect(await api.opportunities(), isEmpty);
    });
  });

  group('models — version drift', () {
    test('a job with new server fields (partnerId, partnerStatus, ...) and missing optional ones still parses', () {
      final j = Job({'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-1', 'service': 'delivery_driver', 'status': 'accepted', 'partnerId': 'p9', 'partnerStatus': 'confirmed', 'somethingNew': {'a': 1}, 'actions': ['checkin', 7, null]});
      expect(j.actions, ['checkin']);
      expect(j.pickupCity, '');
      expect(j.expectedUnits, 0);
      expect(j.manifest, isFalse);
      expect(j.stops, isEmpty);
      expect(j.currentStop, isNull);
      expect(j.stopsSummary.total, 0);
      expect(j.allowPartial, isTrue);
    });

    test('wrong types degrade to defaults instead of throwing', () {
      final j = Job({'offerId': 'o1', 'expectedUnits': '12', 'loadedUnits': 'x', 'stops': ['bad', {'id': 's1', 'seq': '3', 'lat': 'n/a', 'address': 5, 'current': true}, {'noId': 1}], 'pickup': 'nope', 'stopsSummary': [1]});
      expect(j.expectedUnits, 12);
      expect(j.loadedUnits, isNull);
      expect(j.pickup, isNull);
      expect(j.stops.length, 1);
      expect(j.currentStop!.seq, 3);
      expect(j.currentStop!.lat, isNull);
      expect(j.currentStop!.address, '5');
      expect(j.stopsSummary.total, 0);
    });

    test('Overview without a wallet block, with a malformed suspension date', () {
      final o = Overview({'availability': 'available', 'suspendedUntil': 'garbage'});
      expect(o.availableCents, 0);
      expect(o.pendingCents, 0);
      expect(o.suspended, isFalse);
      expect(o.available, isTrue);
    });
  });

  group('formatting', () {
    test('unparseable dates render as a dash, never throw', () {
      expect(fmtDateTime('not a date', 'en'), '—');
      expect(fmtDateTime('', 'ar'), '—');
      expect(fmtTime('nope'), '—');
    });
    test('Arabic-Indic and Persian digits are normalised for codes, phones and amounts', () {
      expect(latinDigits('٠٥٠٠٠٠٠٠١١'), '0500000011');
      expect(latinDigits('۱۲۳۴'), '1234');
      expect(sarToCents('١٢٫٥٠'), 1250);
      expect(const LatinDigitsFormatter().formatEditUpdate(TextEditingValue.empty, const TextEditingValue(text: '١٢٣٤')).text, '1234');
    });
  });

  group('session handling', () {
    /// [fresh] = a first launch of the app (no install marker yet).
    Future<ProviderContainer> container(FakeApi api, MemoryTokenStore store, {bool fresh = false}) async {
      SharedPreferences.setMockInitialValues({if (!fresh) installMarkerKey: '1'});
      final prefs = await SharedPreferences.getInstance();
      return ProviderContainer(retry: (_, _) => null, overrides: [apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(store), prefsProvider.overrideWithValue(prefs)]);
    }

    test('a server error (500) or no signal on app start keeps the session — only a 401 signs out', () async {
      final store = MemoryTokenStore()..write('tok');
      final api = FakeApi()..meError = ApiException('INTERNAL', 'boom', status: 500);
      final c = await container(api, store);
      addTearDown(c.dispose);
      await expectLater(c.read(authProvider.future), throwsA(isA<ApiException>()));
      expect(await store.read(), 'tok', reason: 'a blip on the server must not log every driver out');
      c.invalidate(authProvider);
      api.meError = ApiException('NETWORK', 'offline');
      await expectLater(c.read(authProvider.future), throwsA(isA<ApiException>()));
      expect(await store.read(), 'tok');
    });

    test('provider retry policy: only transient failures, once — never a minute of spinner', () {
      expect(appRetry(0, ApiException('NETWORK', 'x')), const Duration(seconds: 1));
      expect(appRetry(1, ApiException('NETWORK', 'x')), isNull);
      expect(appRetry(0, ApiException('UNAUTHENTICATED', 'x')), isNull);
      expect(appRetry(0, ApiException('NOT_FOUND', 'x', status: 404)), isNull);
      expect(appRetry(0, ApiException('UNAVAILABLE', 'x', status: 503)), const Duration(seconds: 1));
    });

    test('a 401 on app start clears the token and lands on signed-out (no crash)', () async {
      final store = MemoryTokenStore()..write('tok');
      final api = FakeApi()..meError = ApiException('UNAUTHENTICATED', 'expired', status: 401);
      final c = await container(api, store);
      addTearDown(c.dispose);
      final s = await c.read(authProvider.future);
      expect(s.signedIn, isFalse);
      expect(await store.read(), isNull);
    });

    test('expire() (a 401 mid-session) clears the token and flags the session as expired for the sign-in banner', () async {
      final store = MemoryTokenStore()..write('tok');
      final c = await container(FakeApi(), store);
      addTearDown(c.dispose);
      expect((await c.read(authProvider.future)).signedIn, isTrue);
      c.read(authProvider.notifier).expire();
      expect(c.read(authProvider).value!.signedIn, isFalse);
      expect(c.read(authProvider).value!.expired, isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(await store.read(), isNull);
    });

    test('a straggling 401 after a deliberate sign-out does not turn the sign-in screen into "session expired"', () async {
      final store = MemoryTokenStore()..write('tok');
      final api = FakeApi();
      final c = await container(api, store);
      addTearDown(c.dispose);
      await c.read(authProvider.future);
      await c.read(authProvider.notifier).signOut();
      expect(c.read(authProvider).value!.signedIn, isFalse);
      c.read(authProvider.notifier).expire(); // the late answer of a request that was in flight
      expect(c.read(authProvider).value!.expired, isFalse);
    });

    test('signing out takes the driver offline first (decision D2), then ends the session and forgets the token', () async {
      final store = MemoryTokenStore()..write('tok');
      final api = FakeApi();
      final c = await container(api, store);
      addTearDown(c.dispose);
      await c.read(authProvider.future);
      await c.read(authProvider.notifier).signOut();
      expect(api.calls.where((x) => x == 'goOffline' || x == 'logout'), ['goOffline', 'logout'], reason: 'offline while the session still works, then logout');
      expect(await store.read(), isNull);
    });

    test('a fresh install drops a session token left in the keychain by an earlier install (iOS keeps the keychain, not the preferences)', () async {
      final store = MemoryTokenStore()..write('stale-token-of-the-previous-install');
      final c = await container(FakeApi(), store, fresh: true);
      addTearDown(c.dispose);
      expect((await c.read(authProvider.future)).signedIn, isFalse);
      expect(await store.read(), isNull);
      expect(c.read(prefsProvider).getString(installMarkerKey), isNotNull, reason: 'next launches keep the session');
    });

    test('403 PASSWORD_CHANGE_REQUIRED sends a signed-in driver to "choose a new password" (defence in depth)', () async {
      final store = MemoryTokenStore()..write('tok');
      final c = await container(FakeApi(), store);
      addTearDown(c.dispose);
      await c.read(authProvider.future);
      expect(c.read(authProvider).value!.user?['mustChangePassword'], isNot(true));
      c.read(authProvider.notifier).requirePasswordChange();
      expect(c.read(authProvider).value!.user?['mustChangePassword'], isTrue);
      expect(c.read(authProvider).value!.signedIn, isTrue, reason: 'the session itself stays');
    });
  });

  group('stop drafts', () {
    test('typed parcel code and receiver survive until the stop is delivered', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final n = c.read(stopDraftProvider.notifier);
      n.put('s1', code: 'JR-1-001');
      n.put('s1', receiver: 'Khalid');
      expect(c.read(stopDraftProvider)['s1'], (code: 'JR-1-001', receiver: 'Khalid'));
      n.clear('s1');
      expect(c.read(stopDraftProvider), isEmpty);
    });
  });
}
