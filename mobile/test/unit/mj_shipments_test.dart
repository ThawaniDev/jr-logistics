import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_stats.dart';
import 'package:jr_driver/features/jobs/shipment_logic.dart';
import '../helpers.dart';

// Platform update J, worker MJ — pure logic: status mapping, filters, counters, search, payment mode, which stops accept actions, the numbers on every order card.

Stop stop(int n, {String status = 'loaded', Json? extra, bool current = false}) => Stop(mkStop(n, status: status, current: current, extra: extra));
Job offJob({List<Json>? stops, List<String>? actions, Json? extra}) => mkManifestJob(actions: actions ?? ['work_stops', 'end_route'], stops: stops, extra: {'policy': {...mkPolicy(), 'routingEnabled': false}, ...?extra});

void main() {
  group('status mapping', () {
    test('every server status has a card status', () {
      expect(shipStatusOf(stop(1)), ShipStatus.outForDelivery);
      expect(shipStatusOf(stop(1, status: 'delivered')), ShipStatus.delivered);
      expect(shipStatusOf(stop(1, status: 'failed')), ShipStatus.failed);
      expect(shipStatusOf(stop(1, status: 'returned')), ShipStatus.returned);
      expect(shipStatusOf(stop(1, status: 'missing')), ShipStatus.missing);
      expect(shipStatusOf(stop(1, status: 'pending')), ShipStatus.pending);
      expect(shipStatusOf(stop(1, status: 'cancelled')), ShipStatus.cancelled);
    });
    test('a postponed stop is "postponed" until the driver arrives there again', () {
      expect(shipStatusOf(stop(1, extra: {'deferCount': 1})), ShipStatus.postponed);
      expect(shipStatusOf(stop(1, extra: {'deferCount': 1, 'arrivedAt': '2026-12-01T07:00:00.000Z'})), ShipStatus.outForDelivery);
    });
    test('an unknown status degrades to out for delivery instead of throwing', () {
      expect(shipStatusOf(Stop({'id': 'x', 'status': 'weird'})), ShipStatus.outForDelivery);
      expect(shipStatusOf(Stop({'id': 'x'})), ShipStatus.outForDelivery);
    });
  });

  group('payment mode, pieces, date', () {
    test('the server value wins; without it cash due means COD, otherwise prepaid', () {
      expect(stop(1, extra: {'paymentMode': 'cod', 'codCents': 0}).paymentMode, 'cod');
      expect(stop(1, extra: {'paymentMode': 'prepaid', 'codCents': 500}).paymentMode, 'prepaid');
      expect(stop(1, extra: {'codCents': 500}).paymentMode, 'cod');
      expect(stop(1).paymentMode, 'prepaid');
      expect(stop(1, extra: {'paymentMode': 'weird'}).paymentMode, 'prepaid');
    });
    test('pieces default to 1 and never below it', () {
      expect(stop(1).pieces, 1);
      expect(stop(1, extra: {'pieces': 3}).pieces, 3);
      expect(stop(1, extra: {'pieces': 0}).pieces, 1);
      expect(stop(1, extra: {'pieces': null}).pieces, 1);
    });
    test('shipDate keeps the date and drops the time; empty when unknown', () {
      expect(shipDate('2026-11-20T10:30:00.000Z', 'en'), '20 Nov 2026');
      expect(shipDate('2026-11-20T10:30:00.000Z', 'ar'), '20 نوفمبر 2026');
      expect(shipDate(null, 'en'), '');
      expect(shipDate('nonsense', 'en'), '');
    });
  });

  group('filters and counters', () {
    final stops = [
      stop(1, current: true), stop(2), stop(3, status: 'delivered'), stop(4, status: 'delivered'), stop(5, status: 'failed'),
      stop(6, status: 'returned'), stop(7, status: 'missing'), stop(8, status: 'pending'), stop(9, status: 'cancelled'),
    ];
    test('counts per chip', () {
      final c = ShipCounts.of(stops);
      expect([c.total, c.toDeliver, c.delivered, c.notDelivered, c.done], [9, 2, 2, 3, 5]);
      expect([for (final f in ShipFilter.values) c.of(f)], [9, 2, 2, 3]);
    });
    test('each chip shows exactly its stops, in the server order', () {
      List<int> ids(ShipFilter f) => [for (final s in filterShipments(stops, f, '')) s.seq];
      expect(ids(ShipFilter.all), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(ids(ShipFilter.toDeliver), [1, 2]);
      expect(ids(ShipFilter.delivered), [3, 4]);
      expect(ids(ShipFilter.notDelivered), [5, 6, 7]);
    });
    test('chip keys are stable (widget keys)', () {
      expect([for (final f in ShipFilter.values) f.key], ['all', 'to_deliver', 'delivered', 'not_delivered']);
    });
    test('an empty list gives zero everywhere', () {
      final c = ShipCounts.of(const []);
      expect([c.total, c.toDeliver, c.delivered, c.notDelivered], [0, 0, 0, 0]);
    });
  });

  group('search', () {
    final s = Stop(mkStop(7, current: true, extra: {
      'recipientName': 'Mona Al-Harbi', 'recipientPhone': '+966 55 512 3456', 'address': 'Olaya St 120, Al Malaz', 'city': 'riyadh', 'contents': 'Blue jacket', 'orderRef': 'ORD-9981', 'manifestNumber': 'MF-55',
    }));
    test('code, order reference, manifest number, name, address, city, contents', () {
      for (final q in ['JR-000042-007', 'jr-000042-007', 'ORD-9981', 'mf-55', 'mona', 'HARBI', 'olaya', 'malaz', 'riyadh', 'jacket']) {
        expect(shipmentMatches(s, q), isTrue, reason: q);
      }
    });
    test('phone, in any formatting and with Arabic digits', () {
      for (final q in ['555123456', '0555123456', '055 512 3456', '00966555123456', '55 512', '+966555123456', '512-3456', '٥٥٥١٢٣', '966 55']) {
        expect(shipmentMatches(s, q), isTrue, reason: q);
      }
    });
    test('no match, blank query, and letters never match digits', () {
      expect(shipmentMatches(s, 'zzz'), isFalse);
      expect(shipmentMatches(s, '999'), isFalse);
      expect(shipmentMatches(s, '05559999999'), isFalse);
      expect(shipmentMatches(s, '   '), isTrue);
      expect(shipmentMatches(s, ''), isTrue);
      expect(shipmentMatches(Stop(mkStop(1)), '5551'), isFalse); // no phone on this stop
    });
    test('combined with a chip', () {
      final list = [s, stop(8, status: 'delivered', extra: {'recipientName': 'Mona Ali'})];
      expect([for (final x in filterShipments(list, ShipFilter.delivered, 'mona')) x.seq], [8]);
      expect([for (final x in filterShipments(list, ShipFilter.all, 'mona')) x.seq], [7, 8]);
    });
  });

  group('which stops accept actions', () {
    final stops = [stop(1, current: true), stop(2), stop(3, status: 'delivered'), stop(4, status: 'pending')];
    test('routing OFF: every shipment on the vehicle, in any order', () {
      final job = offJob(stops: [for (final s in stops) s.j]);
      expect([for (final s in job.stops) acceptsActions(job, s)], [true, true, false, false]);
    });
    test('routing ON (or older server): only the server\'s current stop', () {
      final on = mkManifestJob(stops: [for (final s in stops) s.j]);
      expect(on.routingEnabled, isTrue);
      expect([for (final s in on.stops) acceptsActions(on, s)], [true, false, false, false]);
    });
    test('no work_stops action from the server: nothing is open', () {
      final job = offJob(actions: ['report_delivered'], stops: [for (final s in stops) s.j]);
      expect(job.stops.any((s) => acceptsActions(job, s)), isFalse);
    });
    test('the action set: arrive first, then deliver; call needs a phone; routing ON locks the others', () {
      final job = offJob(stops: [mkStop(1, current: true, extra: {'recipientPhone': '+966555000001', 'canDefer': true}), mkStop(2, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z', 'recipientPhone': ''})]);
      final a = shipActionsFor(job, job.stops[0]);
      expect([a.arrive, a.deliver, a.cantDeliver, a.postpone, a.call, a.whatsapp, a.locked], [true, false, true, true, true, true, false]);
      final b = shipActionsFor(job, job.stops[1]);
      expect([b.arrive, b.deliver, b.postpone, b.call, b.whatsapp], [false, true, false, false, true]);
      final on = mkManifestJob(stops: [mkStop(1, current: true), mkStop(2, extra: {'recipientPhone': '+966555000002'})]);
      final locked = shipActionsFor(on, on.stops[1]);
      expect([locked.locked, locked.arrive, locked.call, locked.whatsapp], [true, false, false, false]);
    });
    test('next shipment: the first one on the vehicle in manifest order (the server\'s current stop with routing on)', () {
      expect(nextShipment([stop(1, status: 'delivered'), stop(2), stop(3)])!.seq, 2);
      expect(nextShipment([stop(1), stop(2, current: true)])!.seq, 2);
      expect(nextShipment([stop(1, status: 'delivered')]), isNull);
    });
  });

  group('tolerant models', () {
    test('an older server (no policy, no new fields): routing and B2B are on', () {
      final j = mkJob();
      expect(j.policy, isNull);
      expect([j.routingEnabled, j.b2bShipmentsEnabled], [true, true]);
      expect(Job({'policy': {}}).routingEnabled, isTrue);
    });
    test('policy flags', () {
      final j = Job({'policy': {'routingEnabled': false, 'b2bShipmentsEnabled': false}});
      expect([j.routingEnabled, j.b2bShipmentsEnabled], [false, false]);
    });
    test('the office driver\'s overview', () {
      final o = Overview({'wallet': null, 'walletManagedByOffice': true, 'officeLinked': true, 'office': {'name': 'Al Noor Couriers'}});
      expect([o.walletManagedByOffice, o.availableCents, o.pendingCents, o.officeName], [true, 0, 0, 'Al Noor Couriers']);
      expect(Overview({'officeName': 'X'}).officeName, 'X');
      expect(Overview({}).walletManagedByOffice, isFalse);
      expect(Overview({}).officeName, isNull);
    });
    test('cash block: handed-over is optional', () {
      expect(JobCod({'toCollectCents': 5}).handedOverCents, isNull);
      expect(JobCod({'handedOverCents': 700}).handedOverCents, 700);
    });
  });

  group('the numbers on an order card (J5), every state', () {
    Job manifest(String status, {Json? summary, Json? extra, int expected = 6}) => mkManifestJob(status: status, stops: [], summary: summary ?? {'total': 0, 'pending': 0, 'loaded': 0, 'delivered': 0, 'failed': 0, 'returned': 0, 'missing': 0}, extra: {'expectedUnits': expected, 'stops': null, 'loadedUnits': null, ...?extra});
    List<int> n(JobStats s) => [s.total, s.toDeliver, s.delivered, s.notDelivered];

    test('offered / accepted / loading: the expected parcels, nothing delivered', () {
      for (final st in ['offered', 'accepted', 'arrived']) {
        final s = JobStats.of(manifest(st));
        expect(n(s), [6, 6, 0, 0], reason: st);
        expect(s.fromOffer, isTrue);
        expect(JobStats.applies(manifest(st)), isTrue);
      }
    });
    test('parcels not handed over yet (all pending): still the plan', () {
      final s = JobStats.of(manifest('attendance_confirmed', summary: {'total': 5, 'pending': 5, 'loaded': 0, 'delivered': 0, 'failed': 0, 'returned': 0, 'missing': 0}));
      expect(n(s), [5, 5, 0, 0]);
    });
    test('under way: from the stops summary (failed + returned + missing = not delivered)', () {
      final s = JobStats.of(manifest('attendance_confirmed', summary: {'total': 10, 'pending': 0, 'loaded': 4, 'delivered': 3, 'failed': 1, 'returned': 1, 'missing': 1}));
      expect(n(s), [10, 4, 3, 3]);
      expect(s.isFinal, isFalse);
    });
    test('completed: the final result', () {
      final s = JobStats.of(manifest('completed', summary: {'total': 10, 'pending': 0, 'loaded': 0, 'delivered': 8, 'failed': 1, 'returned': 1, 'missing': 0}));
      expect(n(s), [10, 0, 8, 2]);
      expect([s.isFinal, s.failed, s.returned], [true, 1, 1]);
    });
    test('a count-based delivery job: from loaded / delivered / final units', () {
      expect(n(JobStats.of(mkJob(status: 'accepted'))), [20, 20, 0, 0]);
      expect(n(JobStats.of(mkJob(status: 'attendance_confirmed', extra: {'loadedUnits': 18}))), [18, 18, 0, 0]);
      expect(n(JobStats.of(mkJob(status: 'completed', actions: [], extra: {'loadedUnits': 18, 'finalUnits': 15}))), [18, 0, 15, 3]);
      expect(n(JobStats.of(mkJob(status: 'delivered_reported', actions: [], extra: {'loadedUnits': 18, 'deliveredUnits': 17}))), [18, 0, 17, 1]);
    });
    test('cash: shown only when the job has COD', () {
      expect(JobStats.of(manifest('accepted')).hasCod, isFalse);
      expect(JobStats.of(manifest('accepted', extra: {'cod': mkCod(toCollect: 1000, collected: 0, parcels: 2)})).hasCod, isTrue);
      expect(JobStats.of(manifest('accepted', extra: {'cod': mkCod()})).hasCod, isFalse);
    });
    test('the server\'s own stats win when it sends them (estimated for an offer, cash with handed over / outstanding)', () {
      final offer = JobStats.of(manifest('offered', extra: {'stats': {'total': 6, 'toDeliver': 6, 'delivered': 0, 'notDelivered': 0, 'failed': 0, 'returned': 0, 'estimated': true, 'cod': null}}));
      expect(n(offer), [6, 6, 0, 0]);
      expect([offer.fromOffer, offer.hasCod], [true, false]);
      final done = JobStats.of(manifest('completed', extra: {'stats': {'total': 10, 'toDeliver': 0, 'delivered': 8, 'notDelivered': 2, 'failed': 1, 'returned': 1, 'estimated': false, 'cod': {'parcels': 4, 'toCollectCents': 0, 'collectedCents': 90000, 'handedOverCents': 70000, 'outstandingCents': 20000}}}));
      expect(n(done), [10, 0, 8, 2]);
      expect([done.isFinal, done.fromOffer, done.cod!.collectedCents, done.cod!.handedOverCents], [true, false, 90000, 70000]);
    });
    test('stats: null from the server = no parcels on this job (no cards); an older server without the key is derived as before', () {
      expect(JobStats.applies(manifest('accepted', extra: {'stats': null})), isFalse);
      expect(JobStats.applies(mkJob(status: 'accepted', extra: {'stats': null})), isFalse);
      expect(JobStats.applies(manifest('accepted')), isTrue);
      expect(n(JobStats.of(manifest('accepted', extra: {'stats': {'total': 'x'}}))), [6, 6, 0, 0], reason: 'a malformed block falls back to the offer');
    });
    test('who gets stat cards: delivery jobs; vehicle-days and withdrawn / declined jobs without handled parcels do not', () {
      expect(JobStats.applies(mkJob(service: 'car_with_driver', status: 'accepted')), isFalse);
      for (final st in ['cancelled', 'rejected', 'expired', 'no_show']) { expect(JobStats.applies(manifest(st)), isFalse, reason: st); }
      expect(JobStats.applies(manifest('cancelled', summary: {'total': 4, 'pending': 0, 'loaded': 1, 'delivered': 2, 'failed': 1, 'returned': 0, 'missing': 0})), isTrue);
      expect(JobStats.applies(manifest('completed')), isTrue);
      expect(JobStats.applies(manifest('delivered_reported')), isTrue);
    });
  });
}
