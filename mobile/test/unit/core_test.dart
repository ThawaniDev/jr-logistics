import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/format.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import '../helpers.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  RequestOptions? last;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async { last = o; return respond(o); }
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, String body) => ResponseBody.fromString(body, status, headers: {Headers.contentTypeHeader: ['application/json']});

void main() {
  group('money & formatting', () {
    test('sarToCents parses without float drift and rejects junk', () {
      expect(sarToCents('12.5'), 1250);
      expect(sarToCents('0.1'), 10);
      expect(sarToCents('19.99'), 1999);
      expect(sarToCents('7'), 700);
      expect(sarToCents('7,25'), 725);
      expect(sarToCents(''), isNull);
      expect(sarToCents('1.234'), isNull);
      expect(sarToCents('-5'), isNull);
      expect(sarToCents('abc'), isNull);
    });
    test('fmtMoney shows Latin digits per language', () {
      expect(fmtMoney(12550, 'en'), 'SAR 125.50');
      expect(fmtMoney(12550, 'ar'), '125.50 ر.س');
      expect(fmtMoney(null, 'en'), '—');
      expect(fmtMoney(123456789, 'en'), 'SAR 1,234,567.89');
    });
    test('dates render in Saudi time (UTC+3)', () {
      expect(fmtTime('2026-12-01T06:00:00.000Z'), '09:00');
      expect(fmtDateTime('2026-12-01T22:30:00.000Z', 'en'), '2 Dec 2026 · 01:30'); // crosses midnight in KSA
      expect(fmtDateTime('2026-03-05T06:05:00.000Z', 'ar'), '5 مارس 2026 · 09:05');
      expect(fmtDateTime('2026-03-05T06:05:00.000Z', 'ur'), '5 مارچ 2026 · 09:05');
      expect(fmtDateTime(null, 'en'), '—');
    });
    test('distance & duration', () {
      expect(fmtKm(12345), '12.3 km');
      expect(fmtDuration(600), '10 min');
      expect(fmtDuration(5400), '1 h 30 min');
    });
  });

  group('models', () {
    test('Job exposes server-driven actions and derived flags', () {
      final j = mkJob(status: 'attendance_confirmed', actions: ['ack_loading', 'report_no_work'], extra: {'loadedUnits': 18});
      expect(j.can('ack_loading'), isTrue);
      expect(j.can('checkin'), isFalse);
      expect(j.awaitingLoadingAck, isTrue);
      expect(j.isActive, isTrue);
      expect(j.isDelivery, isTrue);
      expect(j.deliveryLat, 24.7);
      expect(mkJob(status: 'completed').isActive, isFalse);
    });
    test('Overview flags', () {
      final o = Overview({'availability': 'available', 'verificationStatus': 'verified', 'suspendedUntil': DateTime.now().add(const Duration(days: 1)).toIso8601String(), 'wallet': {'availableCents': 1, 'heldCents': 2, 'pendingCents': 3}});
      expect(o.available, isTrue); expect(o.verified, isTrue); expect(o.suspended, isTrue); expect(o.pendingCents, 3);
      expect(Overview({'wallet': {'availableCents': 0, 'heldCents': 0, 'pendingCents': 0}, 'suspendedUntil': '2020-01-01T00:00:00Z'}).suspended, isFalse);
    });
    test('RoutePlan parsing distinguishes Google from estimates', () {
      final p = RoutePlan({'provider': 'local_heuristic', 'warning': 'ROUTING_PROVIDER_NOT_CONFIGURED', 'order': ['a', 'b'], 'legs': [{'from': 'origin', 'to': 'a', 'distanceM': 1000, 'durationS': 120}], 'totalDistanceM': 1000, 'totalDurationS': 120});
      expect(p.isGoogle, isFalse); expect(p.warning, isNotNull); expect(p.legs.single.to, 'a');
      expect(RoutePlan({'provider': 'google_routes', 'order': [], 'legs': [], 'totalDistanceM': 0, 'totalDurationS': 0}).isGoogle, isTrue);
    });
    test('googleMapsDirections keeps the reviewed order: waypoints then final destination', () {
      final u = googleMapsDirections(['24.7,46.7', '24.8,46.8', 'Olaya St, Riyadh']);
      expect(u.host, 'www.google.com');
      expect(u.queryParameters['destination'], 'Olaya St, Riyadh');
      expect(u.queryParameters['waypoints'], '24.7,46.7|24.8,46.8');
      expect(u.queryParameters['travelmode'], 'driving');
      expect(googleMapsDirections(['1,2']).queryParameters.containsKey('waypoints'), isFalse);
    });
  });

  group('i18n assets (exported from the web source of truth)', () {
    final en = loadDict('en'), ar = loadDict('ar'), ur = loadDict('ur');
    test('ar/en/ur have identical keys and no empty values', () {
      expect(ar.keys.toSet(), en.keys.toSet());
      expect(ur.keys.toSet(), en.keys.toSet());
      for (final k in en.keys) { expect(ar[k]!.trim(), isNotEmpty, reason: 'ar $k'); expect(ur[k]!.trim(), isNotEmpty, reason: 'ur $k'); }
    });
    test('every translation key used in Dart sources exists', () {
      final used = <String>{};
      final re = RegExp(r"""(?:\bt|\btr|\.tr)\(\s*'([a-z_]+\.[a-zA-Z_0-9.]+)'""");
      final re2 = RegExp(r"""success: '([a-z_]+\.[a-z_0-9.]+)'""");
      final re3 = RegExp(r"""success: [a-z]+ \? '([a-z_]+\.[a-z_0-9.]+)' : '([a-z_]+\.[a-z_0-9.]+)'""");
      for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
        final s = f.readAsStringSync();
        for (final m in re.allMatches(s)) { used.add(m.group(1)!); }
        for (final m in re2.allMatches(s)) { used.add(m.group(1)!); }
        for (final m in re3.allMatches(s)) { used..add(m.group(1)!)..add(m.group(2)!); }
      }
      expect(used.where((k) => !en.containsKey(k)).toList(), isEmpty);
    });
    test('dynamic namespaces used by screens are fully covered', () {
      const jobStatuses = ['offered', 'accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'qty_disputed', 'pending_settlement', 'completed', 'rejected', 'expired', 'cancelled', 'no_show', 'replaced'];
      for (final s in jobStatuses) { expect(en.containsKey('jobstatus.$s'), isTrue, reason: s); expect(en.containsKey('job.hint_$s'), isTrue, reason: 'hint $s'); }
      expect(en.containsKey('job.hint_attendance_confirmed_ack'), isTrue);
      for (final k in ['dry', 'cold']) { expect(en.containsKey('temp.$k'), isTrue); }
      for (final c in ['err.UNAUTHENTICATED', 'err.FORBIDDEN', 'err.INSUFFICIENT_FUNDS', 'err.SLOT_TAKEN', 'err.OVERLAPPING_JOB', 'err.VERIFICATION_REQUIRED', 'err.TERMS_REQUIRED', 'err.INVALID_TRANSITION', 'err.RATE_LIMITED', 'err.NOT_ELIGIBLE']) { expect(en.containsKey(c), isTrue, reason: c); }
    });
    test('Strings interpolates, falls back to English then key; RTL detection', () {
      final s = Strings.fromMaps('ur', {'a': 'سلام {name}'}, {'a': 'Hi {name}', 'b': 'English only'});
      expect(s('a', {'name': 'علی'}), 'سلام علی');
      expect(s('b'), 'English only');
      expect(s('missing.key'), 'missing.key');
      expect(isRtl('ar'), isTrue); expect(isRtl('ur'), isTrue); expect(isRtl('en'), isFalse);
    });
  });

  group('ApiClient', () {
    ApiClient make(ResponseBody Function(RequestOptions) r, {TokenStore? tokens, void Function()? onUnauth}) {
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter(r);
      return ApiClient(baseUrl: 'http://x', tokens: tokens ?? MemoryTokenStore(), dio: dio, onUnauthorized: onUnauth);
    }
    test('attaches bearer token', () async {
      final store = MemoryTokenStore(); await store.write('abc');
      late RequestOptions seen;
      final c = make((o) { seen = o; return _json(200, '{"ok":true}'); }, tokens: store);
      await c.get('/x');
      expect(seen.headers['Authorization'], 'Bearer abc');
    });
    test('maps the stable error envelope to ApiException', () async {
      final c = make((o) => _json(409, '{"error":{"code":"SLOT_TAKEN","message":"taken","correlation_id":"c1","details":{"a":1}}}'));
      await expectLater(c.post('/offers/1/accept'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SLOT_TAKEN').having((e) => e.status, 'status', 409).having((e) => e.details['a'], 'details', 1)));
    });
    test('401 outside /auth triggers onUnauthorized; /auth does not', () async {
      var n = 0;
      final c = make((o) => _json(401, '{"error":{"code":"UNAUTHENTICATED","message":"no","details":{}}}'), onUnauth: () => n++);
      await expectLater(c.get('/driver/overview'), throwsA(isA<ApiException>()));
      expect(n, 1);
      await expectLater(c.post('/auth/otp/verify', {}), throwsA(isA<ApiException>()));
      expect(n, 1);
    });
    test('network failures become NETWORK, not crashes', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter((_) => throw DioException.connectionError(requestOptions: RequestOptions(), reason: 'offline'));
      final c = ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio);
      await expectLater(c.get('/x'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', true)));
    });
  });
}
