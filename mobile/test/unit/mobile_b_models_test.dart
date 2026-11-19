import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/models_extra.dart';
import '../helpers_extra.dart';

void main() {
  group('decodePolyline (Google encoded polyline, precision 5)', () {
    test('the reference example from Google\'s documentation', () {
      final pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
      expect(pts.length, 3);
      expect(pts[0].lat, closeTo(38.5, 1e-9)); expect(pts[0].lng, closeTo(-120.2, 1e-9));
      expect(pts[1].lat, closeTo(40.7, 1e-9)); expect(pts[1].lng, closeTo(-120.95, 1e-9));
      expect(pts[2].lat, closeTo(43.252, 1e-9)); expect(pts[2].lng, closeTo(-126.453, 1e-9));
    });

    test('round-trips encode → decode, including negative deltas and a long route around Riyadh', () {
      final src = [for (var i = 0; i < 50; i++) (lat: 24.7136 + i * 0.0031 - (i.isEven ? 0.002 : 0), lng: 46.6753 - i * 0.0027 + (i % 3) * 0.0011)];
      final back = decodePolyline(encodePolyline(src));
      expect(back.length, src.length);
      for (var i = 0; i < src.length; i++) { expect(back[i].lat, closeTo(src[i].lat, 1e-5)); expect(back[i].lng, closeTo(src[i].lng, 1e-5)); }
    });

    test('precision 6 (polyline6) decodes with the right scale', () {
      final enc = encodePolyline([(lat: 24.713612, lng: 46.675301), (lat: 24.714001, lng: 46.676002)], precision: 6);
      final pts = decodePolyline(enc, precision: 6);
      expect(pts[0].lat, closeTo(24.713612, 1e-9)); expect(pts[1].lng, closeTo(46.676002, 1e-9));
    });

    test('null, empty, garbage and truncated input give an EMPTY list (never a half-drawn road)', () {
      expect(decodePolyline(null), isEmpty);
      expect(decodePolyline(''), isEmpty);
      expect(decodePolyline('not a polyline!'), isEmpty, reason: 'space and ! are outside the alphabet');
      final good = encodePolyline([(lat: 24.7, lng: 46.6), (lat: 24.8, lng: 46.7)]);
      expect(decodePolyline(good.substring(0, good.length - 2)), isEmpty, reason: 'cut off in the middle of a value');
      expect(decodePolyline(good.substring(0, 5)), isEmpty, reason: 'latitude without its longitude');
    });

    test('a point outside the world is rejected', () {
      expect(decodePolyline(encodePolyline([(lat: 91.0, lng: 10.0)])), isEmpty);
      expect(decodePolyline(encodePolyline([(lat: 10.0, lng: 181.0)])), isEmpty);
    });
  });

  group('RouteGeometry (GET /driver/jobs/:id/route-geometry)', () {
    final enc = encodePolyline([(lat: 24.71, lng: 46.61), (lat: 24.715, lng: 46.615), (lat: 24.72, lng: 46.62)]);
    final json = {
      'origin': {'lat': 24.70, 'lng': 46.60}, 'provider': 'google_routes',
      'legs': [
        {'stopId': 's2', 'order': 2, 'from': {'lat': 24.71, 'lng': 46.61}, 'to': {'lat': 24.72, 'lng': 46.62}, 'polyline': null, 'distanceM': 1800, 'durationS': 300},
        {'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}, 'polyline': enc, 'distanceM': 4200, 'durationS': 720},
        {'stopId': 's3', 'order': 3, 'from': null, 'to': null, 'polyline': null, 'distanceM': null, 'durationS': null},
      ],
    };
    final g = RouteGeometry.fromJson(json);

    test('legs are sorted by order; origin and provider are read', () {
      expect(g.legs.map((l) => l.stopId), ['s1', 's2', 's3']);
      expect(g.origin!.lat, 24.70);
      expect(g.provider, 'google_routes');
      expect(g.legFor('s2')!.distanceM, 1800);
      expect(g.legFor('nope'), isNull);
    });

    test('a leg with a polyline draws the road; one without is a straight estimate from → to; one with nothing draws nothing', () {
      final road = g.legFor('s1')!;
      expect(road.hasRoad, isTrue); expect(road.isEstimate, isFalse);
      expect(road.linePoints.length, 3);
      final est = g.legFor('s2')!;
      expect(est.isEstimate, isTrue);
      expect(est.linePoints.map((p) => p.lat), [24.71, 24.72], reason: 'straight line from → to');
      final none = g.legFor('s3')!;
      expect(none.linePoints, isEmpty);
      expect(g.hasLines, isTrue);
      expect(g.allEstimates, isFalse);
    });

    test('a corrupt polyline falls back to the straight line instead of failing', () {
      final l = RouteLeg.fromJson({'stopId': 's9', 'order': 1, 'from': {'lat': 24.7, 'lng': 46.6}, 'to': {'lat': 24.8, 'lng': 46.7}, 'polyline': '!!!'});
      expect(l.hasRoad, isFalse);
      expect(l.linePoints.length, 2);
    });

    test('missing / odd fields never throw', () {
      final x = RouteGeometry.fromJson({'origin': 'x', 'legs': 'nope'});
      expect(x.origin, isNull); expect(x.legs, isEmpty); expect(x.hasLines, isFalse);
      final y = RouteGeometry.fromJson({'legs': [1, null, {'stopId': 5, 'order': '2', 'from': {'lat': 'x', 'lng': 1}}]});
      expect(y.legs.length, 1); expect(y.legs.first.stopId, '5'); expect(y.legs.first.from, isNull);
    });
  });

  group('cash (GET /driver/cash)', () {
    test('parses the three totals, the per-order list and the recent hand-overs', () {
      final c = CashSummary({
        'collectedCents': 300000, 'receivedCents': 100000, 'outstandingCents': 200000,
        'orders': [{'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'businessName': 'Nakheel', 'parcels': 3, 'collectedCents': 300000, 'receivedCents': 100000, 'outstandingCents': 200000, 'lastCollectedAt': '2026-12-01T06:00:00Z'}],
        'recent': [{'id': 'h1', 'ref': 'JR-000042', 'amountCents': 100000, 'receivedByName': 'Sara', 'receivedByRole': 'business', 'note': 'part', 'createdAt': '2026-12-02T06:00:00Z'}],
      });
      expect(c.outstandingCents, 200000);
      expect(c.orders.single.businessName, 'Nakheel');
      expect(c.orders.single.parcels, 3);
      expect(c.recent.single.receivedByRole, 'business');
      expect(c.isEmpty, isFalse);
    });

    test('an empty / odd answer is an empty summary, not a crash', () {
      expect(CashSummary({}).isEmpty, isTrue);
      expect(CashSummary({'orders': 'x', 'recent': [1, null]}).orders, isEmpty);
    });

    test('the home card block: shown when there is cash or history, absent for older servers', () {
      expect(CashBrief.fromOverview({'cash': {'outstandingCents': 5000, 'orders': 1}})!.show, isTrue);
      expect(CashBrief.fromOverview({'cash': {'outstandingCents': 0, 'orders': 2}})!.show, isTrue, reason: 'history to look at');
      expect(CashBrief.fromOverview({'cash': {'outstandingCents': 0, 'orders': 0}})!.show, isFalse);
      expect(CashBrief.fromOverview({}), isNull);
    });
  });

  group('offers while busy (E11)', () {
    test('hidden + activeJob', () {
      final i = OffersInfo.fromJson({'items': [], 'hidden': true, 'activeJob': {'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'accepted'}});
      expect(i.hidden, isTrue);
      expect(i.activeJob!.offerId, 'o9'); expect(i.activeJob!.ref, 'JR-000009');
    });
    test('older servers (a bare list wrapper), null activeJob and junk', () {
      expect(OffersInfo.fromJson({'items': [{'offerId': 'o1'}]}).hidden, isFalse);
      expect(OffersInfo.fromJson({'items': [], 'hidden': false, 'activeJob': null}).activeJob, isNull);
      expect(ActiveJobRef.fromJson({'offerId': ''}), isNull);
      expect(ActiveJobRef.fromJson('x'), isNull);
    });
  });

  group('notifications', () {
    test('vars: scalars become text, objects are dropped, amount is derived from amountCents, cities are localized by the caller', () {
      final n = AppNotification(mkNotification('n1', 'cod_received', data: {'ref': 'JR-000042', 'amountCents': 123450, 'nested': {'a': 1}}));
      final v = n.vars();
      expect(v['ref'], 'JR-000042'); expect(v['amount'], '1234.50'); expect(v['nested'], '');
      final o = AppNotification(mkNotification('n2', 'offer_new', data: {'ref': 'JR-1', 'parcels': 12, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah', 'earningCents': null}));
      final ov = o.vars(city: (k) => k.toUpperCase());
      expect(ov['parcels'], '12'); expect(ov['pickupCity'], 'RIYADH'); expect(ov['deliveryCity'], 'JEDDAH');
    });

    test('an explicit amount from the server is not overwritten', () {
      expect(AppNotification(mkNotification('n', 'cod_received', data: {'amount': '5', 'amountCents': 100})).vars()['amount'], '5');
    });

    test('unread / readAt / created', () {
      expect(AppNotification(mkNotification('n', 'offer_new')).unread, isTrue);
      expect(AppNotification(mkNotification('n', 'offer_new', readAt: '2026-12-01T06:00:00Z')).unread, isFalse);
      expect(AppNotification(mkNotification('n', 'offer_new')).created!.year, 2026);
    });

    test('where a tap goes, by type', () {
      String? r(String type, [Map<String, dynamic>? d]) => notificationRoute(AppNotification(mkNotification('n', type, data: d)));
      expect(r('offer_new'), '/offers');
      expect(r('offer_replacement'), '/offers');
      expect(r('cod_received'), '/cash');
      for (final t in ['ticket_new', 'ticket_reply', 'ticket_reply_user', 'ticket_resolved', 'ticket_reopened', 'ticket_urgent']) { expect(r(t), '/support', reason: t); }
      expect(r('chat_message', {'offerId': 'o7'}), '/job/o7/chat');
      expect(r('payout_paid'), '/wallet');
      expect(r('withdrawal_paid'), '/wallet');
      expect(r('document_rejected'), '/documents');
      expect(r('driver_arrived', {'offerId': 'o5'}), '/job/o5');
      expect(r('suspension_cleared'), isNull);
    });
  });

  group('support tickets', () {
    final now = DateTime.utc(2026, 12, 20, 12);
    test('status flags and the urgent priority', () {
      final t = Ticket(mkTicketRow('t1', status: 'in_review', priority: 'urgent'));
      expect(t.urgent, isTrue); expect(t.resolved, isFalse); expect(t.status, 'in_review');
    });

    test('canReopen: only when resolved, and only within 14 days of resolving', () {
      Ticket res(String at) => Ticket({'id': 't', 'status': 'resolved', 'resolvedAt': at});
      expect(res('2026-12-10T12:00:00Z').canReopen(now: now), isTrue, reason: '10 days');
      expect(res('2026-12-06T12:00:00Z').canReopen(now: now), isTrue, reason: 'exactly 14 days');
      expect(res('2026-12-05T11:59:00Z').canReopen(now: now), isFalse, reason: 'just over 14 days');
      expect(Ticket({'status': 'open'}).canReopen(now: now), isFalse);
      expect(Ticket({'status': 'resolved', 'updatedAt': '2026-12-19T12:00:00Z'}).canReopen(now: now), isTrue, reason: 'falls back to updatedAt');
      expect(Ticket({'status': 'resolved'}).canReopen(now: now), isTrue, reason: 'unknown date: the server decides');
    });

    test('an explicit canReopen from the server wins', () {
      expect(Ticket({'status': 'resolved', 'resolvedAt': '2026-12-19T12:00:00Z', 'canReopen': false}).canReopen(now: now), isFalse);
      expect(Ticket({'status': 'resolved', 'resolvedAt': '2020-01-01T00:00:00Z', 'canReopen': true}).canReopen(now: now), isTrue);
    });

    test('thread: messages, roles and attachments', () {
      final th = mkThread();
      expect(th.ticket.ref, 'TK-000007');
      expect(th.replies.length, 2);
      expect(th.replies[0].mine, isTrue); expect(th.replies[1].mine, isFalse);
      expect(th.replies[0].attachments.single.isImage, isTrue);
      expect(th.replies[1].attachments.single.isPdf, isTrue);
    });

    test('driver categories come from the catalog; a missing/empty list falls back to the built-in set', () {
      expect(driverTicketCategories({'ticketCategories': {'driver': ['cod_issue', 'other']}}), ['cod_issue', 'other']);
      expect(driverTicketCategories({}), defaultDriverTicketCategories);
      expect(driverTicketCategories({'ticketCategories': {'driver': []}}), defaultDriverTicketCategories);
      expect(defaultDriverTicketCategories, containsAll(['cod_issue', 'app_problem']));
    });
  });
}
