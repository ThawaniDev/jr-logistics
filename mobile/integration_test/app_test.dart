import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:jr_driver/core/config.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';

/// Real end-to-end test: the real app on a real (simulated) device talking to the real Next.js API + Postgres.
/// Run with tool/live_test.sh --e2e
Future<ApiClient> clientFor(String phone) async {
  final tokens = MemoryTokenStore();
  final c = ApiClient(baseUrl: AppConfig.baseUrl, tokens: tokens);
  final api = DriverApi(c);
  final sent = await api.sendOtp(phone);
  final v = await api.verifyOtp(phone, sent['demoCode'] as String);
  await tokens.write(v['token'] as String);
  return c;
}

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

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('driver signs in, takes a job and completes it end to end; switches to Arabic RTL', (t) async {
    SharedPreferences.setMockInitialValues({'lang': 'en', 'loc_asked': true});
    await SecureTokenStore().clear();
    final biz = await clientFor('0500000001');
    final driverApi = DriverApi(await clientFor('0500000011'));
    await driverApi.updateProfile({'language': 'en'}); // the app syncs the saved profile language on sign-in
    final start = DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String();
    final created = await biz.post('/requests', {
      'service': 'delivery_driver', 'quantity': 1, 'shipmentsPerDriver': 20, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh',
      'pickupAddress': 'Olaya St', 'deliveryAddress': 'E2E Delivery Rd 7', 'deliveryLat': 24.7, 'deliveryLng': 46.7, 'recipientName': 'Mona', 'recipientPhone': '0555555555',
      'startsAt': start, 'durationDays': 1, 'publish': true, 'termsAccepted': true,
    });
    final requestId = created['id'] as String;

    app.main();
    await t.pumpAndSettle(const Duration(seconds: 2));

    // ── sign in with phone OTP ──
    expect(find.text('Sign in with your phone'), findsOneWidget);
    await t.enterText(find.byKey(const Key('phone')), '0500000011');
    await t.tap(find.byKey(const Key('submit')));
    await pumpUntil(t, find.text('Demo verification code'));
    await t.tap(find.text('Use code'));
    await t.pump();
    await t.tap(find.byKey(const Key('submit')));
    await pumpUntil(t, find.text('Go online'));
    expect(find.textContaining('Omar'), findsWidgets);

    // ── go online ──
    await t.tap(find.byKey(const Key('toggle')));
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

    // recipient is revealed after acceptance; WhatsApp buttons present
    expect(find.text('Mona'), findsOneWidget);
    expect(find.byKey(const Key('wa-arriving')), findsOneWidget);
    expect(find.text('Head to the pickup location and tap “I\'ve arrived”.'), findsOneWidget);

    // ── arrive ──
    await t.tap(find.byKey(const Key('checkin')));
    await pumpUntil(t, find.text('Wait for the business to confirm your attendance.'));

    // ── business confirms attendance and records loading; the driver's screen updates by itself ──
    final jobs = await driverApi.jobs(active: true);
    final offerId = jobs.firstWhere((j) => j.requestId == requestId).offerId;
    await biz.post('/offers/$offerId/attendance', {'present': true});
    await biz.post('/offers/$offerId/loading', {'units': 20});
    await pumpUntil(t, find.byKey(const Key('ack')), timeout: const Duration(seconds: 45));
    expect(find.text('Confirm 20 loaded'), findsOneWidget);
    await t.tap(find.byKey(const Key('ack')));
    await pumpUntil(t, find.byKey(const Key('delivered')));

    // ── report delivered quantity with the big-target stepper ──
    await t.ensureVisible(find.byKey(const Key('delivered')));
    await t.tap(find.byKey(const Key('delivered')));
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.byIcon(Icons.remove));
    await t.pump();
    expect(t.widget<TextField>(find.byKey(const Key('qty'))).controller!.text, '19');
    await t.tap(find.byKey(const Key('qty-submit')));
    await scrollTop(t);
    await pumpUntil(t, find.text('Waiting for the business to confirm your delivery.'));

    // ── business confirms → completed ──
    await biz.post('/offers/$offerId/delivery-decision', {'action': 'confirm'});
    await scrollTop(t);
    await pumpUntil(t, find.text('All done. Your payment is on its way.'), timeout: const Duration(seconds: 45));

    // ── Arabic / RTL ──
    await t.pageBack();
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.text('Me'));
    await t.pumpAndSettle(const Duration(seconds: 1));
    await t.tap(find.text('Language'));
    await t.pumpAndSettle();
    await t.tap(find.text('العربية'));
    await t.pumpAndSettle(const Duration(seconds: 2));
    expect(find.text('الملف الشخصي'), findsWidgets);
    expect(Directionality.of(t.element(find.text('الملف الشخصي').first)), TextDirection.rtl);

    await binding.takeScreenshot('jr_driver_arabic_profile');

    // ── sign out ──
    await t.tap(find.text('تسجيل الخروج').last);
    await t.pumpAndSettle();
    await t.tap(find.widgetWithText(FilledButton, 'تسجيل الخروج'));
    await pumpUntil(t, find.text('الدخول برقم الجوال'));
  });
}
