import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, String> loadDict(String code) => (jsonDecode(File('assets/i18n/$code.json').readAsStringSync()) as Map<String, dynamic>).map((k, v) => MapEntry(k, v as String));
Strings strings(String code) => Strings.fromMaps(code, code == 'en' ? loadDict('en') : loadDict(code), loadDict('en'));

/// A DriverApi whose network calls are replaced by in-memory fakes.
class FakeApi extends DriverApi {
  FakeApi() : super(ApiClient(baseUrl: 'http://fake', tokens: MemoryTokenStore()));
  final calls = <String>[];
  Job? jobResult;
  List<Job> activeJobs = [];
  List<Job> offerList = [];
  Overview overviewResult = Overview({'availability': 'unavailable', 'verificationStatus': 'verified', 'newOffers': 0, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': false, 'wallet': {'availableCents': 12500, 'heldCents': 0, 'pendingCents': 4000}});
  Json waResult = {'url': 'https://wa.me/966555555555?text=hi', 'text': 'hi'};
  Object? errorOnNext;
  RoutePlan? plan;

  void _maybeThrow() { final e = errorOnNext; if (e != null) { errorOnNext = null; throw e; } }

  @override
  Future<Overview> overview() async => overviewResult;
  @override
  Future<List<Job>> offers() async => offerList;
  @override
  Future<List<Job>> jobs({required bool active}) async => active ? activeJobs : [];
  @override
  Future<Job> job(String offerId) async => jobResult!;
  @override
  Future<Json> catalog() async => {'terms': {'driver': ''}, 'policy': {'cancelPolicyEnabled': true, 'cancelWarnAt': 2, 'cancelSuspendAt': 4, 'cancelWindowDays': 7, 'cancelSuspendDays': 3}, 'cities': [], 'vehicleTypes': [], 'services': [], 'documents': {'driver': []}};
  @override
  Future<Json> wallet() async => {'availableCents': 12500, 'heldCents': 0, 'reservedCents': 0, 'entries': []};
  @override
  Future<List<Json>> withdrawals() async => [];
  @override
  Future<Json> sendOtp(String phone) async { calls.add('sendOtp:$phone'); _maybeThrow(); return {'sent': true, 'demoCode': '123456'}; }
  @override
  Future<Json> verifyOtp(String phone, String code) async { calls.add('verifyOtp:$code'); _maybeThrow(); return {'isNew': false, 'token': 'tok', 'user': {'id': 'u1', 'role': 'driver', 'name': 'Omar Test', 'phone': phone, 'language': 'en'}}; }
  @override
  Future<void> checkIn(String offerId, {double? lat, double? lng}) async { calls.add('checkIn:$lat,$lng'); _maybeThrow(); }
  @override
  Future<void> ackLoading(String offerId, bool ok, {String? note}) async { calls.add('ack:$ok'); }
  @override
  Future<void> delivered(String offerId, int units) async { calls.add('delivered:$units'); _maybeThrow(); }
  @override
  Future<Json> accept(String offerId) async { calls.add('accept:$offerId'); _maybeThrow(); return {'id': offerId}; }
  @override
  Future<Json> cancel(String offerId, String reason) async { calls.add('cancel:$reason'); return {}; }
  @override
  Future<Json> whatsapp(String offerId, String kind, String lang) async { calls.add('wa:$kind:$lang'); _maybeThrow(); return waResult; }
  @override
  Future<void> setAvailability(bool on) async { calls.add('avail:$on'); overviewResult = Overview({...overviewResult.j, 'availability': on ? 'available' : 'unavailable'}); }
  @override
  Future<void> clearLocation() async { calls.add('clearLocation'); }
  @override
  Future<void> sendLocation(double lat, double lng) async { calls.add('loc'); }
  @override
  Future<RoutePlan> optimizeRoute(double lat, double lng, List<String> ids) async { calls.add('route:${ids.length}'); return plan!; }
  @override
  Future<List<Map<String, dynamic>>> messages(String offerId) async => [];
  @override
  Future<List<Map<String, dynamic>>> opportunities() async => [];
  @override
  Future<Json> invites() async => {'items': []};
  @override
  Future<Json> notifications() async => {'items': [], 'unread': 0};
}

class FakeLinks implements LinkOpener {
  final opened = <Uri>[];
  final called = <String>[];
  bool succeed = true;
  @override
  Future<bool> open(Uri uri) async { opened.add(uri); return succeed; }
  @override
  Future<bool> call(String phone) async { called.add(phone); return succeed; }
}

class FakeLocation implements LocationService {
  FakeLocation({this.granted = true, this.pos = const (lat: 24.7, lng: 46.7)});
  bool granted;
  LatLng? pos;
  @override
  Future<bool> hasPermission() async => granted;
  @override
  Future<bool> requestPermission() async => granted;
  @override
  Future<LatLng?> current() async => granted ? pos : null;
}

Job mkJob({String status = 'accepted', String service = 'delivery_driver', List<String>? actions, Json? extra}) => Job({
      'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'service': service, 'status': status, 'requestStatus': 'assigned', 'isReplacement': false, 'business': 'Nakheel Fresh Foods',
      'vehicleType': 'sedan', 'temperature': null, 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'startsAt': '2026-12-01T06:00:00.000Z', 'durationDays': 1, 'expectedUnits': 20,
      'shipmentsPerDriver': 20, 'expectedEarningCents': 11000, 'earningHidden': false, 'notes': null, 'contents': 'Groceries',
      'pickup': {'address': 'Olaya St', 'lat': null, 'lng': null}, 'delivery': {'address': 'King Fahd Rd 120', 'lat': 24.7, 'lng': 46.7},
      'recipient': {'name': 'Mona', 'phone': '+966555555555'}, 'loadedUnits': null, 'loadedAckByDriver': null, 'deliveredUnits': null, 'finalUnits': null, 'actions': actions ?? ['checkin', 'cancel'], ...?extra,
    });

/// Pumps [child] inside a themed, localized shell with the real dictionaries.
Future<void> pumpScreen(WidgetTester t, Widget child, {String lang = 'en', required FakeApi api, FakeLinks? links, FakeLocation? location, List<Override> extra = const []}) async {
  SharedPreferences.setMockInitialValues({'lang': lang});
  final prefs = await SharedPreferences.getInstance();
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(ProviderScope(
    overrides: [
      prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
      linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(location ?? FakeLocation()), ...extra,
    ],
    child: MaterialApp(
      theme: buildTheme(), locale: Locale(lang),
      builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: w!)),
      home: child,
    ),
  ));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}

/// Same as [pumpScreen] but inside a GoRouter, for screens that navigate (e.g. after accepting a job).
Future<void> pumpRouted(WidgetTester t, Widget child, {String lang = 'en', required FakeApi api, FakeLinks? links}) async {
  SharedPreferences.setMockInitialValues({'lang': lang});
  final prefs = await SharedPreferences.getInstance();
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  final router = GoRouter(routes: [GoRoute(path: '/', builder: (_, _) => child), GoRoute(path: '/job/:id', builder: (_, s) => Scaffold(body: Center(child: Text('JOB-PAGE-${s.pathParameters['id']}'))))]);
  await t.pumpWidget(ProviderScope(
    overrides: [prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore()), linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation())],
    child: MaterialApp.router(
      theme: buildTheme(), locale: Locale(lang), routerConfig: router,
      builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: w!)),
    ),
  ));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}
