import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/geo.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/route_order.dart';
import 'package:jr_driver/features/jobs/signature_pad.dart';
import 'package:jr_driver/widgets/barcode_scanner.dart';
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
  group('Job — field-ops fields parse (Addendum E) and degrade on old servers', () {
    test('an old server (none of the new fields) keeps the old behaviour', () {
      final j = mkJob();
      expect(j.ops.requireArrivalConfirmation, isTrue);
      expect(j.ops.requireLoadingRecord, isFalse);
      expect(j.ops.requireDeliveryOtp, isTrue);
      expect(j.ops.requireSignature, isFalse);
      expect(j.arrival.geofence, isFalse);
      expect(j.arrival.enforced, isFalse);
      expect(j.loading.mode, 'warehouse', reason: 'no loading object = the warehouse records the loading');
      expect(j.loading.isScan, isFalse);
      expect(j.policy, isNull);
      expect(j.cod, isNull);
      expect(j.showsStopWait, isTrue, reason: 'an old server always had the door timer');
      expect(j.failStrict, isTrue, reason: 'an old server enforced arrival/wait/note rules');
      expect(j.canReorder, isFalse);
      expect(j.inScanLoading, isFalse);
    });

    test('ops / arrival / loading / policy / cod', () {
      final j = mkJob(status: 'attendance_confirmed', extra: {
        'ops': mkOps(arrivalConfirm: false, loadingRecord: true, otp: false, signature: true),
        'arrival': mkArrival(radiusM: 150, lat: 24.7, lng: 46.6),
        'loading': mkLoading(assigned: 30, scanned: 12),
        'policy': mkPolicy(reorder: false, text: true, photo: false, wait: 5, strict: true),
        'cod': mkCod(toCollect: 123000, collected: 40000, parcels: 5),
      });
      expect((j.ops.requireArrivalConfirmation, j.ops.requireLoadingRecord, j.ops.requireDeliveryOtp, j.ops.requireSignature), (false, true, false, true));
      expect((j.arrival.geofence, j.arrival.radiusM, j.arrival.warehouseLat, j.arrival.warehouseLng, j.arrival.enforced), (true, 150, 24.7, 46.6, true));
      expect((j.loading.mode, j.loading.assigned, j.loading.scanned, j.loading.finished), ('driver_scan', 30, 12, false));
      expect(j.policy!.canReorderRoute, isFalse);
      expect((j.policy!.rescheduleEvidenceText, j.policy!.rescheduleEvidencePhoto, j.policy!.stopWaitMin, j.policy!.failStrict), (true, false, 5, true));
      expect(j.showsStopWait, isTrue);
      expect(j.failStrict, isTrue);
      expect((j.cod!.toCollectCents, j.cod!.collectedCents, j.cod!.parcels, j.cod!.any), (123000, 40000, 5, true));
    });

    test('the door timer is gone with stopWaitMin 0, and fail reasons are free unless strict', () {
      final j = mkJob(extra: {'policy': mkPolicy(wait: 0, strict: false)});
      expect(j.showsStopWait, isFalse);
      expect(j.failStrict, isFalse);
    });

    test('the geofence is enforced only when it is on AND the warehouse pin is known', () {
      expect(mkJob(extra: {'arrival': mkArrival(geofence: true, lat: null, lng: null)}).arrival.enforced, isFalse);
      expect(mkJob(extra: {'arrival': mkArrival(geofence: false)}).arrival.enforced, isFalse);
      expect(mkJob(extra: {'arrival': mkArrival()}).arrival.enforced, isTrue);
      expect(mkJob(extra: {'arrival': {'geofence': true, 'warehouse': {'lat': 'x', 'lng': null}}}).arrival.hasWarehouse, isFalse, reason: 'junk coordinates never throw');
    });

    test('scan loading is on while the route is not approved and the driver has not finished; server actions also switch it on', () {
      Job scan({bool approved = false, bool finished = false, List<String> actions = const [], String mode = 'driver_scan'}) => mkManifestJob(actions: actions, extra: {'routeApprovedAt': approved ? '2026-12-01T06:30:00.000Z' : null, 'loading': mkLoading(mode: mode, finished: finished)});
      expect(scan().inScanLoading, isTrue);
      expect(scan(actions: ['scan_loading']).inScanLoading, isTrue);
      expect(scan(finished: true, actions: ['approve_route']).inScanLoading, isFalse);
      expect(scan(finished: true).inScanLoading, isFalse);
      expect(scan(approved: true).inScanLoading, isFalse);
      expect(scan(mode: 'warehouse').inScanLoading, isFalse);
      expect(mkManifestJob(status: 'arrived', extra: {'loading': mkLoading()}).inScanLoading, isFalse);
    });

    test('route: canReorder and manual (provider "manual")', () {
      expect(RoutePlanInfo(mkRoute()).canReorder, isFalse);
      expect(RoutePlanInfo(mkRoute()).manual, isFalse);
      final r = RoutePlanInfo(mkRoute(provider: 'manual', extra: {'canReorder': true}));
      expect(r.canReorder, isTrue);
      expect(r.manual, isTrue, reason: 'provider manual means the driver arranged it, even without the manual flag');
      expect(RoutePlanInfo(mkRoute(extra: {'manual': true})).manual, isTrue);
      expect(mkManifestJob(extra: {'route': mkRoute(extra: {'canReorder': true})}).canReorder, isTrue);
    });
  });

  group('Stop — proof, signature, cash', () {
    test('defaults of an old server: a delivery code is needed, no signature, no cash', () {
      final s = Stop(mkStop(1));
      expect((s.needsOtp, s.needsSignature, s.codCents, s.codCollectedCents, s.hasCod), (true, false, 0, 0, false));
    });
    test('needsOtp follows the explicit flag, else proofMode "scan"', () {
      expect(Stop(mkStop(1, extra: {'needsOtp': false})).needsOtp, isFalse);
      expect(Stop(mkStop(1, extra: {'needsOtp': true, 'proofMode': 'code'})).needsOtp, isTrue);
      expect(Stop(mkStop(1, extra: {'proofMode': 'scan'})).needsOtp, isFalse);
      expect(Stop(mkStop(1, extra: {'proofMode': 'code_or_receipt'})).needsOtp, isTrue);
    });
    test('signature and cash on delivery', () {
      final s = Stop(mkStop(1, extra: {'needsSignature': true, 'codCents': 12050, 'codCollectedCents': 0}));
      expect((s.needsSignature, s.codCents, s.hasCod), (true, 12050, true));
      expect(Stop(mkStop(1, extra: {'codCents': '3000'})).codCents, 3000, reason: 'a number sent as text still parses');
      expect(Stop(mkStop(1, extra: {'codCents': 'x'})).codCents, 0);
    });
    test('scan checklist status and search', () {
      expect(Stop(mkStop(1)).scanned, isTrue, reason: 'loaded = scanned onto the vehicle');
      expect(Stop(mkStop(1, status: 'pending')).scanned, isFalse);
      final s = Stop(mkStop(7, extra: {'externalRef': 'ORD-77', 'address': 'Olaya St 9'}));
      expect(s.matches(''), isTrue);
      expect(s.matches('000042-007'), isTrue);
      expect(s.matches('ord-77'), isTrue);
      expect(s.matches('olaya'), isTrue);
      expect(s.matches('nope'), isFalse);
    });
  });

  group('responses', () {
    test('loading scan / finish results', () {
      final r = LoadingScanResult({'shipment': {'id': 's1', 'code': 'JR-1-001', 'seq': 1}, 'scanned': 12, 'assigned': 30, 'already': true});
      expect((r.shipmentId, r.code, r.seq, r.scanned, r.assigned, r.already), ('s1', 'JR-1-001', 1, 12, 30, true));
      final empty = LoadingScanResult(const {});
      expect((empty.shipmentId, empty.scanned, empty.already), ('', null, false));
      final f = LoadingFinishResult({'loaded': 25, 'released': 5, 'job': mkManifestJob().j});
      expect((f.loaded, f.released, f.job?.offerId), (25, 5, 'o1'));
      expect(LoadingFinishResult(const {}).job, isNull);
    });
  });

  group('DriverApi — new request shapes (Addendum E)', () {
    late _Adapter ad;
    DriverApi make([String body = '{"ok":true}']) {
      ad = _Adapter((o) => _json(200, body));
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = ad;
      return DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio));
    }

    test('checkin carries the GPS fix and returns the offer', () async {
      final api = make('{"status":"attendance_confirmed"}');
      final r = await api.checkIn('o1', lat: 24.7, lng: 46.6);
      expect((ad.last!.method, ad.last!.path), ('POST', '/offers/o1/checkin'));
      expect(ad.last!.data, {'lat': 24.7, 'lng': 46.6});
      expect(r['status'], 'attendance_confirmed');
      await api.checkIn('o1');
      expect(ad.last!.data, <String, dynamic>{});
    });

    test('loading scan / unscan / finish', () async {
      final api = make('{"shipment":{"id":"s1","code":"C","seq":1},"scanned":1,"assigned":3,"already":false}');
      final r = await api.loadingScan('o1', 'JR-1-001');
      expect(ad.last!.path, '/offers/o1/loading/scan');
      expect(ad.last!.data, {'code': 'JR-1-001'});
      expect((r.scanned, r.assigned, r.already), (1, 3, false));
      await api.loadingUnscan('o1', 'JR-1-001');
      expect(ad.last!.path, '/offers/o1/loading/unscan');
      expect(ad.last!.data, {'code': 'JR-1-001'});
      final f = await make('{"loaded":2,"released":1,"job":{"offerId":"o1"}}').loadingFinish('o1');
      expect(ad.last!.path, '/offers/o1/loading/finish');
      expect(ad.last!.data, <String, dynamic>{});
      expect((f.loaded, f.released, f.job?.offerId), (2, 1, 'o1'));
    });

    test('deliver sends the signature media id and the exact cash; fail and defer send the evidence', () async {
      final api = make();
      await api.deliverStop('o1', 's1', code: 'C-1', signatureMediaId: 'm9', cashCollectedCents: 12050);
      expect(ad.last!.data, {'code': 'C-1', 'signatureMediaId': 'm9', 'cashCollectedCents': 12050}, reason: 'no otp key when the warehouse does not use delivery codes');
      await api.failStop('o1', 's1', 'refused', mediaId: 'm2');
      expect(ad.last!.data, {'reason': 'refused', 'mediaId': 'm2'});
      await api.failStop('o1', 's1', 'refused');
      expect(ad.last!.data, {'reason': 'refused'});
      await api.deferStop('o1', 's1', note: 'closed until 6pm', mediaId: 'm3');
      expect(ad.last!.path, '/offers/o1/stops/s1/defer');
      expect(ad.last!.data, {'note': 'closed until 6pm', 'mediaId': 'm3'});
      await api.deferStop('o1', 's1');
      expect(ad.last!.data, <String, dynamic>{});
    });

    test('media upload: multipart with kind + file (path or in-memory bytes)', () async {
      final api = make('{"id":"m1","kind":"signature"}');
      final r = await api.uploadStopMedia('o1', 's1', kind: 'signature', bytes: Uint8List.fromList([137, 80, 78, 71]), filename: 'signature.png');
      expect((ad.last!.method, ad.last!.path), ('POST', '/offers/o1/stops/s1/media'));
      final form = ad.last!.data as FormData;
      expect({for (final f in form.fields) f.key: f.value}, {'kind': 'signature'});
      expect((form.files.single.key, form.files.single.value.filename, form.files.single.value.contentType?.mimeType), ('file', 'signature.png', 'image/png'));
      expect(r['id'], 'm1');
    });

    test('route reorder posts the ordered ids and returns the fresh job', () async {
      final api = make('{"plan":{},"currentId":"s2","job":{"offerId":"o1","route":{"manual":true,"provider":"manual"}}}');
      final r = await api.routeReorder('o1', ['s3', 's2']);
      expect(ad.last!.path, '/offers/o1/route/reorder');
      expect(ad.last!.data, {'order': ['s3', 's2']});
      expect(r.currentId, 's2');
      expect(r.job?.route?.manual, isTrue);
    });

    test('field-ops error details survive', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = _Adapter((o) => _json(422, '{"error":{"code":"TOO_FAR_FROM_WAREHOUSE","message":"far","details":{"distanceM":340,"radiusM":200}}}'));
      final api = DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio));
      await expectLater(api.checkIn('o1', lat: 1, lng: 2), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TOO_FAR_FROM_WAREHOUSE').having((e) => e.details['distanceM'], 'distanceM', 340).having((e) => e.details['radiusM'], 'radiusM', 200)));
    });
  });

  group('geo, scan de-duplication, route order', () {
    test('distanceMeters (haversine) matches known distances', () {
      expect(distanceMeters(24.7, 46.6, 24.7, 46.6), 0);
      expect(distanceMeters(24.7, 46.6, 24.7009, 46.6), closeTo(100, 1), reason: '0.0009° of latitude ≈ 100 m');
      expect(distanceMeters(24.7136, 46.6753, 21.4858, 39.1925), closeTo(846000, 6000), reason: 'Riyadh – Jeddah ≈ 846 km');
    });

    test('ScanDeduper accepts a code once, ignores it for the window, then accepts it again', () {
      final d = ScanDeduper(window: const Duration(seconds: 3));
      final t0 = DateTime(2026, 1, 1, 10);
      expect(d.accept('A', t0), isTrue);
      expect(d.accept('A', t0.add(const Duration(milliseconds: 400))), isFalse);
      expect(d.accept('B', t0.add(const Duration(milliseconds: 400))), isTrue);
      expect(d.accept('A', t0.add(const Duration(seconds: 2))), isFalse);
      expect(d.accept('A', t0.add(const Duration(seconds: 4))), isTrue);
    });

    test('normalizeScan trims label-scanner whitespace and line breaks', () {
      expect(normalizeScan('  JR-000042-001\r\n'), 'JR-000042-001');
      expect(normalizeScan('A\n B'), 'A B');
    });

    test('movableStops excludes resolved stops and the stop the driver has arrived at', () {
      final j = mkManifestJob(stops: [
        mkStop(1, status: 'delivered'),
        mkStop(2, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z'}),
        mkStop(3), mkStop(4), mkStop(5, status: 'failed'),
      ]);
      expect([for (final s in movableStops(j)) s.id], ['s3', 's4']);
      final notArrived = mkManifestJob(stops: [mkStop(1, current: true), mkStop(2), mkStop(3)]);
      expect([for (final s in movableStops(notArrived)) s.id], ['s1', 's2', 's3'], reason: 'the current stop is movable until the driver is at it');
    });

    test('orderWithFirst moves one stop to the front and keeps the rest in order', () {
      final stops = [for (var n = 1; n <= 4; n++) Stop(mkStop(n))];
      expect(orderWithFirst(stops, 's3'), ['s3', 's1', 's2', 's4']);
      expect(orderWithFirst(stops, 's1'), ['s1', 's2', 's3', 's4']);
      expect(orderWithFirst(stops, 'zzz'), isNull);
    });

    test('canMakeNext needs the platform switch, an open stop that is not already next', () {
      final stops = [mkStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z'}), mkStop(2), mkStop(3)];
      final on = mkManifestJob(stops: stops, extra: {'route': mkRoute(extra: {'canReorder': true})});
      expect(canMakeNext(on, on.stops[2]), isTrue);
      expect(canMakeNext(on, on.stops[1]), isFalse, reason: 's2 is already the next movable stop (s1 is pinned)');
      expect(canMakeNext(on, on.stops[0]), isFalse, reason: 'the stop being served cannot be moved');
      final off = mkManifestJob(stops: stops, extra: {'route': mkRoute()});
      expect(canMakeNext(off, off.stops[2]), isFalse);
    });

    test('moveItem follows ReorderableListView semantics (index counted before removal)', () {
      expect(moveItem(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'a', 'd']);
      expect(moveItem(['a', 'b', 'c', 'd'], 0, 4), ['b', 'c', 'd', 'a']);
      expect(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
      expect(moveItem(['a', 'b'], 5, 0), ['a', 'b'], reason: 'out of range does nothing');
    });
  });

  group('signature controller', () {
    test('a tap is not a signature; a real line is; undo and clear', () {
      final c = SignatureController();
      expect(c.hasSignature, isFalse);
      c.start(const Offset(10, 10)); c.end();
      expect(c.hasSignature, isFalse, reason: 'one dot is an accidental tap');
      c.start(const Offset(10, 10)); c.add(const Offset(60, 40)); c.add(const Offset(120, 20)); c.end();
      expect(c.hasSignature, isTrue);
      expect(c.strokes.length, 2);
      c.undo();
      expect(c.strokes.length, 1);
      expect(c.hasSignature, isFalse);
      c.start(const Offset(0, 0)); c.add(const Offset(80, 0)); c.end();
      c.clear();
      expect(c.strokes, isEmpty);
    });

    testWidgets('exports a PNG picture (white paper, dark ink) and nothing when empty', (t) async {
      final c = SignatureController()..setSize(const Size(300, 190));
      expect(await t.runAsync(() => c.toPng()), isNull);
      c.start(const Offset(20, 100)); c.add(const Offset(120, 40)); c.add(const Offset(220, 120)); c.end();
      final png = await t.runAsync(() => c.toPng(width: 300));
      expect(png, isNotNull);
      expect(png!.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10], reason: 'PNG signature');
      expect(png.length, greaterThan(100));
    });
  });
}
