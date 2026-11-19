import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/jobs/route_map_logic.dart';
import '../helpers.dart';

Job _job({List<Json>? stops, List<String>? actions, Json? route, Json? extra}) => mkManifestJob(actions: actions, stops: stops ?? [mkLegStop(1, current: true), mkLegStop(2), mkLegStop(3)], extra: {'route': route ?? mkRoute(), ...?extra});

void main() {
  group('labels and colours', () {
    test('markers are lettered A–Z, then numbered', () {
      expect([for (var i = 0; i < 4; i++) stopLabel(i)], ['A', 'B', 'C', 'D']);
      expect(stopLabel(25), 'Z');
      expect(stopLabel(26), '27');
      expect(stopLabel(40), '41');
    });

    test('leg colours cycle', () {
      expect(legColor(0), legPalette[0]);
      expect(legColor(legPalette.length), legPalette[0]);
      expect(legColor(1), isNot(legColor(0)));
      expect(legPalette.toSet().length, legPalette.length, reason: 'all distinct');
    });
  });

  group('RouteMapModel — which stops, in which order', () {
    test('only stops still to do (loaded) are listed; delivered / failed / pending ones are not', () {
      final m = RouteMapModel.build(_job(stops: [mkLegStop(1, current: true), mkStop(2, status: 'delivered'), mkLegStop(3), mkStop(4, status: 'failed'), mkStop(5, status: 'pending')]), null);
      expect(m.stops.map((s) => s.id), ['s1', 's3']);
    });

    test('route order follows stopOrder (not the order the server listed them), ties by seq; letters follow the position', () {
      final m = RouteMapModel.build(_job(stops: [
        mkLegStop(1, extra: {'stopOrder': 3}), mkLegStop(2, extra: {'stopOrder': 1}), mkLegStop(3, extra: {'stopOrder': 2}), mkLegStop(4, extra: {'stopOrder': 2}),
      ]), null);
      expect(m.stops.map((s) => s.id), ['s2', 's3', 's4', 's1']);
      expect(m.stops.map((s) => s.label), ['A', 'B', 'C', 'D']);
      expect(m.stops.map((s) => s.index), [0, 1, 2, 3]);
    });

    test('stops without a map position are listed but not plotted; the current stop is flagged', () {
      final m = RouteMapModel.build(_job(stops: [mkLegStop(1, current: true), mkStop(2), mkLegStop(3, extra: {'located': false})]), null);
      expect(m.stops.length, 3);
      expect(m.plotted.map((s) => s.id), ['s1']);
      expect(m.unplotted.map((s) => s.id), ['s2', 's3']);
      expect(m.byId('s1')!.current, isTrue);
      expect(m.hasMap, isTrue);
      expect(RouteMapModel.build(_job(stops: [mkStop(1, current: true), mkStop(2)]), null).hasMap, isFalse);
    });

    test('a position outside the world is not plotted', () {
      final m = RouteMapModel.build(_job(stops: [mkLegStop(1, extra: {'lat': 95.0, 'lng': 10.0})]), null);
      expect(m.plotted, isEmpty);
    });

    test('per-stop distance / time come from the geometry leg first, else from the job\'s own leg fields', () {
      final geo = RouteGeometry.fromJson({'legs': [{'stopId': 's1', 'order': 1, 'distanceM': 20200, 'durationS': 1620}]});
      final m = RouteMapModel.build(_job(stops: [mkLegStop(1, legM: 4200, legS: 720), mkLegStop(2, legM: 1800, legS: 300)]), geo);
      expect(m.byId('s1')!.distanceM, 20200); expect(m.byId('s1')!.durationS, 1620);
      expect(m.byId('s2')!.distanceM, 1800); expect(m.byId('s2')!.durationS, 300);
      final none = RouteMapModel.build(_job(stops: [mkLegStop(1, legM: 0, legS: 0)]), null);
      expect(none.byId('s1')!.distanceM, isNull);
    });

    test('remaining totals: from the plan when it has them, else the sum of the legs, else unknown', () {
      expect(RouteMapModel.build(_job(), null).totalDistanceM, 12000);
      expect(RouteMapModel.build(_job(), null).totalDurationS, 3100);
      final noPlan = RouteMapModel.build(_job(route: mkRoute(extra: {'remainingDistanceM': null, 'remainingDurationS': null})), null);
      expect(noPlan.totalDistanceM, 4200 * 3); expect(noPlan.totalDurationS, 720 * 3);
      final nothing = RouteMapModel.build(_job(stops: [mkLegStop(1, legM: 0, legS: 0)], route: mkRoute(extra: {'remainingDistanceM': null, 'remainingDurationS': null})), null);
      expect(nothing.totalDistanceM, isNull);
    });
  });

  group('RouteMapModel — lines', () {
    final enc = encodePolyline([(lat: 24.71, lng: 46.61), (lat: 24.72, lng: 46.62), (lat: 24.73, lng: 46.63)]);
    final geo = RouteGeometry.fromJson({
      'origin': {'lat': 24.70, 'lng': 46.60},
      'legs': [
        {'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}, 'polyline': enc},
        {'stopId': 's2', 'order': 2, 'from': {'lat': 24.71, 'lng': 46.61}, 'to': {'lat': 24.72, 'lng': 46.62}, 'polyline': null},
      ],
    });

    test('one coloured line per leg: roads solid, estimates dashed, colour = the stop the leg leads into', () {
      final m = RouteMapModel.build(_job(), geo);
      expect(m.lines.length, 2);
      expect(m.lines[0].dashed, isFalse); expect(m.lines[0].points.length, 3);
      expect(m.lines[1].dashed, isTrue); expect(m.lines[1].points.length, 2);
      expect(m.lines[0].color, m.byId('s1')!.color);
      expect(m.lines[1].color, m.byId('s2')!.color);
      expect(m.lines[0].color, isNot(m.lines[1].color));
      expect(m.allEstimates, isFalse);
    });

    test('with only estimates every line is dashed (and the screen says so)', () {
      final onlyEst = RouteGeometry.fromJson({'legs': [{'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}}]});
      expect(RouteMapModel.build(_job(), onlyEst).allEstimates, isTrue);
    });

    test('no geometry at all (loading, failed, old server): straight dashed lines origin? → stop A → B → C, skipping unlocated stops', () {
      final m = RouteMapModel.build(_job(stops: [mkLegStop(1, current: true), mkStop(2), mkLegStop(3)]), null);
      expect(m.lines.length, 1, reason: 'no origin, so A has no line into it; A → C');
      expect(m.lines.single.dashed, isTrue);
      expect(m.lines.single.stopId, 's3');
      final withOrigin = RouteMapModel.build(_job(), RouteGeometry.fromJson({'origin': {'lat': 24.70, 'lng': 46.60}, 'legs': []}));
      expect(withOrigin.lines.length, 3);
      expect(withOrigin.lines.every((l) => l.dashed), isTrue);
    });

    test('the camera sees the stops, the start, the driver and every line point', () {
      final m = RouteMapModel.build(_job(), geo, me: (lat: 24.6, lng: 46.5));
      final lats = m.fitPoints.map((p) => p.lat);
      expect(lats, contains(24.6)); expect(lats, contains(24.70)); expect(lats, contains(24.73));
      expect(m.origin, isNotNull);
    });
  });

  group('allowedStopActions — only what the server allows', () {
    Stop cur({bool arrived = false, bool canDefer = false, String? phone = '+966555000001'}) => Stop(mkLegStop(1, current: true, extra: {'arrivedAt': arrived ? '2026-12-01T07:00:00Z' : null, 'canDefer': canDefer, 'recipientPhone': phone}));
    final working = _job(actions: ['work_stops', 'end_route']);

    test('current stop, not arrived: navigate, call, WhatsApp, arrive — nothing to deliver yet', () {
      final a = allowedStopActions(working, cur());
      expect([a.navigate, a.call, a.whatsapp, a.arrive, a.cantDeliver], everyElement(isTrue));
      expect([a.deliver, a.postpone, a.makeNext], everyElement(isFalse));
    });

    test('current stop, arrived: deliver replaces arrive; postpone only when the server says canDefer', () {
      final a = allowedStopActions(working, cur(arrived: true));
      expect(a.arrive, isFalse); expect(a.deliver, isTrue); expect(a.cantDeliver, isTrue); expect(a.postpone, isFalse);
      expect(allowedStopActions(working, cur(arrived: true, canDefer: true)).postpone, isTrue);
    });

    test('no phone exposed → no Call button (WhatsApp goes through the server and stays)', () {
      final a = allowedStopActions(working, cur(phone: null));
      expect(a.call, isFalse); expect(a.whatsapp, isTrue);
    });

    test('another stop: navigate only — and "make next" only when route.canReorder is true', () {
      final other = Stop(mkLegStop(2));
      final a = allowedStopActions(working, other);
      expect(a.navigate, isTrue);
      expect([a.call, a.whatsapp, a.arrive, a.deliver, a.cantDeliver, a.postpone, a.makeNext], everyElement(isFalse));
      final canReorder = _job(actions: ['work_stops'], route: mkRoute(extra: {'canReorder': true}));
      expect(allowedStopActions(canReorder, other).makeNext, isTrue);
      expect(allowedStopActions(canReorder, Stop(mkLegStop(1, current: true))).makeNext, isFalse, reason: 'the current stop is already next');
      expect(allowedStopActions(canReorder, Stop(mkLegStop(2, extra: {'arrivedAt': '2026-12-01T07:00:00Z'}))).makeNext, isFalse, reason: 'an arrived stop is pinned first');
      expect(canReorderRoute(working), isFalse);
    });

    test('before the route is approved (no work_stops) nothing but navigation', () {
      final review = _job(actions: ['approve_route', 'report_no_work'], route: mkRoute(extra: {'canReorder': true}));
      final a = allowedStopActions(review, Stop(mkLegStop(1, current: true)));
      expect(a.navigate, isTrue);
      expect([a.call, a.whatsapp, a.arrive, a.deliver, a.cantDeliver, a.postpone, a.makeNext], everyElement(isFalse));
    });

    test('a stop with no map position cannot be navigated to; a resolved stop has no actions at all', () {
      expect(allowedStopActions(working, Stop(mkStop(1, current: true))).navigate, isFalse);
      expect(allowedStopActions(working, Stop(mkLegStop(1, current: true, extra: {'status': 'delivered'}))).cantDeliver, isFalse);
    });

    test('COD amount of a stop', () {
      expect(stopCodCents(Stop(mkLegStop(1, extra: {'codCents': 12500}))), 12500);
      expect(stopCodCents(Stop(mkLegStop(1))), 0);
    });
  });
}
