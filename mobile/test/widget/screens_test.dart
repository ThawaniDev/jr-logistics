import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/features/profile/edit_profile_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/widgets/common.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

void main() {
  group('LoginScreen', () {
    testWidgets('OTP flow: send → demo code helper → verify signs the driver in', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const LoginScreen(), api: api);
      expect(find.text('Sign in with your phone'), findsOneWidget);
      await t.enterText(find.byKey(const Key('phone')), '0500000011');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(api.calls, contains('sendOtp:0500000011'));
      expect(find.text('Demo verification code'), findsOneWidget);
      await t.tap(find.text('Use code'));
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(api.calls, contains('verifyOtp:123456'));
      final c = ProviderScope.containerOf(t.element(find.byType(LoginScreen)));
      expect(c.read(authProvider).value?.signedIn, isTrue);
      expect(c.read(authProvider).value?.isDriver, isTrue);
    });

    testWidgets('shows a localized error and stays signed out on server errors', (t) async {
      final api = FakeApi()..errorOnNext = ApiException('RATE_LIMITED', 'x', status: 429);
      await pumpScreen(t, const LoginScreen(), api: api);
      await t.enterText(find.byKey(const Key('phone')), '0500000011');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(find.text('Too many attempts. Please wait a few minutes.'), findsOneWidget);
      expect(find.byKey(const Key('code')), findsNothing);
    });

    testWidgets('renders RTL Arabic', (t) async {
      await pumpScreen(t, const LoginScreen(), api: FakeApi(), lang: 'ar');
      expect(Directionality.of(t.element(find.byType(LoginScreen))), TextDirection.rtl);
      expect(find.text('الدخول برقم الجوال'), findsOneWidget);
    });
  });

  group('JobDetailScreen — one clear next step', () {
    Future<FakeApi> open(WidgetTester t, Job job, {FakeLinks? links, FakeLocation? loc, String lang = 'en'}) async {
      final api = FakeApi()..jobResult = job;
      await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, links: links, location: loc, lang: lang);
      await settle(t);
      return api;
    }

    testWidgets('accepted → hint + I\'ve arrived; check-in sends GPS when permitted', (t) async {
      final api = await open(t, mkJob(status: 'accepted', actions: ['checkin', 'cancel']));
      expect(find.text('Head to the pickup location and tap “I\'ve arrived”.'), findsOneWidget);
      expect(find.byKey(const Key('checkin')), findsOneWidget);
      expect(find.byKey(const Key('delivered')), findsNothing);
      await t.tap(find.byKey(const Key('checkin')));
      await settle(t);
      expect(api.calls, contains('checkIn:24.7,46.7'));
    });

    testWidgets('check-in still works without location permission (no GPS)', (t) async {
      final api = await open(t, mkJob(), loc: FakeLocation(granted: false));
      await t.tap(find.byKey(const Key('checkin')));
      await settle(t);
      expect(api.calls, contains('checkIn:null,null'));
    });

    testWidgets('loaded quantity awaiting ack → confirm / dispute buttons', (t) async {
      final api = await open(t, mkJob(status: 'attendance_confirmed', actions: ['ack_loading', 'dispute_loading', 'report_no_work'], extra: {'loadedUnits': 18}));
      expect(find.text('Check the loaded quantity the business recorded.'), findsOneWidget);
      expect(find.text('Confirm 18 loaded'), findsOneWidget);
      expect(find.byKey(const Key('delivered')), findsNothing);
      await t.tap(find.byKey(const Key('ack')));
      await settle(t);
      expect(api.calls, contains('ack:true'));
    });

    testWidgets('delivered sheet: stepper, cannot exceed loaded, submits integer units', (t) async {
      final api = await open(t, mkJob(status: 'attendance_confirmed', actions: ['report_delivered', 'report_no_work'], extra: {'loadedUnits': 5, 'loadedAckByDriver': true}));
      await t.ensureVisible(find.byKey(const Key('delivered')));
      await t.tap(find.byKey(const Key('delivered')));
      await settle(t);
      expect(find.byKey(const Key('qty')), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('qty'))).controller!.text, '5'); // defaults to loaded
      await t.tap(find.byIcon(Icons.add)); // at max → disabled, stays 5
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('qty'))).controller!.text, '5');
      await t.tap(find.byIcon(Icons.remove)); await t.pump();
      await t.tap(find.byIcon(Icons.remove)); await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('qty'))).controller!.text, '3');
      await t.enterText(find.byKey(const Key('qty')), '9'); await t.pump();
      expect(t.widget<FilledButton>(find.byKey(const Key('qty-submit'))).onPressed, isNull); // 9 > loaded 5
      await t.enterText(find.byKey(const Key('qty')), '4'); await t.pump();
      await t.tap(find.byKey(const Key('qty-submit')));
      await settle(t);
      expect(api.calls, contains('delivered:4'));
    });

    testWidgets('WhatsApp hand-off: asks server for the localized link and opens it externally; never claims delivery', (t) async {
      final links = FakeLinks();
      final api = await open(t, mkJob(status: 'accepted'), links: links);
      await t.ensureVisible(find.byKey(const Key('wa-arriving')));
      await t.tap(find.byKey(const Key('wa-arriving')));
      await settle(t);
      expect(api.calls, contains('wa:arriving:en'));
      expect(links.opened.single.toString(), startsWith('https://wa.me/966555555555'));
      expect(find.textContaining('JR can\'t see replies'), findsOneWidget);
      expect(find.textContaining(RegExp('delivered to|read receipt', caseSensitive: false)), findsNothing);
    });

    testWidgets('WhatsApp unavailable → clear fallback message', (t) async {
      final links = FakeLinks()..succeed = false;
      await open(t, mkJob(status: 'accepted'), links: links);
      await t.ensureVisible(find.byKey(const Key('wa-contact')));
      await t.tap(find.byKey(const Key('wa-contact')));
      await settle(t);
      expect(find.textContaining('Couldn\'t open WhatsApp'), findsOneWidget);
    });

    testWidgets('server error on an action shows localized toast, screen stays usable', (t) async {
      final api = await open(t, mkJob());
      api.errorOnNext = ApiException('INVALID_TRANSITION', 'x', status: 409);
      await t.tap(find.byKey(const Key('checkin')));
      await settle(t);
      expect(find.text('That action isn\'t available in the current state.'), findsOneWidget);
      expect(find.byKey(const Key('checkin')), findsOneWidget);
    });

    testWidgets('cancel sheet warns about the policy and needs a reason', (t) async {
      final api = await open(t, mkJob());
      await t.scrollUntilVisible(find.text('Cancel job'), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Cancel job').first);
      await settle(t);
      expect(find.textContaining('Cancellation policy'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('reason-submit'))).onPressed, isNull);
      await t.enterText(find.byKey(const Key('reason')), 'car broke down');
      await t.pump();
      await t.tap(find.byKey(const Key('reason-submit')));
      await settle(t);
      expect(api.calls, contains('cancel:car broke down'));
    });

    testWidgets('before acceptance the recipient and addresses are hidden', (t) async {
      await open(t, mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null}));
      expect(find.text('Mona'), findsNothing);
      expect(find.text('King Fahd Rd 120'), findsNothing);
      expect(find.text('Exact addresses and recipient contact appear once you accept the job.'), findsWidgets);
      expect(find.byKey(const Key('wa-contact')), findsNothing);
    });

    testWidgets('Arabic: RTL with Arabic hint and Latin refs', (t) async {
      await open(t, mkJob(), lang: 'ar');
      expect(Directionality.of(t.element(find.byType(JobDetailScreen))), TextDirection.rtl);
      expect(find.text('توجّه إلى موقع الاستلام واضغط «وصلت».'), findsOneWidget);
      expect(find.text('JR-000042'), findsOneWidget);
    });

    testWidgets('Urdu: translated hint renders', (t) async {
      await open(t, mkJob(status: 'delivered_reported', actions: []), lang: 'ur');
      expect(find.text('آپ کی ڈیلیوری درج ہو گئی۔ آپ کی کمائی والٹ میں شامل ہو رہی ہے۔'), findsOneWidget);
      expect(find.text('کاروبار کی جانب سے آپ کی ڈیلیوری کی تصدیق کا انتظار۔'), findsNothing, reason: 'nothing waits for the warehouse to confirm the delivery any more');
    });
  });

  group('No route optimiser', () {
    testWidgets('Today screen no longer offers "Plan my route" even with active jobs', (t) async {
      final api = FakeApi()..activeJobs = [mkJob(status: 'accepted'), mkManifestJob()];
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(find.text('Plan my route'), findsNothing);
      expect(find.byIcon(Icons.alt_route), findsNothing);
      expect(find.text('JR-000042 · Nakheel Fresh Foods'), findsWidgets);
    });
  });

  group('Per-parcel job — cards & offers', () {
    testWidgets('card: "up to N parcels", stops/city, all-or-nothing notice; no recipient/preferred-office wording', (t) async {
      final job = mkManifestJob(status: 'offered', actions: ['accept', 'reject'], stops: [], extra: {'expectedUnits': 30, 'allowPartial': false, 'loadedUnits': null, 'stops': null, 'stopsSummary': null});
      await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: JobCard(job: job, lang: 'en'))), api: FakeApi());
      expect(find.text('Up to 30 parcels'), findsOneWidget);
      expect(find.text('Up to 30 parcels in Riyadh'), findsOneWidget);
      expect(find.text('Starts only if all drivers are found. Otherwise the request is called off.'), findsOneWidget);
      expect(find.textContaining(RegExp('preferred', caseSensitive: false)), findsNothing);
    });

    testWidgets('card: partial-allowed jobs show no all-or-nothing notice; active job shows N stops in city', (t) async {
      final job = mkManifestJob();
      await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: JobCard(job: job, lang: 'en'))), api: FakeApi());
      expect(find.text('3 stops in Riyadh'), findsOneWidget);
      expect(find.textContaining('all drivers'), findsNothing);
    });

    testWidgets('open opportunities show up-to-N parcels and the all-or-nothing notice when allowPartial is false', (t) async {
      final api = _OppApi();
      await pumpRouted(t, const OffersScreen(), api: api);
      await settle(t);
      await t.tap(find.text('Open requests'));
      await settle(t);
      expect(find.byKey(const Key('opp-parcels-r1')), findsOneWidget);
      expect(find.text('Up to 25 parcels in Riyadh'), findsOneWidget);
      expect(find.byKey(const Key('opp-all-or-nothing-r1')), findsOneWidget);
      expect(find.byKey(const Key('opp-all-or-nothing-r2')), findsNothing);
    });
  });

  group('Per-parcel job — flow driven by actions[]', () {
    Future<FakeApi> open(WidgetTester t, Job job, {FakeLinks? links, FakeLocation? loc, FakePhotos? photos, String lang = 'en', FakeApi? api}) async {
      final a = (api ?? FakeApi())..jobResult = job;
      await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, links: links, location: loc, photos: photos, lang: lang);
      await settle(t);
      return a;
    }
    Future<void> show(WidgetTester t, Key k) async { await Scrollable.ensureVisible(t.element(find.byKey(k)), alignment: 0.5); await t.pump(); }
    Future<void> tapKey(WidgetTester t, Key k) async { await show(t, k); await t.tap(find.byKey(k)); await settle(t); }
    final arrivedExtra = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': 600};

    testWidgets('waiting for hand-over: hint only, no stop UI', (t) async {
      await open(t, mkManifestJob(actions: ['report_no_work'], stops: [], extra: {'loadedUnits': null, 'loadedAckByDriver': null, 'routeApprovedAt': null, 'stopsSummary': {'total': 0}}));
      expect(find.text('Wait at the warehouse. They will hand you the parcels and record the count.'), findsOneWidget);
      expect(find.byKey(const Key('manifest-panel')), findsNothing);
      expect(find.byKey(const Key('delivered')), findsNothing);
    });

    testWidgets('ack_loading shows the handed-over parcel count and acknowledges', (t) async {
      final api = await open(t, mkManifestJob(actions: ['ack_loading', 'dispute_loading', 'report_no_work'], stops: [mkStop(1), mkStop(2), mkStop(3), mkStop(4)], extra: {'loadedAckByDriver': null, 'routeApprovedAt': null, 'stops': [mkStop(1), mkStop(2), mkStop(3), mkStop(4)]}));
      expect(find.text('The warehouse handed you 4 parcels. Count them, then confirm.'), findsOneWidget);
      expect(find.text('Confirm 4 loaded'), findsOneWidget);
      expect(find.byKey(const Key('dispute')), findsOneWidget);
      await t.tap(find.byKey(const Key('ack')));
      await settle(t);
      expect(api.calls, contains('ack:true'));
    });

    testWidgets('approve_route: ordered stops (address, city, contents, type badge) — no names/phones — and approval call', (t) async {
      final stops = [mkStop(1, extra: {'notes': 'Gate 2'}), mkStop(2, type: 'business'), mkStop(3)];
      final api = await open(t, mkManifestJob(actions: ['approve_route', 'report_no_work'], stops: stops, extra: {'routeApprovedAt': null}));
      expect(find.text('Review your route'), findsOneWidget);
      expect(find.textContaining('Check the stops below, then approve the route'), findsOneWidget);
      expect(find.textContaining('fixed by the warehouse'), findsNothing, reason: 'the order is no longer fixed: it is the planned best route');
      expect(find.text('Street 1, Riyadh'), findsOneWidget);
      expect(find.text('Street 3, Riyadh'), findsOneWidget);
      expect(find.text('Clothes 2'), findsOneWidget);
      expect(find.text('Gate 2'), findsOneWidget);
      expect(find.text('Business (B2B)'), findsOneWidget);
      expect(find.text('Individual (B2C)'), findsNWidgets(2));
      expect(find.textContaining('Recipient '), findsNothing);
      expect(find.textContaining('+966'), findsNothing);
      expect(find.byKey(const Key('current-stop')), findsNothing);
      await tapKey(t, const Key('approve-route'));
      expect(api.calls, contains('approve'));
    });

    testWidgets('work_stops: focused current stop with recipient, call + WhatsApp (current stop id), maps; others are address-only', (t) async {
      final links = FakeLinks();
      final api = await open(t, mkManifestJob(), links: links);
      expect(find.text('Stop 1 of 3'), findsOneWidget);
      expect(find.byKey(const Key('stop-recipient')), findsOneWidget);
      expect(find.text('Recipient 1'), findsOneWidget);
      expect(find.text('Recipient 2'), findsNothing); // upcoming = address only
      expect(find.text('Street 2, Riyadh · Riyadh'), findsOneWidget);
      expect(find.text('0 of 3 stops done'), findsOneWidget);
      expect(find.byKey(const Key('delivered')), findsNothing);
      expect(find.byKey(const Key('finish')), findsNothing);
      expect(find.byKey(const Key('wa-contact')), findsNothing);
      await tapKey(t, const Key('stop-call'));
      expect(links.called.single, '+966555000001');
      await tapKey(t, const Key('stop-wa'));
      expect(api.calls, contains('wa:contact:en:s1'));
      expect(links.opened.last.toString(), startsWith('https://wa.me/'));
      await tapKey(t, const Key('stop-maps'));
      expect(links.opened.last.host, 'www.google.com');
      expect(links.opened.last.queryParameters['query'], 'Street 1, Riyadh riyadh');
    });

    testWidgets('arrive sends GPS when permitted and never blocks without it; the deliver form appears only once arrived', (t) async {
      var api = await open(t, mkManifestJob());
      expect(find.byKey(const Key('parcel-code')), findsNothing);
      expect(find.byKey(const Key('arrive')), findsOneWidget);
      await tapKey(t, const Key('arrive'));
      expect(api.calls, contains('arrive:s1:24.7,46.7'));
      await t.pumpWidget(const SizedBox());
      api = await open(t, mkManifestJob(), loc: FakeLocation(granted: false));
      await tapKey(t, const Key('arrive'));
      expect(api.calls, contains('arrive:s1:null,null'));
    });

    testWidgets('deliver (consumer): needs parcel code + 4-digit code; sends both, then the next stop becomes current', (t) async {
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: arrivedExtra), mkStop(2), mkStop(3)]));
      expect(find.byKey(const Key('proof-mode')), findsNothing, reason: 'consumers can only use the code');
      expect(find.byKey(const Key('arrive')), findsNothing);
      bool enabled() => t.widget<FilledButton>(find.byKey(const Key('deliver-submit'))).onPressed != null;
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).autofillHints, contains(AutofillHints.oneTimeCode));
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).keyboardType, TextInputType.number);
      await show(t, const Key('parcel-code'));
      expect(enabled(), isFalse);
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.enterText(find.byKey(const Key('otp-code')), '12ab34'); // digits only, max 4
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).controller!.text, '1234');
      expect(enabled(), isTrue);
      // server moves on: stop 2 is now current
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'delivered'), mkStop(2, current: true), mkStop(3)]);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls, contains('deliver:s1:JR-000042-001:1234::'));
      expect(find.text('Stop 2 of 3'), findsOneWidget);
      expect(find.text('Recipient 2'), findsWidgets);
      expect(find.text('1 of 3 stops done'), findsOneWidget);
      expect(find.byKey(const Key('done')), findsOneWidget);
    });

    testWidgets('wrong code: shows "N tries left", clears the field, keeps the stop current', (t) async {
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: arrivedExtra), mkStop(2)]));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      await t.enterText(find.byKey(const Key('otp-code')), '0000');
      await t.pump();
      api.errorOnNext = ApiException('OTP_INVALID', 'bad', status: 422, details: {'attemptsLeft': 3});
      await tapKey(t, const Key('deliver-submit'));
      expect(find.byKey(const Key('deliver-error')), findsOneWidget);
      expect(find.text('Wrong code. 3 tries left.'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).controller!.text, '');
      expect(find.byKey(const Key('stop-title')), findsOneWidget);
    });

    testWidgets('locked (OTP_LOCKED): code entry disabled, Resend code unlocks it', (t) async {
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: arrivedExtra), mkStop(2)]));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      await t.enterText(find.byKey(const Key('otp-code')), '1111');
      await t.pump();
      api.errorOnNext = ApiException('OTP_LOCKED', 'locked', status: 423);
      await tapKey(t, const Key('deliver-submit'));
      expect(find.text('Too many wrong codes. Resend the code to the recipient.'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).enabled, isFalse);
      await tapKey(t, const Key('resend-code'));
      expect(api.calls, contains('resend:s1'));
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).enabled, isTrue);
      expect(find.byKey(const Key('deliver-error')), findsNothing);
    });

    testWidgets('resend is hidden once the server says canResend is false', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: {...arrivedExtra, 'canResend': false}), mkStop(2)]));
      expect(find.byKey(const Key('resend-code')), findsNothing);
    });

    testWidgets('business stop: receipt alternative — photo upload, preview, required receiver name, deliver with proof "receipt"', (t) async {
      final photos = FakePhotos();
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, type: 'business', extra: arrivedExtra), mkStop(2)]), photos: photos);
      await show(t, const Key('proof-mode'));
      await t.tap(find.byKey(const Key('mode-receipt')));
      await t.pump();
      expect(find.byKey(const Key('otp-code')), findsNothing);
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      bool enabled() => t.widget<FilledButton>(find.byKey(const Key('deliver-submit'))).onPressed != null;
      expect(enabled(), isFalse); // no photo, no name
      await tapKey(t, const Key('receipt-pick'));
      expect(photos.taken, 1);
      expect(api.calls, contains('proof:s1:receipt.jpg'));
      expect(find.byKey(const Key('photo-ok')), findsOneWidget);
      expect(find.byKey(const Key('receipt-preview')), findsOneWidget);
      expect(enabled(), isFalse); // still needs the receiver's name
      await t.enterText(find.byKey(const Key('receiver-name')), 'Khalid');
      await t.pump();
      expect(enabled(), isTrue);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls, contains('deliver:s1:1::receipt:Khalid'));
    });

    testWidgets('receipt upload failure keeps delivery blocked and shows the error', (t) async {
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, type: 'business', extra: arrivedExtra), mkStop(2)]));
      await show(t, const Key('proof-mode'));
      await t.tap(find.byKey(const Key('mode-receipt')));
      await t.pump();
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      await t.enterText(find.byKey(const Key('receiver-name')), 'Khalid');
      api.errorOnNext = ApiException('VALIDATION', 'too big', status: 422);
      await tapKey(t, const Key('receipt-pick'));
      expect(find.byKey(const Key('photo-ok')), findsNothing);
      expect(t.widget<FilledButton>(find.byKey(const Key('deliver-submit'))).onPressed, isNull);
    });

    testWidgets('Can\'t deliver: before arrival, only reasons that need no arrival are enabled; note required for wrong_address/damaged/other', (t) async {
      final api = await open(t, mkManifestJob());
      await tapKey(t, const Key('cant-deliver'));
      for (final k in ['unreachable', 'refused', 'closed', 'no_otp', 'gate_access', 'damaged']) {
        expect(t.widget<ListTile>(find.byKey(Key('fail-$k'))).enabled, isFalse, reason: k);
      }
      for (final k in ['wrong_address', 'out_of_zone', 'other']) {
        expect(t.widget<ListTile>(find.byKey(Key('fail-$k'))).enabled, isTrue, reason: k);
      }
      expect(find.text('Wrong or incomplete address'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('fail-submit'))).onPressed, isNull);
      await t.tap(find.byKey(const Key('fail-wrong_address')));
      await t.pump();
      expect(find.text('Add a short note (required)'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('fail-submit'))).onPressed, isNull, reason: 'note required');
      await t.enterText(find.byKey(const Key('fail-note')), 'No such building');
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      expect(find.text('Mark this parcel as not delivered?'), findsOneWidget);
      expect(api.calls.where((c) => c.startsWith('fail:')), isEmpty, reason: 'nothing is sent before the confirmation');
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'failed', extra: {'failReason': 'wrong_address'}), mkStop(2, current: true), mkStop(3)]);
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(api.calls, contains('fail:s1:wrong_address:No such building'));
      expect(find.text('Stop 2 of 3'), findsOneWidget);
    });

    testWidgets('Can\'t deliver after arrival: "unreachable" is disabled with a live countdown, then unlocks', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: {...arrivedExtra, 'waitRemainingSec': 3}), mkStop(2)]));
      await tapKey(t, const Key('cant-deliver'));
      expect(t.widget<ListTile>(find.byKey(const Key('fail-refused'))).enabled, isTrue, reason: 'arrived: other door reasons are open');
      expect(t.widget<ListTile>(find.byKey(const Key('fail-unreachable'))).enabled, isFalse);
      expect(find.textContaining('Available in 0:0'), findsOneWidget);
      await t.pump(const Duration(seconds: 4));
      await t.pump();
      expect(t.widget<ListTile>(find.byKey(const Key('fail-unreachable'))).enabled, isTrue);
      expect(find.textContaining('Available in'), findsNothing);
    });

    testWidgets('WAIT_REQUIRED from the server is explained with the remaining time', (t) async {
      final api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: {...arrivedExtra, 'waitRemainingSec': 0}), mkStop(2)]));
      await tapKey(t, const Key('cant-deliver'));
      await t.tap(find.byKey(const Key('fail-unreachable')));
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      api.errorOnNext = ApiException('WAIT_REQUIRED', 'wait', status: 409, details: {'remainingSec': 125});
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(find.text('Wait 2:05 more before reporting the recipient as unreachable.'), findsOneWidget);
    });

    testWidgets('Postpone is offered only when the stop canDefer; an old server (no policy) needs no evidence and calls defer', (t) async {
      var api = await open(t, mkManifestJob());
      expect(find.byKey(const Key('postpone')), findsNothing);
      await t.pumpWidget(const SizedBox());
      api = await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: {'canDefer': true}), mkStop(2)]));
      await tapKey(t, const Key('postpone'));
      expect(find.byKey(const Key('postpone-submit')), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('postpone-submit'))).onPressed, isNotNull, reason: 'no policy = no evidence required');
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(api.calls, contains('defer:s1'));
    });

    testWidgets('STOP_LOCKED / STOPS_PENDING / RETURNS_PENDING / MANIFEST_REQUIRED / OTP_REQUIRED map to localized messages', (t) async {
      final api = await open(t, mkManifestJob());
      final expected = {
        'STOP_LOCKED': 'Finish the current stop first.', 'STOPS_PENDING': 'Some stops are still open.', 'OTP_REQUIRED': 'Ask the recipient for their delivery code.',
        'RETURNS_PENDING': 'Some undelivered parcels have not been marked as returned yet.', 'MANIFEST_REQUIRED': 'Add the shipments — recipient, phone and address for each — before publishing.',
      };
      for (final e in expected.entries) {
        api.errorOnNext = ApiException(e.key, 'x', status: 409);
        await tapKey(t, const Key('arrive'));
        expect(find.text(e.value), findsOneWidget, reason: e.key);
      }
    });

    testWidgets('finish button only when report_delivered: summary, return warning, and {} to the server', (t) async {
      // while stops are open there is no finish button
      await open(t, mkManifestJob());
      expect(find.byKey(const Key('finish')), findsNothing);
      await t.pumpWidget(const SizedBox());
      final stops = [mkStop(1, status: 'delivered'), mkStop(2, status: 'failed', extra: {'failReason': 'refused'}), mkStop(3, status: 'delivered')];
      final api = await open(t, mkManifestJob(actions: ['report_delivered'], stops: stops));
      expect(find.text('All stops are done. Report the route as finished.'), findsOneWidget);
      expect(find.byKey(const Key('current-stop')), findsNothing);
      expect(find.byKey(const Key('end-route')), findsNothing);
      expect(find.text('2 delivered · 1 not delivered'), findsOneWidget);
      expect(find.byKey(const Key('return-warning')), findsOneWidget);
      expect(find.textContaining('Return the 1 undelivered parcels to the warehouse'), findsOneWidget);
      expect(find.text('Refused'), findsNothing);
      expect(find.text('Recipient refused the parcel'), findsOneWidget); // done list shows the reason
      await tapKey(t, const Key('finish'));
      expect(api.calls, contains('delivered:{}'));
    });

    testWidgets('no return warning when everything was delivered', (t) async {
      await open(t, mkManifestJob(actions: ['report_delivered'], stops: [mkStop(1, status: 'delivered'), mkStop(2, status: 'delivered')]));
      expect(find.byKey(const Key('return-warning')), findsNothing);
      expect(find.text('2 delivered · 0 not delivered'), findsOneWidget);
    });

    testWidgets('End route: reason required, warns that delivered stops stay paid, sends reason + note', (t) async {
      final api = await open(t, mkManifestJob());
      await tapKey(t, const Key('end-route'));
      expect(find.textContaining('Stops you already delivered stay paid'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('end-submit'))).onPressed, isNull);
      await t.enterText(find.byKey(const Key('end-reason')), 'Car broke down');
      await t.enterText(find.byKey(const Key('end-note')), 'Flat tyre on King Fahd Rd');
      await t.pump();
      await t.tap(find.byKey(const Key('end-submit')));
      await settle(t);
      expect(api.calls, contains('endRoute:Car broke down:Flat tyre on King Fahd Rd'));
    });

    testWidgets('legacy (manifest:false) jobs keep the typed-quantity flow and show no per-parcel UI', (t) async {
      await open(t, mkJob(status: 'attendance_confirmed', actions: ['report_delivered', 'report_no_work'], extra: {'loadedUnits': 5, 'loadedAckByDriver': true}));
      expect(find.byKey(const Key('delivered')), findsOneWidget);
      expect(find.byKey(const Key('manifest-panel')), findsNothing);
      expect(find.text('Mona'), findsOneWidget);
    });

    testWidgets('manifest job shows no single recipient/delivery address and the all-or-nothing notice', (t) async {
      await open(t, mkManifestJob(extra: {'allowPartial': false}));
      expect(find.text('King Fahd Rd 120'), findsNothing);
      expect(find.text('Mona'), findsNothing);
      await t.scrollUntilVisible(find.textContaining('Starts only if all drivers'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('Starts only if all drivers'), findsOneWidget);
      expect(find.byKey(const Key('stops-in-city')), findsOneWidget);
    });

    testWidgets('Arabic: RTL current stop renders translated strings', (t) async {
      await open(t, mkManifestJob(), lang: 'ar');
      expect(Directionality.of(t.element(find.byType(JobDetailScreen))), TextDirection.rtl);
      expect(find.text('النقطة 1 من 3'), findsOneWidget);
      expect(find.text('وصلت'), findsOneWidget);
      expect(find.text('لا أستطيع التسليم'), findsOneWidget);
    });

    testWidgets('Urdu: route review renders translated strings', (t) async {
      await open(t, mkManifestJob(actions: ['approve_route'], extra: {'routeApprovedAt': null}), lang: 'ur');
      expect(find.text('اپنا روٹ دیکھیں'), findsOneWidget);
      expect(find.text('روٹ منظور کریں اور شروع کریں'), findsOneWidget);
    });
  });

  group('errMessage', () {
    Future<String> msg(WidgetTester t, Object e) async {
      late BuildContext ctx;
      await pumpScreen(t, Builder(builder: (c) { ctx = c; return const SizedBox(); }), api: FakeApi());
      return errMessage(ctx, e);
    }
    testWidgets('OTP_INVALID with attemptsLeft, without it, and WAIT_REQUIRED with remainingSec', (t) async {
      expect(await msg(t, ApiException('OTP_INVALID', 'x', details: {'attemptsLeft': 4})), 'Wrong code. 4 tries left.');
      expect(await msg(t, ApiException('OTP_INVALID', 'x')), 'That code is not correct.');
      expect(await msg(t, ApiException('WAIT_REQUIRED', 'x', details: {'remainingSec': 65})), 'Wait 1:05 more before reporting the recipient as unreachable.');
      expect(await msg(t, ApiException('WAIT_REQUIRED', 'x')), 'Wait at the address a little longer before reporting the recipient as unreachable.');
      expect(await msg(t, ApiException('OTP_LOCKED', 'x')), 'Too many wrong codes. Resend the code to the recipient.');
    });
  });

  group('TodayScreen', () {
    testWidgets('verified driver can go online; location is cleared when going offline', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const TodayScreen(), api: api, location: FakeLocation(granted: true));
      await settle(t);
      expect(find.text('You\'re offline'), findsOneWidget);
      await t.tap(find.byKey(const Key('toggle')));
      await settle(t);
      expect(api.calls, contains('avail:true'));
      expect(find.text('You\'re online'), findsWidgets); // card label + confirmation toast
      expect(find.text('Go offline'), findsOneWidget);
      await t.tap(find.byKey(const Key('toggle')));
      await settle(t);
      expect(api.calls, containsAllInOrder(['avail:true', 'avail:false', 'clearLocation']));
    });

    testWidgets('going online refreshes offers (backfilled by the server) instead of leaving a stale list', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(find.textContaining('New offers'), findsNothing);
      api.offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'])]; // appears server-side once the driver is online
      await t.tap(find.byKey(const Key('toggle')));
      await settle(t);
      expect(find.textContaining('New offers'), findsOneWidget);
    });

    testWidgets('unverified driver is blocked from going online with a clear reason', (t) async {
      final api = FakeApi()..overviewResult = Overview({...FakeApi().overviewResult.j, 'verificationStatus': 'pending'});
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(find.text('Complete verification to go online.'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('toggle'))).onPressed, isNull);
    });

    testWidgets('shows active jobs and an empty state when none', (t) async {
      final api = FakeApi()..activeJobs = [mkJob()];
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(find.text('JR-000042 · Nakheel Fresh Foods'), findsOneWidget);
    });
  });

  group('OffersScreen — accepting a job', () {
    testWidgets('terms must be accepted before the accept call is made', (t) async {
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
      await pumpRouted(t, const OffersScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('accept-o1')));
      await settle(t);
      expect(find.text('Accept this job'), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('confirm-accept'))).onPressed, isNull);
      await t.tap(find.byKey(const Key('terms-check')));
      await t.pump();
      expect(t.widget<FilledButton>(find.byKey(const Key('confirm-accept'))).onPressed, isNotNull);
      await t.tap(find.byKey(const Key('confirm-accept')));
      await settle(t);
      expect(api.calls, contains('accept:o1'));
      expect(find.text('JOB-PAGE-o1'), findsOneWidget); // lands on the job screen
    });
  });

  group('JobDetailScreen — driver gaps', () {
    Future<FakeApi> open(WidgetTester t, Job job, {FakeApi? api}) async {
      final a = (api ?? FakeApi())..jobResult = job;
      await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a);
      await settle(t);
      return a;
    }

    testWidgets('dispute loading asks for a reason (no hard-coded note) and sends it', (t) async {
      final api = await open(t, mkJob(status: 'attendance_confirmed', actions: ['ack_loading', 'dispute_loading', 'report_no_work'], extra: {'loadedUnits': 18}));
      await t.tap(find.byKey(const Key('dispute')));
      await settle(t);
      expect(t.widget<FilledButton>(find.byKey(const Key('reason-submit'))).onPressed, isNull); // reason required
      await t.enterText(find.byKey(const Key('reason')), 'I counted 17 boxes');
      await t.pump();
      await t.tap(find.byKey(const Key('reason-submit')));
      await settle(t);
      expect(api.calls, contains('ack:false:I counted 17 boxes'));
    });

    testWidgets('a disputed count waits for the business — no confirm button, explanatory hint', (t) async {
      await open(t, mkJob(status: 'attendance_confirmed', actions: ['report_no_work'], extra: {'loadedUnits': 18, 'loadedAckByDriver': false}));
      expect(find.text('You disputed the loaded quantity. Wait for the business to record it again.'), findsOneWidget);
      expect(find.byKey(const Key('ack')), findsNothing);
    });

    testWidgets('arrived: report a problem is offered from the server actions and sent once', (t) async {
      final api = await open(t, mkJob(status: 'arrived', actions: ['report_no_work', 'cancel']));
      await t.scrollUntilVisible(find.text('Report a problem'), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Report a problem'));
      await settle(t);
      await t.enterText(find.byKey(const Key('reason')), 'Gate is closed');
      await t.pump();
      await t.tap(find.byKey(const Key('reason-submit')));
      await settle(t);
      expect(api.calls, contains('noWork:Gate is closed'));
    });

    testWidgets('a repeated problem report (409) hides the button and says so', (t) async {
      final api = FakeApi();
      await open(t, mkJob(status: 'arrived', actions: ['report_no_work', 'cancel']), api: api);
      api.errorOnNext = ApiException('CONFLICT', 'dup', status: 409);
      await t.scrollUntilVisible(find.text('Report a problem'), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Report a problem'));
      await settle(t);
      await t.tap(find.byKey(const Key('reason-submit')));
      await settle(t);
      expect(find.text('You already reported a problem on this job.'), findsWidgets);
      expect(find.text('Report a problem'), findsNothing);
    });

    testWidgets('delivered quantity above the server ceiling shows the maximum', (t) async {
      final api = FakeApi();
      await open(t, mkJob(status: 'attendance_confirmed', actions: ['report_delivered', 'report_no_work'], extra: {'loadedUnits': 5, 'loadedAckByDriver': true}), api: api);
      await t.ensureVisible(find.byKey(const Key('delivered')));
      await t.tap(find.byKey(const Key('delivered')));
      await settle(t);
      api.errorOnNext = ApiException('VALIDATION', 'too many', status: 422, details: {'max': 3});
      await t.tap(find.byKey(const Key('qty-submit')));
      await settle(t);
      expect(find.text('You can report at most 3.'), findsOneWidget);
    });

    testWidgets('completed job: no crash on hidden fields; rating sends stars + comment, then confirms', (t) async {
      final api = await open(t, mkJob(status: 'completed', actions: [], extra: {'pickup': null, 'delivery': null, 'recipient': null, 'contents': null, 'notes': null, 'finalUnits': 18}));
      expect(find.text('Addresses, recipient and notes are hidden once a job has ended.'), findsOneWidget);
      await t.scrollUntilVisible(find.byKey(const Key('star-4')), 300, scrollable: find.byType(Scrollable).first);
      await t.ensureVisible(find.byKey(const Key('star-4')));
      await t.pump();
      await t.tap(find.byKey(const Key('star-4')));
      await t.enterText(find.byKey(const Key('rate-comment')), 'great');
      await t.pump();
      await t.ensureVisible(find.byKey(const Key('rate-submit')));
      await t.pump();
      await t.tap(find.byKey(const Key('rate-submit')));
      await settle(t);
      expect(api.calls, contains('rate:4:great'));
      expect(find.byKey(const Key('rated-ok')), findsOneWidget);
      expect(find.byKey(const Key('rate-submit')), findsNothing);
    });

    testWidgets('already rated (409) hides the rating control gracefully', (t) async {
      final api = FakeApi();
      await open(t, mkJob(status: 'completed', actions: []), api: api);
      api.errorOnNext = ApiException('CONFLICT', 'already', status: 409);
      await t.scrollUntilVisible(find.byKey(const Key('rate-submit')), 300, scrollable: find.byType(Scrollable).first);
      await t.ensureVisible(find.byKey(const Key('rate-submit')));
      await t.pump();
      await t.tap(find.byKey(const Key('rate-submit')));
      await settle(t);
      expect(find.byKey(const Key('rating')), findsNothing);
      expect(find.text('You already rated this job.'), findsOneWidget);
    });

    testWidgets('custody: handed-over items can be acknowledged', (t) async {
      final api = FakeApi()..custodyItems = [{'id': 'c1', 'itemType': 'pos_device', 'qty': 1, 'status': 'handed_over', 'description': null}];
      await open(t, mkJob(status: 'attendance_confirmed', actions: ['report_delivered', 'report_no_work'], extra: {'loadedAckByDriver': true}), api: api);
      await t.scrollUntilVisible(find.byKey(const Key('ack-custody-c1')), 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('POS device × 1'), findsOneWidget);
      await t.ensureVisible(find.byKey(const Key('ack-custody-c1'))); // the button now sits under the item text, full width: scroll it fully into view
      await t.pump();
      await t.tap(find.byKey(const Key('ack-custody-c1')));
      await settle(t);
      expect(api.calls, contains('custody:c1'));
      expect(find.byKey(const Key('ack-custody-c1')), findsNothing);
    });
  });

  group('Withdrawal dead end → profile editor', () {
    testWidgets('withdrawal rejected for missing IBAN offers the editor', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const WalletScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('withdraw')));
      await settle(t);
      await t.enterText(find.byKey(const Key('amount')), '10');
      await t.pump();
      api.errorOnNext = ApiException('VALIDATION', 'Add your IBAN in your profile first', status: 422, details: {'field': 'iban', 'iban': 'Add your IBAN in your profile first'});
      await t.tap(find.byKey(const Key('withdraw-submit')));
      await settle(t);
      expect(find.byKey(const Key('iban-missing')), findsOneWidget);
      expect(find.text('Add your IBAN in Profile first.'), findsOneWidget);
      expect(find.byKey(const Key('add-iban')), findsOneWidget);
    });
  });

  group('EditProfileScreen', () {
    Future<FakeApi> open(WidgetTester t, {FakeApi? api}) async {
      final a = api ?? FakeApi();
      a.catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}];
      a.catalogVehicles = ['sedan', 'van'];
      a.catalogServices = [{'key': 'delivery_driver'}];
      await pumpScreen(t, const EditProfileScreen(), api: a);
      await settle(t);
      return a;
    }

    Future<void> typeIban(WidgetTester t, String v) async {
      await t.scrollUntilVisible(find.byKey(const Key('edit-iban')), 300, scrollable: find.byType(Scrollable).first);
      await t.enterText(find.byKey(const Key('edit-iban')), v);
      await t.pump();
    }

    Future<void> save(WidgetTester t) async {
      await t.scrollUntilVisible(find.byKey(const Key('edit-save')), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.byKey(const Key('edit-save')));
      await settle(t);
    }

    testWidgets('invalid IBAN shows an inline error and nothing is sent', (t) async {
      final api = await open(t);
      await typeIban(t, 'SA12');
      expect(find.text('Enter a valid Saudi IBAN: SA followed by 22 digits.'), findsOneWidget);
      await save(t);
      expect(api.calls.where((c) => c.startsWith('profile:')), isEmpty);
    });

    testWidgets('valid IBAN (spaces/lower-case allowed) is saved in canonical form with bank and plate', (t) async {
      final api = await open(t);
      await t.scrollUntilVisible(find.byKey(const Key('edit-bank')), 300, scrollable: find.byType(Scrollable).first);
      await t.enterText(find.byKey(const Key('edit-bank')), 'Al Rajhi');
      await typeIban(t, 'sa03 8000 0000 6080 1016 7519');
      await save(t);
      final call = api.calls.firstWhere((c) => c.startsWith('profile:'));
      expect(call, contains('"iban":"SA0380000000608010167519"'));
      expect(call, contains('"bankName":"Al Rajhi"'));
      expect(call, contains('"vehiclePlate":"ABC 1234"'));
      expect(call, isNot(contains('availability')));
    });

    testWidgets('server-side IBAN rejection is surfaced next to the field', (t) async {
      final api = await open(t);
      await typeIban(t, 'SA0380000000608010167519');
      api.errorOnNext = ApiException('VALIDATION', 'Invalid Saudi IBAN', status: 422, details: {'field': 'iban', 'iban': 'Invalid Saudi IBAN'});
      await save(t);
      expect(find.text('Enter a valid Saudi IBAN: SA followed by 22 digits.'), findsOneWidget);
    });
  });

  group('RegisterScreen — optional IBAN', () {
    testWidgets('a malformed IBAN blocks sign-up; empty or valid is fine', (t) async {
      final api = FakeApi()
        ..catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}]
        ..catalogVehicles = ['sedan']
        ..catalogServices = [{'key': 'delivery_driver'}];
      await pumpScreen(t, const RegisterScreen(token: 'tok', phone: '0500000011'), api: api, extra: [catalogProvider.overrideWith((ref) => api.catalog())]);
      await settle(t);
      await t.enterText(find.byType(TextField).first, 'Omar Test');
      await t.tap(find.byType(DropdownButtonFormField<String>).at(0));
      await settle(t);
      await t.tap(find.text('Riyadh').last);
      await settle(t);
      await t.tap(find.byType(DropdownButtonFormField<String>).at(1));
      await settle(t);
      await t.tap(find.text('Sedan').last);
      await settle(t);
      await t.scrollUntilVisible(find.byKey(const Key('terms')), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.byKey(const Key('terms')));
      await t.pump();
      bool enabled() => t.widget<FilledButton>(find.byKey(const Key('register'))).onPressed != null;
      await t.scrollUntilVisible(find.byKey(const Key('iban')), -300, scrollable: find.byType(Scrollable).first);
      expect(enabled(), isTrue); // IBAN left empty
      await t.enterText(find.byKey(const Key('iban')), 'SA12');
      await t.pump();
      expect(find.text('Enter a valid Saudi IBAN: SA followed by 22 digits.'), findsOneWidget);
      await t.scrollUntilVisible(find.byKey(const Key('register')), 300, scrollable: find.byType(Scrollable).first);
      expect(enabled(), isFalse);
      await t.scrollUntilVisible(find.byKey(const Key('iban')), -300, scrollable: find.byType(Scrollable).first);
      await t.enterText(find.byKey(const Key('iban')), 'SA0380000000608010167519');
      await t.pump();
      await t.scrollUntilVisible(find.byKey(const Key('register')), 300, scrollable: find.byType(Scrollable).first);
      expect(enabled(), isTrue);
    });
  });

  group('TodayScreen — location while on a job', () {
    Overview ov(String availability, int active) => Overview({...FakeApi().overviewResult.j, 'availability': availability, 'activeJobs': active});

    testWidgets('offline driver with an active job keeps reporting location', (t) async {
      final api = FakeApi()..overviewResult = ov('unavailable', 1);
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(api.calls, contains('loc'));
    });

    testWidgets('offline driver without a job does not report location', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      expect(api.calls, isNot(contains('loc')));
    });

    testWidgets('going offline mid-job does not clear the location and publishes a fresh point', (t) async {
      final api = FakeApi()..overviewResult = ov('available', 1);
      await pumpScreen(t, const TodayScreen(), api: api);
      await settle(t);
      api.calls.clear();
      await t.tap(find.byKey(const Key('toggle')));
      await settle(t);
      expect(api.calls, contains('avail:false'));
      expect(api.calls, isNot(contains('clearLocation')));
      expect(api.calls, contains('loc'));
    });
  });
}

class _OppApi extends FakeApi {
  @override
  Future<List<Map<String, dynamic>>> opportunities() async => [
        {'requestId': 'r1', 'service': 'delivery_driver', 'startsAt': '2026-12-01T06:00:00.000Z', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'expectedUnits': 25, 'expectedEarningCents': 13750, 'openSlots': 2, 'allowPartial': false},
        {'requestId': 'r2', 'service': 'delivery_driver', 'startsAt': '2026-12-02T06:00:00.000Z', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'expectedUnits': 30, 'expectedEarningCents': 16500, 'openSlots': 1, 'allowPartial': true},
      ];
}
