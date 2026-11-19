import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import '../helpers.dart';

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

void main() {
  Future<FakeApi> open(WidgetTester t, Job job, {FakeLinks? links, FakeLocation? loc, String lang = 'en', FakeApi? api}) async {
    final a = (api ?? FakeApi())..jobResult = job;
    await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, links: links, location: loc, lang: lang);
    await settle(t);
    return a;
  }

  Future<void> show(WidgetTester t, Key k) async {
    if (find.byKey(k).evaluate().isEmpty) await t.scrollUntilVisible(find.byKey(k), 300, scrollable: find.byType(Scrollable).first);
    await Scrollable.ensureVisible(t.element(find.byKey(k)), alignment: 0.5);
    await t.pump();
  }
  Future<void> tapKey(WidgetTester t, Key k) async { await show(t, k); await t.tap(find.byKey(k)); await settle(t); }
  String textOf(WidgetTester t, Key k) { final w = t.widget(find.byKey(k)); return w is Text ? w.data! : t.widget<Text>(find.descendant(of: find.byKey(k), matching: find.byType(Text)).last).data!; }
  String allText(WidgetTester t, Key k) => find.descendant(of: find.byKey(k), matching: find.byType(Text)).evaluate().map((e) => (e.widget as Text).data ?? '').join(' | ');

  /// The review screen: three located stops with legs, route planned by Google.
  Job review({Json? route, List<Json>? stops, bool canOptimize = true, Json? extra}) => mkManifestJob(
        actions: ['approve_route', 'report_no_work'],
        stops: stops ?? [mkLegStop(1), mkLegStop(2, type: 'business', legM: 1800, legS: 300), mkLegStop(3, legM: 9000, legS: 1500)],
        extra: {'routeApprovedAt': null, 'route': route ?? mkRoute(canOptimize: canOptimize), ...?extra},
      );
  /// The working screen: stop 1 is current, 2 and 3 are upcoming.
  Job working({Json? route, List<Json>? stops, Json? extra}) => mkManifestJob(stops: stops ?? [mkLegStop(1, current: true), mkLegStop(2), mkLegStop(3)], extra: {'route': route ?? mkRoute(), ...?extra});

  group('route summary card — before approval', () {
    testWidgets('Google plan: provider chip, distance, driving time, stop count, planned time, the two actions — and no estimate notice', (t) async {
      await open(t, review());
      expect(find.byKey(const Key('route-summary')), findsOneWidget);
      expect(textOf(t, const Key('route-provider')), 'Google best route');
      expect(allText(t, const Key('route-distance')), 'Distance | 24.3 km');
      expect(allText(t, const Key('route-time')), 'Driving time | 1 h 52 min');
      expect(allText(t, const Key('route-stops')), 'Stops | 3');
      expect(find.text('Planned at 09:20'), findsOneWidget, reason: 'KSA time');
      expect(find.byKey(const Key('route-estimate-notice')), findsNothing);
      expect(find.byKey(const Key('route-warning-0')), findsNothing);
      expect(find.byKey(const Key('route-whole')), findsNothing, reason: 'no "remaining" yet: the totals are the headline');
      expect(find.byKey(const Key('route-optimize')), findsOneWidget);
      expect(find.text('Plans the best order from where you are now. You still review and approve the route before you start.'), findsOneWidget);
      expect(find.byKey(const Key('route-open-maps')), findsOneWidget);
      expect(find.byKey(const Key('approve-route')), findsOneWidget, reason: 'the driver still approves');
      for (final k in ['route-optimize', 'route-open-maps']) {
        await show(t, Key(k));
        expect(t.getSize(find.byKey(Key(k))).height, greaterThanOrEqualTo(48), reason: '$k is a thumb-sized target');
      }
    });

    testWidgets('re-optimised by the driver says so', (t) async {
      await open(t, review(route: mkRoute(extra: {'by': 'driver'})));
      expect(find.text('Re-optimised at your request at 09:20'), findsOneWidget);
    });

    testWidgets('estimate (local heuristic): chip says "Estimated route" and an honest notice explains what that means', (t) async {
      await open(t, review(route: mkRoute(provider: 'local_heuristic', warnings: ['ROUTING_PROVIDER_NOT_CONFIGURED'])));
      expect(textOf(t, const Key('route-provider')), 'Estimated route');
      expect(find.byKey(const Key('route-estimate-notice')), findsOneWidget);
      expect(find.textContaining('estimate from straight-line distances and does not account for live traffic'), findsOneWidget);
      expect(find.text('Google routing is not set up on this platform — the order is an estimate from straight-line distances, not traffic-aware.'), findsOneWidget);
    });

    testWidgets('mixed plan: "part estimated" chip and notice', (t) async {
      await open(t, review(route: mkRoute(provider: 'mixed', warnings: ['ROUTING_PROVIDER_FAILED: Google Routes HTTP 503'])));
      expect(textOf(t, const Key('route-provider')), 'Google best route (part estimated)');
      expect(find.textContaining('Part of this route is an estimate'), findsOneWidget);
    });

    testWidgets('warnings are translated by code; provider detail after the colon is never shown; unknown codes read generically', (t) async {
      await open(t, review(route: mkRoute(warnings: ['ROUTE_UNLOCATED_STOPS:3', 'ROUTING_PROVIDER_FAILED: Google Routes HTTP 503 key=AIza-secret', 'BRAND_NEW_CODE:9', 'ROUTE_APPROXIMATE_LOCATIONS:2'])));
      expect(find.text('3 stop(s) have no location on the map and are placed last — check their addresses.'), findsOneWidget);
      expect(find.text('Google routing did not answer for part of the route — that part is an estimate from straight-line distances.'), findsOneWidget);
      expect(find.text('The route planner left a note that this version of the app cannot show (BRAND_NEW_CODE).'), findsOneWidget);
      expect(find.text('2 stop(s) were located only approximately from their address.'), findsOneWidget);
      expect(find.textContaining('503'), findsNothing);
      expect(find.textContaining('AIza'), findsNothing);
      expect(find.textContaining('route.warn'), findsNothing);
      expect(find.byKey(const Key('route-warning-3')), findsOneWidget);
    });

    testWidgets('a repeated warning is listed once', (t) async {
      await open(t, review(route: mkRoute(warnings: ['ROUTE_NO_ORIGIN', 'ROUTE_NO_ORIGIN'])));
      expect(find.byKey(const Key('route-warning-0')), findsOneWidget);
      expect(find.byKey(const Key('route-warning-1')), findsNothing);
    });

    testWidgets('legs on the stop tiles: first stop "from the start", the rest "from the previous stop"; nothing for a stop without a leg', (t) async {
      await open(t, review(stops: [mkLegStop(1), mkLegStop(2, type: 'business', legM: 1800, legS: 300), mkStop(3)]));
      expect(textOf(t, const Key('leg-s1')), '≈ 12 min · 4.2 km from the start');
      expect(textOf(t, const Key('leg-s2')), '≈ 5 min · 1.8 km from the previous stop');
      expect(find.byKey(const Key('leg-s3')), findsNothing);
      expect(find.text('Business (B2B)'), findsOneWidget, reason: 'type badge still shown with the new meta row');
    });

    testWidgets('unlocated and approximate stops carry a badge; located ones do not', (t) async {
      await open(t, review(stops: [mkLegStop(1), mkStop(2, extra: {'located': false}), mkLegStop(3, geoSource: 'geocoded_approx')], route: mkRoute(warnings: ['ROUTE_UNLOCATED_STOPS:1', 'ROUTE_APPROXIMATE_LOCATIONS:1'], extra: {'unlocated': 1, 'approximate': 1})));
      expect(find.byKey(const Key('badge-unlocated-s2')), findsOneWidget);
      expect(find.byKey(const Key('badge-approx-s3')), findsOneWidget);
      expect(find.byKey(const Key('badge-unlocated-s1')), findsNothing);
      expect(find.byKey(const Key('badge-approx-s1')), findsNothing);
      expect(find.byKey(const Key('badge-unlocated-s3')), findsNothing);
      expect(find.text('No map location'), findsOneWidget);
      expect(find.text('Approximate location'), findsOneWidget);
    });

    testWidgets('a geocoded (not approximate) stop has no badge', (t) async {
      await open(t, review(stops: [mkLegStop(1, geoSource: 'geocoded'), mkLegStop(2, geoSource: 'geocoded')]));
      expect(find.text('Approximate location'), findsNothing);
      expect(find.text('No map location'), findsNothing);
    });

    testWidgets('canOptimize false (e.g. a single stop): no Re-optimise button, no explanation; the summary stays', (t) async {
      await open(t, review(canOptimize: false));
      expect(find.byKey(const Key('route-summary')), findsOneWidget);
      expect(find.byKey(const Key('route-optimize')), findsNothing);
      expect(find.byKey(const Key('route-optimize-hint')), findsNothing);
    });

    testWidgets('not planned yet: says so and offers to plan it; with nothing to do the card is hidden', (t) async {
      await open(t, review(route: mkRoute(planned: false, provider: null, extra: {'totalDistanceM': 0, 'totalDurationS': 0, 'plannedAt': null, 'by': null})));
      expect(find.byKey(const Key('route-not-planned')), findsOneWidget);
      expect(find.byKey(const Key('route-distance')), findsNothing);
      expect(find.byKey(const Key('route-provider')), findsNothing);
      expect(find.byKey(const Key('route-optimize')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await open(t, review(route: mkRoute(planned: false, provider: null, canOptimize: false)));
      expect(find.byKey(const Key('route-summary')), findsNothing);
      expect(find.byKey(const Key('approve-route')), findsOneWidget);
    });

    testWidgets('an older server without `route` / `located` / legs: the review works exactly as before', (t) async {
      await open(t, mkManifestJob(actions: ['approve_route'], stops: [mkStop(1), mkStop(2)], extra: {'routeApprovedAt': null}));
      expect(find.byKey(const Key('route-summary')), findsNothing);
      expect(find.byKey(const Key('route-stop-1')), findsOneWidget);
      expect(find.byKey(const Key('leg-s1')), findsNothing);
      expect(find.byKey(const Key('approve-route')), findsOneWidget);
    });

    testWidgets('zero totals (nothing could be located) show a dash, not "0.0 km"', (t) async {
      await open(t, review(route: mkRoute(extra: {'totalDistanceM': 0, 'totalDurationS': 0})));
      expect(allText(t, const Key('route-distance')), 'Distance | —');
      expect(allText(t, const Key('route-time')), 'Driving time | —');
    });
  });

  group('route summary card — while working', () {
    testWidgets('remaining distance / time / stops lead; the whole route is the footnote; the card sits after the current stop', (t) async {
      await open(t, working());
      await show(t, const Key('route-summary'));
      expect(allText(t, const Key('route-distance')), 'Distance left | 12.0 km');
      expect(allText(t, const Key('route-time')), 'Time left | 52 min');
      expect(allText(t, const Key('route-stops')), 'Stops left | 3 of 3');
      expect(textOf(t, const Key('route-whole')), 'Whole route: 24.3 km · 1 h 52 min');
      expect(find.text('Only the stops you have not reached yet are re-ordered. The stop you are at stays first.'), findsOneWidget);
      expect(t.getTopLeft(find.byKey(const Key('route-summary'))).dy, greaterThan(t.getTopLeft(find.byKey(const Key('current-stop'))).dy), reason: 'the current stop stays the first thing on the screen');
    });

    testWidgets('after a delivery the counts follow the stops that are left', (t) async {
      await open(t, working(stops: [mkLegStop(1, current: false)..['status'] = 'delivered', mkLegStop(2, current: true), mkLegStop(3)], route: mkRoute(extra: {'remainingDistanceM': 6500, 'remainingDurationS': 1200})));
      await show(t, const Key('route-summary'));
      expect(allText(t, const Key('route-stops')), 'Stops left | 2 of 3');
      expect(allText(t, const Key('route-distance')), 'Distance left | 6.5 km');
      expect(allText(t, const Key('route-time')), 'Time left | 20 min');
    });

    testWidgets('the current stop shows its leg and location badges; upcoming ones too', (t) async {
      await open(t, working(stops: [mkLegStop(1, current: true), mkStop(2, extra: {'located': false}), mkLegStop(3, geoSource: 'geocoded_approx')]));
      expect(textOf(t, const Key('leg-s1')), '≈ 12 min · 4.2 km from the start');
      await show(t, const Key('upcoming'));
      expect(find.byKey(const Key('badge-unlocated-s2')), findsOneWidget);
      expect(textOf(t, const Key('leg-s3')), '≈ 12 min · 4.2 km from the previous stop');
      expect(find.byKey(const Key('badge-approx-s3')), findsOneWidget);
    });

    testWidgets('the current stop without a map position says so (its Navigate button falls back to the address)', (t) async {
      final links = FakeLinks();
      await open(t, working(stops: [mkStop(1, current: true, extra: {'located': false}), mkLegStop(2)]), links: links);
      expect(find.byKey(const Key('badge-unlocated-s1')), findsOneWidget);
      await tapKey(t, const Key('stop-maps'));
      expect(links.opened.last.path, '/maps/search/');
    });

    testWidgets('per-stop navigation and the one-stop-at-a-time form are unchanged', (t) async {
      final links = FakeLinks();
      await open(t, working(stops: [mkLegStop(1, current: true), mkLegStop(2)]), links: links);
      await tapKey(t, const Key('stop-maps'));
      expect(links.opened.last.queryParameters['destination'], '24.71,46.61');
      expect(find.byKey(const Key('arrive')), findsOneWidget);
      expect(find.byKey(const Key('end-route')), findsOneWidget);
    });
  });

  group('Re-optimise route', () {
    final changedOrder = [mkLegStop(3), mkLegStop(1), mkLegStop(2)];

    testWidgets('success: GPS goes along, the job is re-read, the new order is on screen and the message says the order changed', (t) async {
      final api = FakeApi()..jobAfterOptimize = review(stops: changedOrder, route: mkRoute(extra: {'by': 'driver'}));
      await open(t, review(), api: api);
      expect(find.descendant(of: find.byKey(const Key('route-stop-1')), matching: find.text('Street 1, Riyadh')), findsOneWidget);
      final reads = api.jobFetches;
      await tapKey(t, const Key('route-optimize'));
      expect(api.calls.where((c) => c.startsWith('optimize')), ['optimize:24.7,46.7']);
      expect(api.jobFetches, greaterThan(reads));
      expect(find.descendant(of: find.byKey(const Key('route-stop-1')), matching: find.text('Street 3, Riyadh')), findsOneWidget);
      expect(find.text('Route updated: the stops were re-ordered.'), findsOneWidget);
      expect(find.text('Re-optimised at your request at 09:20'), findsOneWidget);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('route-optimize'))).onPressed, isNotNull, reason: 'ready for another go');
    });

    testWidgets('three different messages: cached ("already the best order"), changed, recomputed but unchanged', (t) async {
      final table = {
        (true, false): 'This is already the best order for where you are.',
        (false, true): 'Route updated: the stops were re-ordered.',
        (false, false): 'Route re-checked: your current order is still the best one.',
        (true, true): 'This is already the best order for where you are.',
      };
      for (final e in table.entries) {
        final api = FakeApi()..optimizeResult = RouteOptimizeResult({'plan': {}, 'cached': e.key.$1, 'changed': e.key.$2, 'currentId': null});
        await open(t, review(), api: api);
        await tapKey(t, const Key('route-optimize'));
        expect(find.text(e.value), findsOneWidget, reason: '${e.key}');
        await t.pumpWidget(const SizedBox());
      }
    });

    testWidgets('location is asked for only when the driver taps; if refused the route is planned without coordinates and the driver is told', (t) async {
      final loc = FakeLocation(granted: false);
      final api = await open(t, review(), loc: loc);
      expect(loc.permissionRequests, 0, reason: 'opening the screen never asks');
      await tapKey(t, const Key('route-optimize'));
      expect(loc.permissionRequests, 1);
      expect(api.calls.where((c) => c.startsWith('optimize')), ['optimize:null,null']);
      expect(find.textContaining('Your location was not available, so the route starts from the pickup or the stop you are at.'), findsOneWidget);
    });

    testWidgets('allowing the permission in the dialog sends the position; a driver who already allowed is not asked again', (t) async {
      final loc = FakeLocation(granted: false, grantOnRequest: true);
      final api = await open(t, review(), loc: loc);
      await tapKey(t, const Key('route-optimize'));
      expect(loc.permissionRequests, 1);
      expect(api.calls.where((c) => c.startsWith('optimize')), ['optimize:24.7,46.7']);
      await t.pumpWidget(const SizedBox());
      final loc2 = FakeLocation();
      final api2 = await open(t, review(), loc: loc2);
      await tapKey(t, const Key('route-optimize'));
      expect(loc2.permissionRequests, 0);
      expect(api2.calls.where((c) => c.startsWith('optimize')), ['optimize:24.7,46.7']);
      expect(find.textContaining('Your location was not available'), findsNothing);
    });

    testWidgets('loading state: the button is disabled with a spinner and every other route action waits; two quick taps send one request', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await open(t, review(), api: api);
      await show(t, const Key('route-optimize'));
      await t.tap(find.byKey(const Key('route-optimize')));
      await t.tap(find.byKey(const Key('route-optimize'))); // no frame in between: the handler itself must refuse
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      expect(api.calls.where((c) => c.startsWith('optimize')).length, 1);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('route-optimize'))).onPressed, isNull);
      expect(find.descendant(of: find.byKey(const Key('route-optimize')), matching: find.byType(CircularProgressIndicator)), findsOneWidget);
      await show(t, const Key('approve-route'));
      expect(t.widget<FilledButton>(find.byKey(const Key('approve-route'))).onPressed, isNull, reason: 'cannot approve a route that is being re-planned');
      api.gate!.complete();
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('optimize')).length, 1);
      expect(find.descendant(of: find.byKey(const Key('route-optimize')), matching: find.byType(CircularProgressIndicator)), findsNothing);
      expect(t.widget<FilledButton>(find.byKey(const Key('approve-route'))).onPressed, isNotNull);
    });

    testWidgets('429 RATE_LIMITED: says to wait and try again; nothing is refreshed', (t) async {
      final api = FakeApi()..errorOnNext = ApiException('RATE_LIMITED', 'x', status: 429);
      await open(t, review(), api: api);
      final reads = api.jobFetches;
      await tapKey(t, const Key('route-optimize'));
      expect(find.text('This route has been re-optimised too many times. Wait a while, then try again.'), findsOneWidget);
      expect(api.jobFetches, reads);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('route-optimize'))).onPressed, isNotNull);
    });

    testWidgets('409 CONFLICT (parcels changed meanwhile): retry hint, and the job is re-read to show what changed', (t) async {
      final api = FakeApi()..errorOnNext = ApiException('CONFLICT', 'x', status: 409);
      await open(t, review(), api: api);
      final reads = api.jobFetches;
      await tapKey(t, const Key('route-optimize'));
      expect(find.text('The parcels changed while the route was being planned. Try again in a moment.'), findsOneWidget);
      expect(api.jobFetches, greaterThan(reads));
    });

    testWidgets('other failures go through the app-wide mapper (offline, 409 INVALID_TRANSITION, unknown code)', (t) async {
      for (final (e, msg) in [
        (ApiException('NETWORK', 'x'), 'No internet connection. Check your signal and try again.'),
        (ApiException('TIMEOUT', 'x'), 'The network is too slow right now. Try again.'),
        (ApiException('INVALID_TRANSITION', 'x', status: 409), "That action isn't available in the current state."),
        (ApiException('SOMETHING_NEW', 'raw english'), 'Something went wrong (code SOMETHING_NEW). Try again.'),
      ]) {
        final api = FakeApi()..errorOnNext = e;
        await open(t, review(), api: api);
        await tapKey(t, const Key('route-optimize'));
        expect(find.text(msg), findsOneWidget, reason: e.code);
        expect(find.textContaining('raw english'), findsNothing);
        await t.pumpWidget(const SizedBox());
      }
    });

    testWidgets('while working: re-optimising refreshes the stops; the stop being served stays the current one', (t) async {
      final api = FakeApi()..jobAfterOptimize = working(stops: [mkLegStop(1, current: true), mkLegStop(3), mkLegStop(2)]);
      await open(t, working(), api: api);
      await tapKey(t, const Key('route-optimize'));
      expect(api.calls.where((c) => c.startsWith('optimize')), ['optimize:24.7,46.7']);
      expect(find.byKey(const Key('current-stop')), findsOneWidget);
      expect(find.text('Stop 1 of 3'), findsOneWidget);
      await show(t, const Key('upcoming'));
      final rows = find.descendant(of: find.byKey(const Key('upcoming')), matching: find.textContaining('Street '));
      expect(rows.evaluate().map((e) => (e.widget as Text).data), ['Street 3, Riyadh · Riyadh', 'Street 2, Riyadh · Riyadh']);
    });

    testWidgets('while working: when the plan moves another stop to the front, the new current stop gets its own card', (t) async {
      final api = FakeApi()..jobAfterOptimize = working(stops: [mkLegStop(1), mkLegStop(2, current: true), mkLegStop(3)]);
      await open(t, working(), api: api);
      expect(find.text('Recipient 1'), findsOneWidget);
      await tapKey(t, const Key('route-optimize'));
      await show(t, const Key('stop-recipient'));
      expect(find.text('Recipient 2'), findsOneWidget);
      expect(find.text('Recipient 1'), findsNothing);
    });
  });

  group('Open route in Google Maps', () {
    testWidgets('opens a directions link: next stops in order, last one is the destination, "|" encoded, no origin, driving', (t) async {
      final links = FakeLinks();
      await open(t, review(), links: links);
      expect(find.text('Opens Google Maps with your next stops in this order, starting from where you are.'), findsOneWidget);
      await tapKey(t, const Key('route-open-maps'));
      final u = links.opened.single;
      expect('${u.scheme}://${u.host}${u.path}', 'https://www.google.com/maps/dir/');
      expect(u.queryParameters['destination'], '24.730000,46.630000');
      expect(u.queryParameters['waypoints'], '24.710000,46.610000|24.720000,46.620000');
      expect(u.queryParameters['travelmode'], 'driving');
      expect(u.queryParameters.containsKey('origin'), isFalse);
      expect(u.toString(), contains('%7C'));
    });

    testWidgets('while working it starts from the current stop and skips what is done', (t) async {
      final links = FakeLinks();
      await open(t, working(stops: [mkLegStop(1)..['status'] = 'delivered', mkLegStop(2, current: true), mkLegStop(3), mkLegStop(4)]), links: links);
      await tapKey(t, const Key('route-open-maps'));
      final u = links.opened.single;
      expect(u.queryParameters['waypoints'], '24.720000,46.620000|24.730000,46.630000');
      expect(u.queryParameters['destination'], '24.740000,46.640000');
    });

    testWidgets('more than 9 remaining: opens the next 9 and says so', (t) async {
      final links = FakeLinks();
      await open(t, review(stops: [for (var n = 1; n <= 12; n++) mkLegStop(n)]), links: links);
      expect(find.text('Opens the next 9 of your 12 remaining stops. Open it again later for the rest.'), findsOneWidget);
      await tapKey(t, const Key('route-open-maps'));
      expect(links.opened.single.queryParameters['waypoints']!.split('|').length, 8);
      expect(links.opened.single.queryParameters['destination'], '24.790000,46.690000');
    });

    testWidgets('stops without a map position are left out, and the card says how many', (t) async {
      final links = FakeLinks();
      await open(t, review(stops: [mkLegStop(1), mkStop(2, extra: {'located': false}), mkLegStop(3)]), links: links);
      expect(textOf(t, const Key('route-maps-skipped')), '1 stop(s) without a map location are left out.');
      await tapKey(t, const Key('route-open-maps'));
      expect(links.opened.single.queryParameters['waypoints'], '24.710000,46.610000');
      expect(links.opened.single.queryParameters['destination'], '24.730000,46.630000');
    });

    testWidgets('no stop with a position: the button is disabled and the card explains why', (t) async {
      final links = FakeLinks();
      await open(t, review(stops: [mkStop(1, extra: {'located': false}), mkStop(2, extra: {'located': false})]), links: links);
      await show(t, const Key('route-open-maps'));
      expect(t.widget<OutlinedButton>(find.byKey(const Key('route-open-maps'))).onPressed, isNull);
      expect(find.text('None of the remaining stops has a map location, so there is nothing to open.'), findsOneWidget);
      expect(links.opened, isEmpty);
    });

    testWidgets('a phone that cannot open the link says so', (t) async {
      final links = FakeLinks()..succeed = false;
      await open(t, review(), links: links);
      await tapKey(t, const Key('route-open-maps'));
      expect(find.text("Couldn't open the maps app."), findsOneWidget);
    });
  });

  group('languages and text size', () {
    testWidgets('Arabic: RTL summary with Arabic labels, units and warnings; digits stay Latin', (t) async {
      await open(t, review(route: mkRoute(provider: 'mixed', warnings: ['ROUTE_UNLOCATED_STOPS:2', 'ROUTING_PROVIDER_FAILED: HTTP 503']), stops: [mkLegStop(1), mkStop(2, extra: {'located': false}), mkLegStop(3, geoSource: 'geocoded_approx')]), lang: 'ar');
      expect(Directionality.of(t.element(find.byType(JobDetailScreen))), TextDirection.rtl);
      expect(find.text('ملخص المسار'), findsOneWidget);
      expect(textOf(t, const Key('route-provider')), 'أفضل مسار من Google (جزء منه تقديري)');
      expect(allText(t, const Key('route-distance')), 'المسافة | 24.3 كم');
      expect(allText(t, const Key('route-time')), 'زمن القيادة | 1 س 52 د');
      expect(find.textContaining('خُطِّط المسار الساعة 09:20'), findsOneWidget);
      expect(find.text('إعادة تحسين المسار'), findsOneWidget);
      expect(find.text('فتح المسار في خرائط Google'), findsOneWidget);
      expect(textOf(t, const Key('leg-s1')), '≈ 12 د · 4.2 كم من نقطة الانطلاق');
      expect(find.text('لا يوجد موقع على الخريطة'), findsOneWidget);
      expect(find.text('موقع تقريبي'), findsOneWidget);
      expect(find.textContaining('2 نقطة تسليم بلا موقع'), findsOneWidget);
      expect(find.textContaining('503'), findsNothing);
    });

    testWidgets('Urdu: translated summary, re-optimise result and Maps hint', (t) async {
      final loc = FakeLocation(granted: false);
      await open(t, review(), lang: 'ur', loc: loc);
      expect(find.text('روٹ کا خلاصہ'), findsOneWidget);
      expect(textOf(t, const Key('route-provider')), 'گوگل کا بہترین راستہ');
      expect(allText(t, const Key('route-distance')), 'فاصلہ | 24.3 کلومیٹر');
      await tapKey(t, const Key('route-optimize'));
      expect(find.textContaining('روٹ اپ ڈیٹ ہو گیا'), findsOneWidget);
    });

    for (final lang in ['en', 'ar', 'ur']) {
      testWidgets('$lang at 1.4x text on a 320 dp phone: summary with notice, warnings, badges and long legs does not overflow (review and working)', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final route = mkRoute(provider: 'mixed', warnings: ['ROUTE_UNLOCATED_STOPS:2', 'ROUTING_PROVIDER_FAILED: x', 'ROUTE_APPROXIMATE_LOCATIONS:1', 'NEW_THING'], extra: {'totalDistanceM': 124300, 'totalDurationS': 36720});
        final stops = [mkLegStop(1, legM: 124300, legS: 36720), mkStop(2, extra: {'located': false, 'legDistanceM': 1800, 'legDurationS': 300}), mkLegStop(3, geoSource: 'geocoded_approx')];
        final api = FakeApi()..jobResult = review(route: route, stops: stops, extra: {'notes': 'Gate 2'});
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        t.view.devicePixelRatio = 2;
        await settle(t);
        expect(t.takeException(), isNull);
        await show(t, const Key('route-optimize'));
        await show(t, const Key('route-open-maps'));
        await show(t, const Key('approve-route'));
        for (var i = 0; i < 12; i++) { await t.drag(find.byType(Scrollable).first, const Offset(0, -400)); await t.pump(); }
        expect(t.takeException(), isNull);
        api.jobResult = working(route: route, stops: [mkLegStop(1, current: true, legM: 124300, legS: 36720), mkStop(2, extra: {'located': false}), mkLegStop(3, geoSource: 'geocoded_approx')]);
        await t.pumpWidget(const SizedBox());
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        t.view.devicePixelRatio = 2;
        await settle(t);
        await show(t, const Key('route-summary'));
        await show(t, const Key('route-open-maps'));
        await show(t, const Key('upcoming'));
        expect(t.takeException(), isNull);
        for (var i = 0; i < 12; i++) { await t.drag(find.byType(Scrollable).first, const Offset(0, -400)); await t.pump(); } // the rest of the page too (details card, custody, buttons)
        expect(t.takeException(), isNull);
      });
    }
  });
}
