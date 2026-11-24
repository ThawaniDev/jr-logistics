import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/app.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/providers_extra.dart';
import 'package:jr_driver/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'helpers.dart';
import 'helpers_extra.dart';

/// Test doubles and pumping helpers for the Update-L mobile features (update page, legal gate, privacy, cash risk, SMS off, support contact).

/// An API error with a code and a status (like the server's envelope after the client parsed it).
ApiException apiErr(String code, int status, [Map<String, dynamic> details = const {}]) => ApiException(code, 'x', status: status, details: details);

/// The whole app (real router, real auth notifier and update gate) with the fakes of every service. [token] = a session is already stored.
Future<ProviderContainer> pumpFullApp(
  WidgetTester t, {
  required FakeApi api, bool token = true, String lang = 'en', FakeLegalApi? legal, FakePrivacyRepo? privacy, FakeSharer? sharer, FakeLinks? links, FakeExtraApi? extra, Map<String, Object> prefs = const {}, Size size = const Size(900, 1900),
}) async {
  SharedPreferences.setMockInitialValues({'lang': lang, 'theme': testBrightness.name, installMarkerKey: '1', ...prefs});
  final p = await SharedPreferences.getInstance();
  final store = MemoryTokenStore();
  if (token) await store.write('tok');
  t.view.physicalSize = size;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [
      prefsProvider.overrideWithValue(p), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(store),
      stringsProvider.overrideWith((ref) async => strings(ref.watch(localeProvider))), linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation()),
      legalApiProvider.overrideWithValue(legal ?? FakeLegalApi()), privacyRepoProvider.overrideWithValue(privacy ?? FakePrivacyRepo()), fileSharerProvider.overrideWithValue(sharer ?? FakeSharer()),
      ...extraOverrides(api: extra ?? FakeExtraApi(), notifier: FakeNotifier(permission: true)),
    ],
    child: const JrApp(),
  ));
  for (var i = 0; i < 6; i++) { await t.pump(const Duration(milliseconds: 200)); }
  return ProviderScope.containerOf(t.element(find.byType(JrApp)));
}

/// A `FakeApi` whose `/auth/me` carries `legal.pending`.
class MeApi extends FakeApi {
  MeApi({this.pending = const []});
  List<Json> pending;
  int meCalls = 0;
  @override
  Future<Json> me() async { meCalls++; if (meError != null) throw meError!; return {'user': (meResult['user'] as Map).cast<String, dynamic>(), 'legal': {'pending': pending}}; }
}

Json pendingTerms({String version = '2.0', String? note = 'Cash must be handed over within 3 days'}) => {'kind': 'terms_driver', 'version': version, 'title': 'Driver terms', 'effectiveAt': '2026-11-01T00:00:00.000Z', 'changeNote': note, 'path': '/terms/driver'};
Json pendingPrivacy({String version = '1.1'}) => {'kind': 'privacy', 'version': version, 'title': 'Privacy policy', 'effectiveAt': '2026-11-01T00:00:00.000Z', 'changeNote': null, 'path': '/privacy'};

/// The `cash` block of the overview.
Json mkCashRisk({String state = 'warn', bool blocks = false, String? reason, int outstanding = 240000, int limit = 300000, int lien = 0, int overdue = 0, int days = 1, int maxDays = 3, int orders = 2, int? pct}) => {
      'outstandingCents': outstanding, 'orders': orders, 'enabled': true, 'limitCents': limit, 'warnPct': 80, 'maxDays': maxDays, 'pct': pct ?? (limit == 0 ? null : (outstanding * 100 / limit).round()),
      'oldestDays': days, 'oldestAt': '2026-11-20T08:00:00.000Z', 'overdueCents': overdue, 'state': state, 'blocksOffers': blocks, 'reason': reason, 'lienCents': lien,
    };
