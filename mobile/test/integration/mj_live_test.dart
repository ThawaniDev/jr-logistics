@Tags(['live'])
library;

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/features/jobs/job_stats.dart';
import 'package:jr_driver/features/jobs/shipment_logic.dart';
import 'package:jr_driver/features/jobs/shipments_view.dart';
import 'live_login.dart';

/// Platform update J (MJ) against a real server: routing OFF — the shipment list contract (name / phone / payment mode / date / pieces for every open
/// shipment), working the shipments in ANY order (no STOP_LOCKED, no approval step), WhatsApp for a non-first shipment, the stats of every order card,
/// and the office driver's wallet. Skipped unless JR_API is set; also skipped when the server runs with routing ON.
final base = Platform.environment['JR_API'];

Matcher apiError(String code) => throwsA(isA<ApiException>().having((e) => e.code, 'code', code));

void main() {
  final skip = base == null ? 'set JR_API (e.g. http://localhost:3000) to run live tests' : null;

  test('routing OFF: work the shipments in any order; the list carries everything the run sheet shows', skip: skip, () async {
    final biz = await signedInClient(base!, '0500000001');
    final drvClient = await signedInClient(base!, '0500000011');
    final drv = DriverApi(drvClient);
    final policy = ((await drv.catalog())['policy'] as Map?) ?? const {};
    if (policy['routingEnabled'] != false) { markTestSkipped('the server runs with routing ON'); return; }

    final stamp = DateTime.now().microsecondsSinceEpoch;
    final r = await biz.post('/requests', {
      'service': 'delivery_driver', 'shipmentsPerDriver': 30, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'pickupAddress': 'Olaya St',
      'startsAt': DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String(), 'durationDays': 1, 'publish': true, 'termsAccepted': true,
      'shipments': [
        for (var n = 1; n <= 6; n++) {
          'recipientType': 'consumer', 'recipientName': 'Recipient $n', 'recipientPhone': '05550000${n.toString().padLeft(2, '0')}', 'address': 'Street $n, Riyadh', 'city': 'riyadh',
          'contents': 'Parcel $n', 'externalRef': 'MJ-$stamp-$n', if (n == 2 || n == 5) 'codCents': 10000 * n,
        },
      ],
    });
    final requestId = r['id'] as String;
    await drv.setAvailability(true);
    final offer = (await drv.offers()).firstWhere((j) => j.requestId == requestId);
    expect(offer.routingEnabled, isFalse);
    expect(offer.b2bShipmentsEnabled, isFalse);

    // J5: the stat numbers of an offer come from the server (estimated) and the card applies
    expect(JobStats.applies(offer), isTrue);
    expect(JobStats.of(offer).total, 6);
    expect(JobStats.of(offer).delivered, 0);

    await drv.accept(offer.offerId);
    final at = (await drv.job(offer.offerId)).arrival; // check in at the warehouse pin: the geofence is on
    await drv.checkIn(offer.offerId, lat: at.warehouseLat ?? 24.7136, lng: at.warehouseLng ?? 46.6753);
    if ((await drv.job(offer.offerId)).status == 'arrived') { await biz.post('/offers/${offer.offerId}/attendance', {'present': true}); } // the warehouse may confirm arrivals by itself
    await biz.post('/offers/${offer.offerId}/loading', {'all': true});
    var j = await drv.job(offer.offerId);
    expect(j.actions, contains('ack_loading'));
    await drv.ackLoading(offer.offerId, true);

    j = await drv.job(offer.offerId);
    expect(j.actions, isNot(contains('approve_route')), reason: 'no route approval with routing off');
    expect(j.actions, contains('work_stops'));
    expect(j.route, isNull, reason: 'no route is planned with routing off');
    expect(j.routingEnabled, isFalse);
    expect(j.canReorder, isFalse);
    await expectLater(drv.optimizeRoute(offer.offerId), apiError('ROUTING_DISABLED'));
    expect(ShipmentsView.applies(j), isTrue, reason: 'the run sheet is the job page now');

    // every open shipment has name and phone, payment mode, date, pieces
    expect(j.stops, hasLength(6));
    for (final s in j.stops) {
      expect(s.recipientName, isNotNull, reason: 'name of ${s.code}');
      expect(s.recipientPhone, isNotNull, reason: 'phone of ${s.code}');
      expect(s.createdAt, isNotNull);
      expect(s.pieces, 1);
      expect(s.paymentMode, s.codCents > 0 ? 'cod' : 'prepaid');
      expect(shipStatusOf(s), ShipStatus.outForDelivery);
      expect(shipActionsFor(j, s).arrive, isTrue, reason: 'every shipment accepts actions, not only the first');
    }
    expect(j.stops.where((s) => s.paymentMode == 'cod').length, 2);
    final counts = ShipCounts.of(j.stops);
    expect([counts.total, counts.toDeliver, counts.delivered, counts.notDelivered], [6, 6, 0, 0]);
    expect(filterShipments(j.stops, ShipFilter.all, 'Recipient 4').single.seq, 4);
    expect(filterShipments(j.stops, ShipFilter.all, '0555000003').single.seq, 3, reason: 'search by phone digits');

    // WhatsApp for a shipment that is not the first
    final last = j.stops.last;
    final wa = await drv.whatsapp(offer.offerId, 'contact', 'ar', shipmentId: last.id);
    expect(wa['url'], startsWith('https://wa.me/'));

    // work out of order: the LAST shipment first (arrive, wrong code is refused, fail it), then deliver another one
    await drv.arriveStop(offer.offerId, last.id, lat: 24.7136, lng: 46.6753);
    await drv.failStop(offer.offerId, last.id, 'refused');
    final second = j.stops[1];
    await drv.arriveStop(offer.offerId, second.id, lat: 24.7136, lng: 46.6753);
    final codes = await _demoCodes(biz, requestId);
    await drv.deliverStop(offer.offerId, second.id, code: second.code, otp: codes[second.id], cashCollectedCents: second.codCents > 0 ? second.codCents : null);
    j = await drv.job(offer.offerId);
    final c2 = ShipCounts.of(j.stops);
    expect([c2.total, c2.toDeliver, c2.delivered, c2.notDelivered], [6, 4, 1, 1]);
    expect(shipStatusOf(j.stops.last), ShipStatus.failed);
    expect(shipStatusOf(j.stops[1]), ShipStatus.delivered);
    expect(JobStats.of(j).delivered, 1);
    expect(JobStats.of(j).notDelivered, 1);
    expect(nextShipment(j.stops)!.seq, 1);

    // finish the rest in reverse order, then the route
    for (final s in j.stops.where((s) => s.status == 'loaded').toList().reversed) {
      await drv.arriveStop(offer.offerId, s.id, lat: 24.7136, lng: 46.6753);
      await drv.deliverStop(offer.offerId, s.id, code: s.code, otp: codes[s.id], cashCollectedCents: s.codCents > 0 ? s.codCents : null);
    }
    j = await drv.job(offer.offerId);
    expect(j.actions, ['report_delivered']);
    expect(ShipCounts.of(j.stops).toDeliver, 0);
    await drv.delivered(offer.offerId);
    j = await drv.job(offer.offerId);
    expect(j.status, 'completed');
    final done = JobStats.of(j);
    expect([done.total, done.delivered, done.notDelivered], [6, 5, 1]);
    expect(done.isFinal, isTrue);
    expect(done.hasCod, isTrue);
    expect(done.cod!.collectedCents, greaterThan(0));
    await biz.post('/offers/${offer.offerId}/returns', {'all': true});
  });

  test('an office driver: the overview and the wallet say so, the cash stays', skip: skip, () async {
    final client = await signedInClient(base!, '0500000015'); // demo.driver5 belongs to an office on the dev seed; skipped when not
    final drv = DriverApi(client);
    final ov = await drv.overview();
    if (!ov.walletManagedByOffice) { markTestSkipped('this server has no office driver on that demo account'); return; }
    expect(ov.j['wallet'], isNull);
    expect(ov.officeName, isNotNull);
    final w = await drv.wallet();
    expect(w['managedByOffice'], isTrue);
    expect(w['availableCents'], isNull);
    expect(w['entries'], isEmpty);
    expect(ov.j['cash'], isNotNull, reason: 'cash is unchanged for an office driver');
    for (final job in await drv.jobs(active: false)) {
      if (job.earningHidden) { expect(job.expectedEarningCents, isNull); }
    }
  });
}

Future<Map<String, String>> _demoCodes(ApiClient biz, String requestId) async {
  final r = await biz.get('/requests/$requestId/shipments', query: {'pageSize': '200'});
  return {for (final i in (r['items'] as List).cast<Map>()) if (i['demoOtp'] != null) '${i['id']}': '${i['demoOtp']}'};
}
