import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/jobs/route_map_screen.dart';
import 'package:jr_driver/services.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// The route map (E6): markers + list, coloured legs, the popup of a stop and the quick actions the server allows.
void main() {
  /// A job being worked: s1 is current (with COD and a phone), s2 is located, s3 has no map position.
  Job working({List<Json>? stops, List<String>? actions, bool canReorder = true, Json? extra}) => mkManifestJob(
        actions: actions,
        stops: stops ?? [mkLegStop(1, current: true, extra: {'codCents': 5000, 'canDefer': true}), mkLegStop(2), mkStop(3)],
        extra: {'route': mkRoute(extra: {'canReorder': canReorder}), ...?extra},
      );

  Future<({FakeApi api, FakeExtraApi extra, FakeMapActions actions})> open(WidgetTester t, Job job, {String lang = 'en', FakeExtraApi? extraApi, FakeMapActions? actions, FakeApi? fake, LocationService? location, Size size = const Size(900, 1900)}) async {
    final api = (fake ?? FakeApi())..jobResult = job;
    final ex = extraApi ?? FakeExtraApi();
    final act = actions ?? FakeMapActions();
    await pumpRoutedB(t, const RouteMapScreen(offerId: 'o1'), api: api, extraApi: ex, actions: act, lang: lang, location: location, size: size);
    await settleB(t);
    return (api: api, extra: ex, actions: act);
  }

  Future<void> tapMarker(WidgetTester t, String id) async { await t.tap(find.byKey(Key('map-marker-$id'))); await settleB(t); }
  Future<void> tapRow(WidgetTester t, String id) async { await t.tap(find.byKey(Key('map-row-$id'))); await settleB(t); }
  Finder inSheet(String key) => find.descendant(of: find.byKey(const Key('map-popup')), matching: find.byKey(Key(key)));

  group('map + list', () {
    testWidgets('a marker for every stop with a position, a row for every stop still to do, and the route summary', (t) async {
      await open(t, working());
      expect(find.byKey(const Key('route-map')), findsOneWidget);
      expect(find.byKey(const Key('map-marker-s1')), findsOneWidget);
      expect(find.byKey(const Key('map-marker-s2')), findsOneWidget);
      expect(find.byKey(const Key('map-marker-s3')), findsNothing, reason: 'no position → listed, not plotted');
      for (final id in ['s1', 's2', 's3']) { expect(find.byKey(Key('map-row-$id')), findsOneWidget, reason: id); }
      expect(find.byKey(const Key('map-unlocated-s3')), findsOneWidget);
      expect(find.text('No map location'), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('map-summary'))).data, '3 stops left · 12.0 km · 52 min');
      // marker letters follow the route order, in the markers and in the rows
      for (final l in ['A', 'B']) { expect(find.descendant(of: find.byKey(const Key('route-map')), matching: find.text(l)), findsOneWidget, reason: l); }
      for (final l in ['A', 'B', 'C']) { expect(find.descendant(of: find.byKey(const Key('map-list')), matching: find.text(l)), findsOneWidget, reason: l); }
      expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
      expect(find.byKey(const Key('map-locate')), findsOneWidget);
      expect(find.byKey(const Key('map-fit')), findsOneWidget);
    });

    testWidgets('each row shows the parcel code, the address, "≈ time · distance" of its leg (geometry first) and a round navigate button', (t) async {
      final ex = FakeExtraApi()..geometry = RouteGeometry.fromJson({'legs': [{'stopId': 's1', 'order': 1, 'distanceM': 20200, 'durationS': 1620}]});
      await open(t, working(), extraApi: ex);
      expect(find.descendant(of: find.byKey(const Key('map-row-s1')), matching: find.text('JR-000042-001')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('map-row-s1')), matching: find.textContaining('Street 1, Riyadh')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('map-leg-s1'))).data, '≈ 27 min · 20.2 km');
      expect(t.widget<Text>(find.byKey(const Key('map-leg-s2'))).data, '≈ 12 min · 4.2 km', reason: 'no geometry for s2: the job\'s own leg fields');
      expect(find.byKey(const Key('map-nav-s1')), findsOneWidget);
      expect(find.text('Current stop'), findsOneWidget);
    });

    testWidgets('the navigate button of a row calls the shared navigate action; it is disabled for a stop with no position', (t) async {
      final r = await open(t, working());
      await t.tap(find.byKey(const Key('map-nav-s2')));
      await settleB(t);
      expect(r.actions.calls, ['navigate:s2']);
      expect(t.widget<IconButton>(find.byKey(const Key('map-nav-s3'))).onPressed, isNull);
      expect(find.byKey(const Key('map-popup')), findsNothing, reason: 'navigate does not open the popup');
    });

    testWidgets('route lines: roads and straight estimates; the dashed-lines note appears only when EVERYTHING is an estimate', (t) async {
      final road = encodePolyline([(lat: 24.71, lng: 46.61), (lat: 24.72, lng: 46.62)]);
      final ex = FakeExtraApi()..geometry = RouteGeometry.fromJson({'origin': {'lat': 24.70, 'lng': 46.60}, 'legs': [
        {'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}, 'polyline': road},
        {'stopId': 's2', 'order': 2, 'from': {'lat': 24.71, 'lng': 46.61}, 'to': {'lat': 24.72, 'lng': 46.62}},
      ]});
      await open(t, working(), extraApi: ex);
      expect(find.byKey(const Key('map-origin')), findsOneWidget, reason: 'the start of the route is marked');
      expect(find.byKey(const Key('map-estimate')), findsNothing);
      final only = FakeExtraApi()..geometry = RouteGeometry.fromJson({'legs': [{'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}}]});
      await t.pumpWidget(const SizedBox());
      await open(t, working(), extraApi: only);
      expect(find.byKey(const Key('map-estimate')), findsOneWidget);
      expect(find.text('Dashed lines are straight-line estimates, not real roads.'), findsOneWidget);
    });
  });

  group('the popup of a stop', () {
    testWidgets('tapping a MARKER opens it with the main details of the current stop (code, status, address, contents, recipient, COD, leg)', (t) async {
      await open(t, working(stops: [mkLegStop(1, current: true, extra: {'codCents': 5000, 'notes': 'Ring twice', 'recipientPhone': '+966555000001'}), mkLegStop(2), mkStop(3)]));
      await tapMarker(t, 's1');
      expect(find.byKey(const Key('map-popup')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('sheet-code'))).data, 'JR-000042-001');
      expect(find.descendant(of: find.byKey(const Key('sheet-status')), matching: find.text('On the vehicle')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-address')), matching: find.textContaining('Street 1, Riyadh')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-cod')), matching: find.text('SAR 50.00')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-contents')), matching: find.textContaining('Clothes 1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-notes')), matching: find.text('Ring twice')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-recipient')), matching: find.text('Recipient 1 · +966555000001')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('sheet-leg')), matching: find.text('≈ 12 min · 4.2 km')), findsOneWidget);
    });

    testWidgets('tapping a ROW opens the same popup; another stop shows no recipient and no cash block when there is none', (t) async {
      await open(t, working());
      await tapRow(t, 's2');
      expect(t.widget<Text>(find.byKey(const Key('sheet-code'))).data, 'JR-000042-002');
      expect(find.byKey(const Key('sheet-recipient')), findsNothing, reason: 'name / phone are only exposed for the current stop');
      expect(find.byKey(const Key('sheet-cod')), findsNothing);
    });

    testWidgets('current stop, not arrived: Navigate · Call · WhatsApp · I\'ve arrived · Can\'t deliver (+ Postpone when the server allows) — no Deliver, no Make next', (t) async {
      await open(t, working());
      await tapMarker(t, 's1');
      for (final k in ['sheet-navigate', 'sheet-call', 'sheet-whatsapp', 'sheet-arrive', 'sheet-cant', 'sheet-postpone']) { expect(inSheet(k), findsOneWidget, reason: k); }
      for (final k in ['sheet-deliver', 'sheet-make-next']) { expect(inSheet(k), findsNothing, reason: k); }
      expect(find.descendant(of: find.byKey(const Key('sheet-arrive')), matching: find.text('I\'ve arrived')), findsOneWidget);
    });

    testWidgets('current stop, arrived: Deliver replaces I\'ve arrived; Postpone disappears when canDefer is false', (t) async {
      await open(t, working(stops: [mkLegStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00Z', 'canDefer': false}), mkLegStop(2)]));
      await tapMarker(t, 's1');
      expect(inSheet('sheet-deliver'), findsOneWidget);
      expect(inSheet('sheet-cant'), findsOneWidget);
      expect(inSheet('sheet-arrive'), findsNothing);
      expect(inSheet('sheet-postpone'), findsNothing);
      expect(find.byKey(const Key('sheet-arrived')), findsOneWidget);
    });

    testWidgets('another stop: Navigate and Make next (route.canReorder) — nothing that only the current stop may do', (t) async {
      await open(t, working());
      await tapMarker(t, 's2');
      expect(inSheet('sheet-navigate'), findsOneWidget);
      expect(inSheet('sheet-make-next'), findsOneWidget);
      for (final k in ['sheet-call', 'sheet-whatsapp', 'sheet-arrive', 'sheet-deliver', 'sheet-cant', 'sheet-postpone']) { expect(inSheet(k), findsNothing, reason: k); }
    });

    testWidgets('no Make next when the server says the order may not be changed', (t) async {
      await open(t, working(canReorder: false));
      await tapMarker(t, 's2');
      expect(inSheet('sheet-make-next'), findsNothing);
      expect(inSheet('sheet-navigate'), findsOneWidget);
    });

    testWidgets('before the route is approved the popup is read-only (Navigate only)', (t) async {
      await open(t, working(actions: ['approve_route', 'report_no_work']));
      await tapMarker(t, 's1');
      expect(inSheet('sheet-navigate'), findsOneWidget);
      for (final k in ['sheet-call', 'sheet-whatsapp', 'sheet-arrive', 'sheet-deliver', 'sheet-cant', 'sheet-postpone', 'sheet-make-next']) { expect(inSheet(k), findsNothing, reason: k); }
    });

    testWidgets('every quick action calls the shared StopActions with the right stop', (t) async {
      final r = await open(t, working(stops: [mkLegStop(1, current: true, extra: {'canDefer': true}), mkLegStop(2)]));
      r.actions.applies = false; // keep the popup open between taps
      await tapMarker(t, 's1');
      for (final k in ['sheet-navigate', 'sheet-call', 'sheet-whatsapp', 'sheet-arrive', 'sheet-cant', 'sheet-postpone']) {
        await t.ensureVisible(inSheet(k));
        await t.tap(inSheet(k));
        await settleB(t);
      }
      expect(r.actions.calls, ['navigate:s1', 'call:s1', 'whatsapp:s1', 'arrive:s1', 'cant:s1', 'postpone:s1']);
      await t.tapAt(const Offset(10, 10)); // dismiss
      await settleB(t);
      await tapMarker(t, 's2');
      await t.tap(inSheet('sheet-make-next'));
      await settleB(t);
      expect(r.actions.calls.last, 'makeNext:s2');
    });

    testWidgets('an applied action refreshes the job (and the popup follows: arrive → Deliver)', (t) async {
      final r = await open(t, working());
      r.actions.onApplied = (a, s) { if (a == 'arrive') r.api.jobResult = working(stops: [mkLegStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00Z', 'codCents': 5000}), mkLegStop(2), mkStop(3)]); };
      await tapMarker(t, 's1');
      final before = r.api.jobFetches;
      await t.tap(inSheet('sheet-arrive'));
      await settleB(t);
      expect(r.api.jobFetches, greaterThan(before), reason: 'job re-read after the action');
      expect(find.byKey(const Key('map-popup')), findsOneWidget, reason: 'still the same stop');
      expect(inSheet('sheet-deliver'), findsOneWidget);
      expect(inSheet('sheet-arrive'), findsNothing);
    });

    testWidgets('an action that did not apply (cancelled / failed) leaves everything as it was and does not refresh', (t) async {
      final r = await open(t, working());
      r.actions.applies = false;
      await tapMarker(t, 's1');
      final before = r.api.jobFetches;
      await t.tap(inSheet('sheet-arrive'));
      await settleB(t);
      expect(r.actions.calls, ['arrive:s1']);
      expect(r.api.jobFetches, before);
      expect(inSheet('sheet-arrive'), findsOneWidget);
    });

    testWidgets('delivering the stop closes the popup and the list moves on', (t) async {
      final r = await open(t, working(stops: [mkLegStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00Z'}), mkLegStop(2), mkLegStop(3)]));
      r.actions.onApplied = (a, s) { if (a == 'deliver') r.api.jobResult = working(stops: [mkStop(1, status: 'delivered'), mkLegStop(2, current: true), mkLegStop(3)]); };
      await tapMarker(t, 's1');
      await t.tap(inSheet('sheet-deliver'));
      await settleB(t);
      expect(find.byKey(const Key('map-popup')), findsNothing);
      expect(find.byKey(const Key('map-row-s1')), findsNothing, reason: 'delivered: no longer a stop to do');
      expect(find.byKey(const Key('map-row-s2')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('map-summary'))).data, startsWith('2 stops left'));
    });
  });

  group('states', () {
    testWidgets('loading: a spinner, not a blank screen; then the map', (t) async {
      final api = _SlowApi()..jobResult = working();
      await pumpRoutedB(t, const RouteMapScreen(offerId: 'o1'), api: api, extraApi: FakeExtraApi(), actions: FakeMapActions());
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      expect(find.byKey(const Key('route-map')), findsNothing);
      api.release.complete();
      await settleB(t);
      expect(find.byKey(const Key('route-map')), findsOneWidget);
    });

    testWidgets('the job fails to load: a localized error with Retry that works', (t) async {
      final api = FakeApi()..jobResult = working()..jobFetchError = ApiException('NETWORK', 'x');
      await pumpRoutedB(t, const RouteMapScreen(offerId: 'o1'), api: api, extraApi: FakeExtraApi(), actions: FakeMapActions());
      await settleB(t);
      expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
      api.jobFetchError = null;
      await t.tap(find.byKey(const Key('retry')));
      await settleB(t);
      expect(find.byKey(const Key('route-map')), findsOneWidget);
    });

    testWidgets('route lines fail to load: markers and list stay, a strip says so (straight lines instead), Retry asks again', (t) async {
      final ex = FakeExtraApi()..geometryError = ApiException('NETWORK', 'x');
      await open(t, working(), extraApi: ex);
      expect(find.byKey(const Key('map-geo-error')), findsOneWidget);
      expect(find.text('Couldn\'t load the road lines. Showing straight lines.'), findsOneWidget);
      expect(find.byKey(const Key('map-marker-s1')), findsOneWidget);
      expect(find.byKey(const Key('map-row-s2')), findsOneWidget);
      final before = ex.calls.where((c) => c.startsWith('geometry')).length;
      ex.geometryError = null;
      await t.tap(find.descendant(of: find.byKey(const Key('map-geo-error')), matching: find.text('Try again')));
      await settleB(t);
      expect(ex.calls.where((c) => c.startsWith('geometry')).length, before + 1);
      expect(find.byKey(const Key('map-geo-error')), findsNothing);
    });

    testWidgets('while the route lines load the map is already usable (thin progress bar, markers shown)', (t) async {
      final ex = FakeExtraApi()..geometryGate = Completer<void>();
      await open(t, working(), extraApi: ex);
      expect(find.byKey(const Key('map-geo-loading')), findsOneWidget);
      expect(find.byKey(const Key('map-marker-s1')), findsOneWidget);
      ex.geometryGate!.complete();
      await settleB(t);
      expect(find.byKey(const Key('map-geo-loading')), findsNothing);
    });

    testWidgets('no stop has coordinates: no map, an explanation, and every stop still listed', (t) async {
      await open(t, working(stops: [mkStop(1, current: true), mkStop(2)]));
      expect(find.byKey(const Key('route-map')), findsNothing);
      expect(find.byKey(const Key('map-empty')), findsOneWidget);
      expect(find.byKey(const Key('map-row-s1')), findsOneWidget);
      expect(find.byKey(const Key('map-row-s2')), findsOneWidget);
      await tapRow(t, 's1');
      expect(find.byKey(const Key('map-popup')), findsOneWidget, reason: 'the popup works without a map');
    });

    testWidgets('all stops done: friendly empty state', (t) async {
      await open(t, working(stops: [mkStop(1, status: 'delivered'), mkStop(2, status: 'failed')]));
      expect(find.text('No stops left to show.'), findsOneWidget);
      expect(find.byKey(const Key('route-map')), findsNothing);
    });

    testWidgets('a single-delivery (non per-parcel) job has no route map', (t) async {
      await open(t, mkJob(status: 'attendance_confirmed'));
      expect(find.text('The route map is for jobs with several stops.'), findsOneWidget);
    });

    testWidgets('the locate button puts the driver on the map; fit-to-route does not break anything', (t) async {
      await open(t, working(), location: FakeLocation(granted: true, pos: const (lat: 24.705, lng: 46.605)));
      expect(find.byKey(const Key('map-me')), findsOneWidget, reason: 'location was already allowed: shown at open');
      await t.tap(find.byKey(const Key('map-locate')));
      await settleB(t);
      await t.tap(find.byKey(const Key('map-fit')));
      await settleB(t);
      expect(find.byKey(const Key('map-me')), findsOneWidget);
      expect(t.takeException(), isNull);
    });

    testWidgets('location off: no dot at open; the locate button says why (and does not ask for permission out of the blue at open)', (t) async {
      final loc = FakeLocation(granted: false);
      await open(t, working(), location: loc);
      expect(find.byKey(const Key('map-me')), findsNothing);
      expect(loc.permissionRequests, 0);
      await t.tap(find.byKey(const Key('map-locate')));
      await settleB(t);
      expect(loc.permissionRequests, 1);
      expect(find.text('Couldn\'t get your location. Turn location on and try again.'), findsOneWidget);
    });
  });

  group('RTL, small phone, large text', () {
    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang renders the map screen and the popup without layout errors at 320 dp, 1.4x text', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        await open(t, working(), lang: lang, size: const Size(640, 1400));
        expect(t.takeException(), isNull);
        await tapMarker(t, 's1');
        expect(find.byKey(const Key('map-popup')), findsOneWidget);
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('RouteMapButton opens /job/:id/map', (t) async {
      final api = FakeApi()..jobResult = working();
      await pumpRoutedB(t, const Scaffold(body: RouteMapButton(offerId: 'o7')), api: api, routes: [GoRoute(path: '/job/:id/map', builder: (_, s) => Scaffold(body: Text('MAP-PAGE-${s.pathParameters['id']}')))]);
      expect(find.text('Route map'), findsOneWidget);
      await t.tap(find.byKey(const Key('route-map-button')));
      await settleB(t);
      expect(find.text('MAP-PAGE-o7'), findsOneWidget);
    });
  });
}

class _SlowApi extends FakeApi {
  final release = Completer<void>();
  @override
  Future<Job> job(String offerId) async { await release.future; return super.job(offerId); }
}
