import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/format.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
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
    test('normalizeIban accepts SA + 22 digits (spaces / case ignored) and rejects the rest', () {
      expect(normalizeIban('sa03 8000 0000 6080 1016 7519'), 'SA0380000000608010167519');
      expect(normalizeIban('SA12'), isNull);
      expect(normalizeIban('GB0380000000608010167519'), isNull);
      expect(normalizeIban('SA03800000006080101675199'), isNull);
      expect(normalizeIban(''), isNull);
    });

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
    test('countdown formats m:ss and never goes negative', () {
      expect(fmtCountdown(600), '10:00');
      expect(fmtCountdown(65), '1:05');
      expect(fmtCountdown(9), '0:09');
      expect(fmtCountdown(-4), '0:00');
    });
  });

  group('per-parcel models (manifest jobs)', () {
    test('legacy payloads keep working: no manifest fields → not a manifest job, safe defaults', () {
      final j = mkJob();
      expect(j.manifest, isFalse);
      expect(j.stops, isEmpty);
      expect(j.currentStop, isNull);
      expect(j.routeApprovedAt, isNull);
      expect(j.routeApproved, isFalse);
      expect(j.allowPartial, isTrue);
      expect(j.stopsSummary.total, 0);
      expect(j.deliveryAddress, 'King Fahd Rd 120');
    });
    test('manifest job: stops, summary, current stop and null delivery/recipient', () {
      final j = mkManifestJob(stops: [mkStop(1, status: 'delivered'), mkStop(2, current: true, type: 'business'), mkStop(3), mkStop(4, status: 'failed', extra: {'failReason': 'refused'})]);
      expect(j.manifest, isTrue);
      expect(j.delivery, isNull);
      expect(j.recipient, isNull);
      expect(j.deliveryAddress, isNull);
      expect(j.routeApproved, isTrue);
      expect(j.stops.length, 4);
      expect(j.currentStop!.seq, 2);
      expect(j.currentStop!.isBusiness, isTrue);
      expect(j.currentStop!.allowsReceipt, isTrue);
      expect(j.currentStop!.recipientName, 'Recipient 2');
      expect(j.stops[2].recipientName, isNull, reason: 'names are hidden until a stop is current/resolved');
      expect(j.stops[2].recipientPhone, isNull);
      expect(j.stops[0].resolved, isTrue);
      expect(j.stops[2].open, isTrue);
      expect(j.stopsSummary.total, 4);
      expect(j.stopsSummary.delivered, 1);
      expect(j.stopsSummary.failed, 1);
      expect(j.stopsSummary.done, 2);
      expect(j.stopsSummary.notDelivered, 1);
      expect(j.handedOverCount, 4);
    });
    test('Stop parsing tolerates missing/odd fields', () {
      final s = Stop({'id': 'x', 'seq': 7});
      expect(s.status, 'loaded');
      expect(s.recipientType, 'consumer');
      expect(s.proofMode, 'code');
      expect(s.allowsReceipt, isFalse);
      expect(s.arrived, isFalse);
      expect(s.canDefer, isFalse);
      expect(s.otpAttemptsLeft, 5);
      expect(s.canResend, isTrue);
      expect(s.waitRemainingSec, isNull);
      expect(s.stopOrder, 7);
      final a = Stop({'id': 'y', 'arrivedAt': '2026-12-01T06:00:00Z', 'waitRemainingSec': 540, 'canDefer': true, 'canResend': false, 'otpAttemptsLeft': 0.0});
      expect(a.arrived, isTrue); expect(a.waitRemainingSec, 540); expect(a.canDefer, isTrue); expect(a.canResend, isFalse); expect(a.otpAttemptsLeft, 0);
    });
    test('failure reasons mirror the server rules (arrival / note requirements)', () {
      final byKey = {for (final r in failReasons) r.key: r};
      expect(byKey.keys, containsAll(['unreachable', 'refused', 'closed', 'no_otp', 'damaged', 'gate_access', 'wrong_address', 'out_of_zone', 'other']));
      for (final k in ['unreachable', 'refused', 'closed', 'no_otp', 'damaged', 'gate_access']) { expect(byKey[k]!.needsArrival, isTrue, reason: k); }
      for (final k in ['wrong_address', 'out_of_zone', 'other']) { expect(byKey[k]!.needsArrival, isFalse, reason: k); }
      expect({for (final r in failReasons) if (r.needsNote) r.key}, {'damaged', 'wrong_address', 'other'});
    });
    test('the old global route optimiser is gone (POST /driver/route/optimize); only the per-offer best-route call remains', () {
      for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
        expect(f.readAsStringSync().contains('/driver/route/optimize'), isFalse, reason: f.path);
      }
      expect(File('lib/features/jobs/route_screen.dart').existsSync(), isFalse);
      expect(File('lib/data/driver_api.dart').readAsStringSync(), contains('/offers/\$offerId/route/optimize'));
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
      for (final r in ['unreachable', 'refused', 'closed', 'no_otp', 'damaged', 'gate_access', 'wrong_address', 'out_of_zone', 'other']) { expect(en.containsKey('stopfail.$r'), isTrue, reason: r); }
      for (final r in ['consumer', 'business']) { expect(en.containsKey('rtype.$r'), isTrue, reason: r); }
      for (final r in ['pending', 'loaded', 'delivered', 'failed', 'returned', 'missing', 'cancelled']) { expect(en.containsKey('shipstatus.$r'), isTrue, reason: r); }
      for (final c in ['OTP_INVALID', 'OTP_LOCKED', 'OTP_REQUIRED', 'STOP_LOCKED', 'STOPS_PENDING', 'WAIT_REQUIRED', 'RETURNS_PENDING', 'MANIFEST_REQUIRED']) { expect(en.containsKey('err.$c'), isTrue, reason: c); }
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

  group('DriverApi — per-parcel request shapes', () {
    late _Adapter ad;
    DriverApi make() {
      ad = _Adapter((o) => _json(200, '{"ok":true}'));
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = ad;
      return DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio));
    }
    test('route approve, arrive, deliver (code + otp), receipt, fail, defer, resend, end route hit the contract paths', () async {
      final api = make();
      await api.routeApprove('o1');
      expect((ad.last!.method, ad.last!.path), ('POST', '/offers/o1/route/approve'));
      await api.arriveStop('o1', 's1', lat: 24.7, lng: 46.6);
      expect(ad.last!.path, '/offers/o1/stops/s1/arrive');
      expect(ad.last!.data, {'lat': 24.7, 'lng': 46.6});
      await api.arriveStop('o1', 's1');
      expect(ad.last!.data, <String, dynamic>{}, reason: 'location is optional — never required');
      await api.deliverStop('o1', 's1', code: 'JR-000042-001', otp: '1234');
      expect(ad.last!.path, '/offers/o1/stops/s1/deliver');
      expect(ad.last!.data, {'code': 'JR-000042-001', 'otp': '1234'});
      await api.deliverStop('o1', 's1', code: '7', proof: 'receipt', receiverName: 'Khalid', lat: 1.0, lng: 2.0);
      expect(ad.last!.data, {'code': '7', 'proof': 'receipt', 'receiverName': 'Khalid', 'lat': 1.0, 'lng': 2.0});
      await api.failStop('o1', 's1', 'damaged', note: 'torn');
      expect(ad.last!.path, '/offers/o1/stops/s1/fail');
      expect(ad.last!.data, {'reason': 'damaged', 'note': 'torn'});
      await api.deferStop('o1', 's1');
      expect(ad.last!.path, '/offers/o1/stops/s1/defer');
      await api.resendCode('o1', 's1');
      expect(ad.last!.path, '/offers/o1/stops/s1/resend-code');
      await api.endRoute('o1', 'car broke down', note: 'flat tyre');
      expect(ad.last!.path, '/offers/o1/end-route');
      expect(ad.last!.data, {'reason': 'car broke down', 'note': 'flat tyre'});
    });
    test('delivered() sends {} for per-parcel jobs and the typed quantity for legacy jobs', () async {
      final api = make();
      await api.delivered('o1');
      expect(ad.last!.data, <String, dynamic>{});
      await api.delivered('o1', 18);
      expect(ad.last!.data, {'units': 18});
    });
    test('whatsapp passes the current stop as shipmentId', () async {
      final api = make();
      await api.whatsapp('o1', 'contact', 'ar', shipmentId: 's9');
      expect(ad.last!.path, '/driver/jobs/o1/whatsapp');
      expect(ad.last!.queryParameters, {'kind': 'contact', 'lang': 'ar', 'shipmentId': 's9'});
      await api.whatsapp('o1', 'contact', 'ar');
      expect(ad.last!.queryParameters.containsKey('shipmentId'), isFalse);
    });
    test('uploadProof posts multipart with a `file` part', () async {
      final api = make();
      final f = File('${Directory.systemTemp.path}/jr_proof_test.jpg')..writeAsBytesSync([1, 2, 3]);
      addTearDown(() { if (f.existsSync()) f.deleteSync(); });
      await api.uploadProof('o1', 's1', f.path, 'receipt.jpg');
      expect(ad.last!.path, '/offers/o1/stops/s1/proof');
      final form = ad.last!.data as FormData;
      expect(form.files.single.key, 'file');
      expect(form.files.single.value.filename, 'receipt.jpg');
    });
    test('server error codes keep their details (attemptsLeft, remainingSec)', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter((o) => _json(422, '{"error":{"code":"OTP_INVALID","message":"bad","details":{"attemptsLeft":3}}}'));
      final api = DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio));
      await expectLater(api.deliverStop('o', 's', code: 'c', otp: '0000'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'OTP_INVALID').having((e) => e.details['attemptsLeft'], 'left', 3)));
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
      await expectLater(c.post('/auth/login', {}), throwsA(isA<ApiException>()));
      expect(n, 1);
    });
    test('network failures become NETWORK, not crashes', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter((_) => throw DioException.connectionError(requestOptions: RequestOptions(), reason: 'offline'));
      final c = ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio, retryDelays: const []);
      await expectLater(c.get('/x'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', true)));
    });
  });
}
