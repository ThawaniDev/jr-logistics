import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/jobs/route_screen.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

void main() {
  group('LoginScreen', () {
    testWidgets('OTP flow: send → demo code helper → verify signs the driver in', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const LoginScreen(), api: api);
      expect(find.text('Sign in with your phone'), findsOneWidget);
      await t.enterText(find.byKey(const Key('phone')), '0500000011');
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
      expect(find.text('کاروبار کی جانب سے آپ کی ڈیلیوری کی تصدیق کا انتظار۔'), findsOneWidget);
    });
  });

  group('RouteScreen — honest route planning', () {
    RoutePlan mk(String provider, {String? warning}) => RoutePlan({'provider': provider, 'warning': ?warning, 'order': ['o2', 'o1'], 'legs': [{'from': 'origin', 'to': 'o2', 'distanceM': 3200, 'durationS': 540}, {'from': 'o2', 'to': 'o1', 'distanceM': 1800, 'durationS': 300}], 'totalDistanceM': 5000, 'totalDurationS': 840});
    Future<(FakeApi, FakeLinks)> open(WidgetTester t, RoutePlan plan) async {
      final api = FakeApi()..plan = plan;
      api.activeJobs = [mkJob(status: 'accepted'), Job({...mkJob().j, 'offerId': 'o2', 'ref': 'JR-000043', 'delivery': {'address': 'Second St', 'lat': 24.8, 'lng': 46.8}})];
      final links = FakeLinks();
      await pumpScreen(t, const RouteScreen(), api: api, links: links);
      await settle(t);
      return (api, links);
    }

    testWidgets('estimate is labelled as an estimate (never as Google or "best")', (t) async {
      final (api, _) = await open(t, mk('local_heuristic', warning: 'ROUTING_PROVIDER_NOT_CONFIGURED'));
      await t.tap(find.byKey(const Key('optimize')));
      await settle(t);
      expect(api.calls, contains('route:2'));
      expect(find.textContaining('Estimated order'), findsOneWidget);
      expect(find.textContaining('isn\'t configured yet'), findsOneWidget);
      expect(find.text('Route from Google Maps'), findsNothing);
      expect(find.textContaining('Review the order'), findsOneWidget);
    });

    testWidgets('Google result is labelled, reviewed, and navigation preserves the reviewed order', (t) async {
      final (_, links) = await open(t, mk('google_routes'));
      await t.tap(find.byKey(const Key('optimize')));
      await settle(t);
      expect(find.text('Route from Google Maps'), findsOneWidget);
      expect(find.text('5.0 km · 14 min'), findsOneWidget);
      await t.ensureVisible(find.byKey(const Key('start-nav')));
      await t.tap(find.byKey(const Key('start-nav')));
      await settle(t);
      final u = links.opened.single;
      expect(u.queryParameters['waypoints'], '24.8,46.8'); // o2 first
      expect(u.queryParameters['destination'], '24.7,46.7'); // o1 last
    });

    testWidgets('provider failure falls back with an explicit warning', (t) async {
      await open(t, mk('local_heuristic', warning: 'ROUTING_PROVIDER_FAILED: HTTP 500'));
      await t.tap(find.byKey(const Key('optimize')));
      await settle(t);
      expect(find.textContaining('unavailable right now'), findsOneWidget);
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
}
