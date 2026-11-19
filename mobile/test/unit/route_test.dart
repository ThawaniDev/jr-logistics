import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/format.dart';
import 'package:jr_driver/core/maps.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/route_widgets.dart';
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

ResponseBody _json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

Stop _stop(int n, {String status = 'loaded', double? lat, double? lng, Json? extra}) => Stop(mkStop(n, status: status, extra: {'lat': lat, 'lng': lng, ...?extra}));

void main() {
  group('RoutePlanInfo / Job.route', () {
    test('parses the server contract', () {
      final job = mkManifestJob(extra: {
        'route': mkRoute(warnings: ['ROUTE_UNLOCATED_STOPS:3', 'ROUTING_PROVIDER_FAILED: Google Routes HTTP 503'], extra: {'chunks': 2, 'unlocated': 3, 'approximate': 1, 'by': 'driver'}),
      });
      final r = job.route!;
      expect(r.planned, isTrue);
      expect(r.provider, 'google_routes');
      expect(r.isGoogle, isTrue);
      expect(r.plannedAt, '2026-12-01T06:20:00.000Z');
      expect(r.by, 'driver');
      expect((r.totalDistanceM, r.totalDurationS, r.remainingDistanceM, r.remainingDurationS), (24300, 6720, 12000, 3100));
      expect((r.chunks, r.unlocated, r.approximate), (2, 3, 1));
      expect(r.googleConfigured, isTrue);
      expect(r.canOptimize, isTrue);
      expect(r.warnings.map((w) => w.code), ['ROUTE_UNLOCATED_STOPS', 'ROUTING_PROVIDER_FAILED']);
      expect(r.warnings.first.count, 3);
    });

    test('a missing, null or malformed route never throws: legacy jobs have none, odd fields degrade to defaults', () {
      expect(mkJob().route, isNull, reason: 'legacy / older server');
      expect(mkManifestJob(extra: {'route': null}).route, isNull);
      expect(mkManifestJob(extra: {'route': 'broken'}).route, isNull);
      final empty = mkManifestJob(extra: {'route': <String, dynamic>{}}).route!;
      expect((empty.planned, empty.provider, empty.plannedAt, empty.by, empty.totalDistanceM, empty.remainingDurationS), (false, null, null, null, null, null));
      expect((empty.chunks, empty.unlocated, empty.approximate, empty.googleConfigured, empty.canOptimize, empty.isGoogle), (0, 0, 0, false, false, false));
      expect(empty.warnings, isEmpty);
      final odd = mkManifestJob(extra: {'route': {'planned': 'yes', 'provider': 7, 'totalDistanceM': '1500', 'totalDurationS': 12.7, 'remainingDistanceM': null, 'warnings': 'nope', 'canOptimize': 1, 'chunks': 'two'}}).route!;
      expect(odd.planned, isFalse, reason: 'only a real boolean true counts');
      expect(odd.provider, '7');
      expect(odd.totalDistanceM, 1500);
      expect(odd.totalDurationS, 12);
      expect(odd.remainingDistanceM, isNull);
      expect(odd.warnings, isEmpty);
      expect(odd.canOptimize, isFalse);
      expect(odd.chunks, 0);
      expect(mkManifestJob(extra: {'route': {'warnings': ['OK', 3, null, '  ', 'ROUTE_NO_ORIGIN']}}).route!.warnings.map((w) => w.code), ['OK', 'ROUTE_NO_ORIGIN']);
    });

    test('RouteWarning splits CODE and CODE:param on the first colon only', () {
      var w = RouteWarning.parse('ROUTE_UNLOCATED_STOPS:3');
      expect((w.code, w.param, w.count), ('ROUTE_UNLOCATED_STOPS', '3', 3));
      w = RouteWarning.parse('ROUTE_NO_ORIGIN');
      expect((w.code, w.param, w.count), ('ROUTE_NO_ORIGIN', null, null));
      w = RouteWarning.parse('ROUTING_PROVIDER_FAILED: Google Routes HTTP 503: upstream');
      expect((w.code, w.param, w.count), ('ROUTING_PROVIDER_FAILED', 'Google Routes HTTP 503: upstream', null));
      w = RouteWarning.parse('  ROUTE_X : ');
      expect((w.code, w.param), ('ROUTE_X', null));
    });
  });

  group('Stop — route fields', () {
    test('located, geoSource and the driving leg', () {
      final s = Stop(mkLegStop(2, geoSource: 'geocoded_approx', legM: 4200, legS: 720));
      expect((s.located, s.geoSource, s.approximate, s.legDistanceM, s.legDurationS, s.hasLeg), (true, 'geocoded_approx', true, 4200, 720, true));
      final plain = Stop(mkLegStop(3));
      expect((plain.approximate, plain.geoSource), (false, 'given'));
    });
    test('located:false is honoured; without the key it falls back to "has coordinates" (older servers)', () {
      expect(Stop(mkStop(1, extra: {'located': false, 'lat': null, 'lng': null})).located, isFalse);
      expect(Stop(mkStop(1, extra: {'lat': 24.7, 'lng': 46.7})).located, isTrue, reason: 'no `located` key, has a position');
      expect(Stop(mkStop(1)).located, isFalse, reason: 'no `located` key, no position');
    });
    test('no leg, a zero leg and string numbers are all tolerated', () {
      expect(Stop(mkStop(1)).hasLeg, isFalse);
      expect(Stop(mkStop(1, extra: {'legDistanceM': 0, 'legDurationS': 0})).hasLeg, isFalse);
      final s = Stop(mkStop(1, extra: {'legDistanceM': '900', 'legDurationS': null}));
      expect((s.legDistanceM, s.legDurationS, s.hasLeg), (900, null, true));
    });
  });

  group('RouteOptimizeResult and DriverApi.optimizeRoute', () {
    test('parses plan / cached / changed / currentId / fresh job', () {
      final r = RouteOptimizeResult({'plan': {'provider': 'google_routes'}, 'cached': true, 'changed': false, 'currentId': 's2', 'job': mkManifestJob(extra: {'route': mkRoute()}).j});
      expect((r.cached, r.changed, r.currentId), (true, false, 's2'));
      expect(r.plan!['provider'], 'google_routes');
      expect(r.job!.route!.planned, isTrue);
      final bare = RouteOptimizeResult(const {});
      expect((bare.cached, bare.changed, bare.currentId, bare.plan, bare.job), (false, false, null, null, null));
    });

    DriverApi apiWith(_Adapter a) => DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a));

    test('POSTs /offers/:id/route/optimize with the GPS origin (both or neither), waits longer than a normal request, and decodes the answer', () async {
      final a = _Adapter((o) => _json(200, {'plan': {}, 'cached': false, 'changed': true, 'currentId': 's1', 'job': mkManifestJob().j}));
      final api = apiWith(a);
      final r = await api.optimizeRoute('o1', lat: 24.7, lng: 46.7);
      expect(a.last!.method, 'POST');
      expect(a.last!.path, '/offers/o1/route/optimize');
      expect(a.last!.data, {'lat': 24.7, 'lng': 46.7});
      expect(a.last!.receiveTimeout, const Duration(seconds: 60));
      expect((r.changed, r.currentId, r.job!.offerId), (true, 's1', 'o1'));
      await api.optimizeRoute('o1');
      expect(a.last!.data, <String, dynamic>{}, reason: 'no GPS: no coordinates at all');
      await api.optimizeRoute('o1', lat: 24.7);
      expect(a.last!.data, <String, dynamic>{}, reason: 'a lone latitude is never sent');
    });

    test('429 and 409 surface as typed errors (RATE_LIMITED / CONFLICT)', () async {
      for (final code in ['RATE_LIMITED', 'CONFLICT']) {
        final a = _Adapter((o) => _json(code == 'RATE_LIMITED' ? 429 : 409, {'error': {'code': code, 'message': 'x'}}));
        await expectLater(apiWith(a).optimizeRoute('o1'), throwsA(isA<ApiException>().having((e) => e.code, 'code', code)));
      }
    });
  });

  group('googleMapsRoute — "Open route in Google Maps"', () {
    Stop located(int n, {String status = 'loaded'}) => _stop(n, status: status, lat: 24.0 + n / 100, lng: 46.0 + n / 100);

    test('destination is the last stop, the earlier ones are waypoints joined by an encoded "|", origin is omitted, mode is driving', () {
      final r = googleMapsRoute([located(1), located(2), located(3)])!;
      expect('${r.uri.scheme}://${r.uri.host}${r.uri.path}', 'https://www.google.com/maps/dir/');
      expect(r.uri.queryParameters, {'api': '1', 'destination': '24.030000,46.030000', 'waypoints': '24.010000,46.010000|24.020000,46.020000', 'travelmode': 'driving'});
      expect(r.uri.toString(), contains('waypoints=24.010000,46.010000%7C24.020000,46.020000'));
      expect(r.uri.toString(), isNot(contains('|')));
      expect(r.uri.queryParameters.containsKey('origin'), isFalse);
      expect((r.shown, r.located, r.skipped), (3, 3, 0));
    });

    test('a single remaining stop is just a destination (no waypoints parameter)', () {
      final r = googleMapsRoute([located(5)])!;
      expect(r.uri.queryParameters.containsKey('waypoints'), isFalse);
      expect(r.uri.queryParameters['destination'], '24.050000,46.050000');
      expect(r.shown, 1);
    });

    test('at most 9 stops (8 waypoints + destination): the NEXT 9 in route order, and it says how many were left', () {
      final stops = [for (var n = 1; n <= 14; n++) located(n)];
      final r = googleMapsRoute(stops)!;
      final wp = r.uri.queryParameters['waypoints']!.split('|');
      expect(wp.length, 8);
      expect(wp.first, '24.010000,46.010000');
      expect(r.uri.queryParameters['destination'], '24.090000,46.090000');
      expect((r.shown, r.located), (9, 14));
      expect(googleMapsRoute(stops.take(9))!.shown, 9);
      expect(googleMapsRoute(stops.take(9))!.located, 9);
    });

    test('skips stops without coordinates (and bad coordinates) and stops that are already done — counting the skipped ones', () {
      final r = googleMapsRoute([
        located(1, status: 'delivered'), // done: not part of the route any more
        _stop(2), // no position
        located(3),
        _stop(4, lat: 999, lng: 46.0), // not a coordinate
        _stop(5, lat: double.nan, lng: 46.0),
        located(6),
        located(7, status: 'failed'),
      ])!;
      expect(r.uri.queryParameters['waypoints'], '24.030000,46.030000');
      expect(r.uri.queryParameters['destination'], '24.060000,46.060000');
      expect((r.shown, r.located, r.skipped), (2, 2, 3));
    });

    test('nothing to open when no remaining stop has a position', () {
      expect(googleMapsRoute([_stop(1), _stop(2)]), isNull);
      expect(googleMapsRoute([located(1, status: 'delivered')]), isNull);
      expect(googleMapsRoute(const []), isNull);
    });
  });

  group('distance and time formatting (Latin digits, units from the dictionary)', () {
    test('English, Arabic and Urdu', () {
      final en = strings('en'), ar = strings('ar'), ur = strings('ur');
      expect(fmtDist(en, 4200), '4.2 km');
      expect(fmtDist(en, 960), '1.0 km');
      expect(fmtDist(en, 400), '0.4 km');
      expect(fmtDist(en, 150000), '150 km');
      expect(fmtDist(ar, 4200), '4.2 كم');
      expect(fmtDist(ur, 24300), '24.3 کلومیٹر');
      expect(fmtTravel(en, 720), '12 min');
      expect(fmtTravel(en, 6720), '1 h 52 min');
      expect(fmtTravel(en, 7200), '2 h');
      expect(fmtTravel(en, 3590), '1 h', reason: 'rounds to a whole minute first: 59.8 min is 1 h, not 60 min');
      expect(fmtTravel(en, 20), '1 min', reason: 'a real leg is never "0 min"');
      expect(fmtTravel(en, 0), '0 min');
      expect(fmtTravel(ar, 6720), '1 س 52 د');
      expect(fmtTravel(ur, 720), '12 منٹ');
      for (final s in [fmtDist(ar, 12345), fmtTravel(ar, 5400), fmtDist(ur, 12345), fmtTravel(ur, 5400)]) {
        expect(RegExp(r'[٠-٩۰-۹]').hasMatch(s), isFalse, reason: 'Latin digits only: $s');
      }
    });
  });

  group('route warnings are translated by CODE', () {
    final codes = ['ROUTING_PROVIDER_NOT_CONFIGURED', 'ROUTING_PROVIDER_FAILED', 'ROUTE_UNLOCATED_STOPS', 'ROUTE_APPROXIMATE_LOCATIONS', 'ROUTE_NO_ORIGIN', 'ROUTE_GEOCODING_FAILED'];

    test('{n} is the parameter', () {
      final t = strings('en');
      expect(routeWarningText(t, RouteWarning.parse('ROUTE_UNLOCATED_STOPS:3')), '3 stop(s) have no location on the map and are placed last — check their addresses.');
      expect(routeWarningText(t, RouteWarning.parse('ROUTE_APPROXIMATE_LOCATIONS:12')), contains('12 stop(s)'));
      expect(routeWarningText(strings('ar'), RouteWarning.parse('ROUTE_UNLOCATED_STOPS:3')), contains('3 نقطة'));
      expect(routeWarningText(strings('ur'), RouteWarning.parse('ROUTE_UNLOCATED_STOPS:3')), contains('3 اسٹاپ'));
    });

    test('the provider detail after the colon of ROUTING_PROVIDER_FAILED is never shown', () {
      for (final lang in ['en', 'ar', 'ur']) {
        final text = routeWarningText(strings(lang), RouteWarning.parse('ROUTING_PROVIDER_FAILED: Google Routes HTTP 503 key=AIza-secret'));
        expect(text, strings(lang)('route.warn.ROUTING_PROVIDER_FAILED'));
        expect(text, isNot(contains('503')));
        expect(text, isNot(contains('AIza')));
      }
    });

    test('an unknown code, or a counted code without a number, falls back to the generic line (with the code, never raw text)', () {
      final t = strings('en');
      expect(routeWarningText(t, RouteWarning.parse('SOME_NEW_CODE:5')), 'The route planner left a note that this version of the app cannot show (SOME_NEW_CODE).');
      expect(routeWarningText(t, RouteWarning.parse('ROUTE_UNLOCATED_STOPS')), contains('(ROUTE_UNLOCATED_STOPS)'), reason: 'this code needs a number and none came');
      expect(routeWarningText(t, RouteWarning.parse('ROUTE_UNLOCATED_STOPS:many')), contains('(ROUTE_UNLOCATED_STOPS)'));
      expect(routeWarningText(t, RouteWarning.parse('weird <script> code')), contains('(?)'), reason: 'a code that is not an UPPER_SNAKE token is not echoed');
      expect(routeWarningText(strings('ar'), RouteWarning.parse('SOME_NEW_CODE')), contains('SOME_NEW_CODE'));
    });

    test('every known code reads as a sentence in all three languages — no raw "route.warn.*" key, no placeholder left over', () {
      for (final lang in ['en', 'ar', 'ur']) {
        for (final c in codes) {
          final text = routeWarningText(strings(lang), RouteWarning.parse('$c:4'));
          expect(text, isNot(startsWith('route.warn')), reason: '$lang $c');
          expect(text, isNot(contains('{')), reason: '$lang $c');
          expect(text.length, greaterThan(15), reason: '$lang $c');
        }
      }
    });
  });

  group('i18n — every rm.* key used by the route UI exists in all three languages', () {
    test('keys, placeholders and provider names', () {
      final en = loadDict('en'), ar = loadDict('ar'), ur = loadDict('ur');
      final keys = en.keys.where((k) => k.startsWith('rm.')).toList();
      expect(keys.length, greaterThan(30));
      String ph(String s) => (RegExp(r'\{(\w+)\}').allMatches(s).map((m) => m[1]!).toList()..sort()).join(',');
      for (final k in keys) {
        expect(ar[k], isNotNull, reason: 'ar $k');
        expect(ur[k], isNotNull, reason: 'ur $k');
        expect(ph(ar[k]!), ph(en[k]!), reason: 'ar placeholders $k');
        expect(ph(ur[k]!), ph(en[k]!), reason: 'ur placeholders $k');
        expect(ar[k], isNot(en[k]), reason: 'ar $k is translated');
      }
      for (final p in ['google_routes', 'local_heuristic', 'mixed']) { for (final d in [en, ar, ur]) { expect(d['route.provider.$p'], isNotNull); } }
    });
  });
}
