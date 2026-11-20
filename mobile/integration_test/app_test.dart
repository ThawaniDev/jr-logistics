import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:jr_driver/core/config.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';
import '../test/integration/live_login.dart';

/// Real end-to-end test: the real app on a real (simulated) device talking to the real Next.js API + Postgres.
/// Run with tool/live_test.sh --e2e
/// A signed-in API client for the seeded demo account with this phone (username + password, see test/integration/live_login.dart).
Future<ApiClient> clientFor(String phone) => signedInClient(AppConfig.baseUrl, phone);

/// Pumps until [f] finds something or [timeout] elapses (real timers drive polling).
Future<void> pumpUntil(WidgetTester t, Finder f, {Duration timeout = const Duration(seconds: 40)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return;
  }
  final texts = find.byType(Text).evaluate().map((e) => (e.widget as Text).data ?? (e.widget as Text).textSpan?.toPlainText() ?? '').where((x) => x.isNotEmpty).take(40).toList();
  final hint = find.byKey(const Key('hint')).evaluate().map((e) => (e.widget as Text).data).toList();
  throw TestFailure('Timed out waiting for $f. hint=$hint Visible texts: $texts');
}

/// Lists build lazily: bring the top of the screen (the next-step card) back into the tree.
Future<void> scrollTop(WidgetTester t) async {
  await t.fling(find.byType(Scrollable).first, const Offset(0, 1500), 3000);
  await t.pump(const Duration(milliseconds: 400));
}

/// Scrolls the widget to the middle of the viewport (not under the app bar / sticky bars) and taps it.
Future<void> tapVisible(WidgetTester t, Finder f) async {
  await t.ensureVisible(f);
  await t.pumpAndSettle(const Duration(milliseconds: 300));
  await Scrollable.ensureVisible(t.element(f), alignment: 0.5);
  await t.pumpAndSettle(const Duration(milliseconds: 300));
  await t.tap(f);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('driver signs in, takes a job and completes it end to end; switches to Arabic RTL', (t) async {
    SharedPreferences.setMockInitialValues({'lang': 'en', 'loc_asked': true});
    await SecureTokenStore().clear();
    final biz = await clientFor('0500000001');
    final driverApi = DriverApi(await clientFor('0500000011'));
    final cred = await demoCredentials(ApiClient(baseUrl: AppConfig.baseUrl, tokens: MemoryTokenStore()), '0500000011'); // what the driver types on the sign-in screen
    await driverApi.updateProfile({'language': 'en'}); // the app syncs the saved profile language on sign-in
    final start = DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String();
    final created = await biz.post('/requests', {
      'service': 'delivery_driver', 'quantity': 1, 'shipmentsPerDriver': 20, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh',
      'pickupAddress': 'Olaya St', 'startsAt': start, 'durationDays': 1, 'publish': true, 'termsAccepted': true,
      // per-parcel delivery: every shipment has its own recipient (one consumer, one business)
      'shipments': [
        {'recipientType': 'consumer', 'recipientName': 'Mona', 'recipientPhone': '0555555555', 'address': 'E2E Delivery Rd 7, Riyadh', 'externalRef': 'E2E-1'},
        {'recipientType': 'business', 'recipientName': 'Layla Store', 'recipientPhone': '0555555556', 'address': 'E2E Market St 9, Riyadh', 'externalRef': 'E2E-2'},
      ],
    });
    final requestId = created['id'] as String;

    app.main();
    await t.pumpAndSettle(const Duration(seconds: 2));

    // ── sign in with username + password (no one-time code) ──
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.byKey(const Key('code')), findsNothing);
    await t.enterText(find.byKey(const Key('username')), cred.username);
    await t.enterText(find.byKey(const Key('password')), 'wrong-${cred.password}');
    await t.pump(); // the button enables once both fields are filled
    await tapVisible(t, find.byKey(const Key('submit')));
    await pumpUntil(t, find.byKey(const Key('login-error')));
    expect(find.text('Wrong username or password. Check them and try again.'), findsOneWidget);
    await t.enterText(find.byKey(const Key('password')), cred.password);
    await t.pump();
    await tapVisible(t, find.byKey(const Key('submit')));
    await pumpUntil(t, find.byKey(const Key('toggle')));
    expect(find.textContaining('Omar'), findsWidgets);

    // ── go online (the demo driver may already be online when this test runs on its own) ──
    if (find.text('Go online').evaluate().isNotEmpty) await t.tap(find.byKey(const Key('toggle')));
    await pumpUntil(t, find.text('Go offline'));

    // ── offers tab → accept with terms ──
    await t.tap(find.text('Offers'));
    await t.pumpAndSettle(const Duration(seconds: 1));
    final accept = find.byWidgetPredicate((w) => w.key is ValueKey && (w.key as ValueKey).value.toString().startsWith('accept-'));
    await pumpUntil(t, accept);
    await t.tap(accept.first);
    await t.pumpAndSettle(const Duration(seconds: 1));
    expect(t.widget<FilledButton>(find.byKey(const Key('confirm-accept'))).onPressed, isNull, reason: 'terms must be accepted first');
    await t.tap(find.byKey(const Key('terms-check')));
    await t.pump();
    await t.tap(find.byKey(const Key('confirm-accept')));
    await pumpUntil(t, find.byKey(const Key('checkin')));

    // per-parcel job: no recipient is shown before the route is approved (privacy), and no single delivery address exists
    expect(find.text('Mona'), findsNothing);
    expect(find.text('Head to the pickup location and tap “I\'ve arrived”.'), findsOneWidget);

    // ── arrive: the check-in is geofenced, so the app reads the GPS (the simulator is set to the demo warehouse) ──
    await tapVisible(t, find.byKey(const Key('checkin')));
    final jobs = await driverApi.jobs(active: true);
    final offerId = jobs.firstWhere((j) => j.requestId == requestId).offerId;
    for (var i = 0; i < 30 && (await driverApi.job(offerId)).status == 'accepted'; i++) { await t.pump(const Duration(seconds: 1)); }
    for (final k in ['checkin-denied', 'checkin-location-required', 'checkin-nofix', 'checkin-too-far', 'checkin-settings', 'checkin']) {
      if (find.byKey(Key(k)).evaluate().isNotEmpty) debugPrint('CHECKIN SCREEN STATE: $k');
    }
    expect((await driverApi.job(offerId)).status, 'arrived', reason: 'a check-in at the warehouse pin is accepted');

    // ── the warehouse confirms attendance; nothing to record — the driver scans the parcels onto the vehicle ──
    await biz.post('/offers/$offerId/attendance', {'present': true});
    await pumpUntil(t, find.byKey(const Key('loading-scan')), timeout: const Duration(seconds: 45));
    final parcels = ((await biz.get('/requests/$requestId/shipments', query: {'pageSize': '200'}))['items'] as List).cast<Map<String, dynamic>>()
      ..sort((a, b) => (a['seq'] as int).compareTo(b['seq'] as int));
    for (final p in parcels) {
      await t.tap(find.byKey(const Key('scan-code')));
      await t.enterText(find.byKey(const Key('scan-code')), p['code'] as String); // typed here; the camera fills the same field
      await t.pump();
      await tapVisible(t, find.byKey(const Key('scan-add')));
      // the field clears only once the server accepted the scan (the button is disabled meanwhile) — wait for that before the next one
      final until = DateTime.now().add(const Duration(seconds: 20));
      while (t.widget<TextField>(find.byKey(const Key('scan-code'))).controller!.text.isNotEmpty && DateTime.now().isBefore(until)) {
        await t.pump(const Duration(milliseconds: 250));
      }
      expect(t.widget<TextField>(find.byKey(const Key('scan-code'))).controller!.text, isEmpty, reason: 'scan of ${p['code']} accepted');
      await t.pumpAndSettle(const Duration(milliseconds: 400));
    }
    expect((await driverApi.job(offerId)).loading.scanned, parcels.length, reason: 'every parcel is scanned before finishing');
    await tapVisible(t, find.byKey(const Key('finish-loading')));
    await t.pumpAndSettle(const Duration(seconds: 1));
    if (find.byKey(const Key('finish-loading-confirm')).evaluate().isNotEmpty) await t.tap(find.byKey(const Key('finish-loading-confirm')));

    // ── review and approve the fixed route (stops are unlocked from here, strictly one at a time) ──
    await pumpUntil(t, find.byKey(const Key('approve-route')));
    expect(find.byKey(const Key('route-stop-1')), findsOneWidget);
    expect(find.text('Mona'), findsNothing, reason: 'names are revealed only for the current stop');
    await tapVisible(t, find.byKey(const Key('approve-route')));
    await pumpUntil(t, find.byKey(const Key('current-stop')));
    expect(find.text('Mona'), findsWidgets);

    // ── stop 1: arrive, then the parcel code and the recipient's one-time code ──
    await tapVisible(t, find.byKey(const Key('arrive')));
    await pumpUntil(t, find.byKey(const Key('deliver-submit')));
    await t.enterText(find.byKey(const Key('parcel-code')), parcels[0]['code'] as String);
    await t.enterText(find.byKey(const Key('otp-code')), parcels[0]['demoOtp'] as String);
    await t.pumpAndSettle(const Duration(milliseconds: 500));
    expect(t.widget<TextField>(find.byKey(const Key('parcel-code'))).controller!.text, parcels[0]['code']);
    expect(t.widget<FilledButton>(find.byKey(const Key('deliver-submit'))).onPressed, isNotNull, reason: 'both codes entered → delivery can be confirmed');
    await tapVisible(t, find.byKey(const Key('deliver-submit')));
    await pumpUntil(t, find.text('Layla Store'));

    // ── stop 2 (business): refused at the door → not delivered, to be returned ──
    await tapVisible(t, find.byKey(const Key('arrive')));
    await pumpUntil(t, find.byKey(const Key('cant-deliver')));
    await tapVisible(t, find.byKey(const Key('cant-deliver')));
    await t.pumpAndSettle(const Duration(seconds: 1));
    await tapVisible(t, find.byKey(const Key('fail-refused')));
    await t.pumpAndSettle(const Duration(milliseconds: 500));
    await tapVisible(t, find.byKey(const Key('fail-submit')));
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.byKey(const Key('fail-confirm')));
    await pumpUntil(t, find.byKey(const Key('finish')));

    // ── finish the route ──
    await tapVisible(t, find.byKey(const Key('finish')));
    await scrollTop(t);
    await pumpUntil(t, find.text('Job completed'), timeout: const Duration(seconds: 45)); // confirmed and paid at once — no warehouse confirmation

    // ── the warehouse receives the refused parcel back afterwards (it never holds the money) ──
    await biz.post('/offers/$offerId/returns', {'all': true});
    expect((await driverApi.job(offerId)).status, 'completed');

    // ── Arabic / RTL ──
    await t.pageBack();
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.text('Me'));
    await t.pumpAndSettle(const Duration(seconds: 1));
    await tapVisible(t, find.text('Language')); // the profile list is longer now (username, change password): scroll to the row first
    await t.pumpAndSettle();
    await t.tap(find.text('العربية'));
    await t.pumpAndSettle(const Duration(seconds: 2));
    expect(find.text('الملف الشخصي'), findsWidgets);
    expect(Directionality.of(t.element(find.text('الملف الشخصي').first)), TextDirection.rtl);

    await binding.takeScreenshot('jr_driver_arabic_profile');

    // ── sign out ──
    await t.scrollUntilVisible(find.text('تسجيل الخروج'), 400, scrollable: find.byType(Scrollable).first); // the sign-out row is below the fold in the longer profile list
    await t.tap(find.text('تسجيل الخروج').last);
    await t.pumpAndSettle();
    await t.tap(find.widgetWithText(FilledButton, 'تسجيل الخروج'));
    await pumpUntil(t, find.text('أهلاً بعودتك'));
    expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, cred.username, reason: 'the last username is remembered on the device');
  });
}
