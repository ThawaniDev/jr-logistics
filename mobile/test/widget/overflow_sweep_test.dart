import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/auth/change_password_screen.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/chat_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/jobs_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/profile/documents_screen.dart';
import 'package:jr_driver/features/profile/edit_profile_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';

/// Every driver screen, every language, at the largest text size the app allows (1.4x) on a 320 dp wide phone — scrolled from top to bottom.
/// Any RenderFlex overflow, or any other layout exception, fails the test. (The current-stop / deliver form has its own test in ux_test.dart.)
Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<void> sweep(WidgetTester t, Widget screen, {required FakeApi api, required String lang, FakeLocation? loc}) async {
  t.platformDispatcher.textScaleFactorTestValue = 1.4;
  addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
  await pumpScreen(t, screen, api: api, lang: lang, location: loc);
  t.view.physicalSize = const Size(640, 1400);
  t.view.devicePixelRatio = 2;
  await settle(t);
  final errors = <String>[];
  void collect() {
    for (Object? e = t.takeException(); e != null; e = t.takeException()) {
      // Name the offending row: its texts and its creator chain (the plain exception only says "overflowed by N pixels").
      final where = <String>[];
      void walk(Element el) {
        final ro = el.renderObject;
        if (ro is RenderFlex && ro.hasSize) {
          var sum = 0.0; var c = ro.firstChild;
          while (c != null) { if (c.hasSize) sum += ro.direction == Axis.horizontal ? c.size.width : c.size.height; c = (c.parentData as FlexParentData).nextSibling; }
          final limit = ro.direction == Axis.horizontal ? ro.size.width : ro.size.height;
          if (sum > limit + 0.5) {
            final texts = <String>[];
            void tx(Element x) { final w = x.widget; if (w is Text && w.data != null) texts.add(w.data!); x.visitChildren(tx); }
            el.visitChildren(tx);
            where.add('${el.debugGetCreatorChain(4)} texts=${texts.take(3)}');
          }
        }
        el.visitChildren(walk);
      }
      t.binding.rootElement!.visitChildren(walk);
      errors.add('${e.toString().split('\n').first} @ ${where.take(2)}');
    }
  }
  collect();
  final list = find.byType(Scrollable);
  if (list.evaluate().isNotEmpty) {
    for (var i = 0; i < 14; i++) { await t.drag(list.first, const Offset(0, -450)); await t.pump(); collect(); }
  }
  expect(errors.toSet().toList(), isEmpty, reason: '${screen.runtimeType} / $lang / ${api.jobResult?.status}');
}

void main() {
  final offered = mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'pickup': null, 'delivery': null, 'recipient': null, 'earningHidden': false});
  final jobs = [
    mkJob(status: 'accepted', actions: ['checkin', 'cancel']),
    mkManifestJob(status: 'attendance_confirmed', actions: ['ack_loading', 'dispute_loading', 'report_no_work'], extra: {'loadedAckByDriver': null, 'routeApprovedAt': null, 'allowPartial': false}),
    mkJob(status: 'completed', actions: [], extra: {'finalUnits': 18, 'cancelReason': 'The business cancelled the remaining parcels because the warehouse closed early'}),
  ];
  final custody = [
    {'id': 'c1', 'itemType': 'thermal_bag', 'qty': 2, 'description': 'Insulated cooler bags with the company logo', 'status': 'handed_over'},
    {'id': 'c2', 'itemType': 'thermal_bag', 'qty': 1, 'description': null, 'status': 'acknowledged'},
  ];

  for (final lang in ['en', 'ar', 'ur']) {
    group('$lang @ 1.4x text, 320 dp', () {
      testWidgets('job screen: every state (offered, accepted, loading confirmation, report delivered, completed + rating, custody)', (t) async {
        final states = <Job>[
          offered, jobs[0], jobs[1],
          mkJob(status: 'attendance_confirmed', actions: ['report_delivered', 'report_no_work'], extra: {'loadedUnits': 20, 'loadedAckByDriver': true, 'contents': 'Frozen food and dairy products, keep upright', 'notes': 'Call the warehouse manager before entering the loading bay'}),
          jobs[2],
        ];
        for (final j in states) {
          final api = FakeApi()..jobResult = j..custodyItems = j.status == 'accepted' || j.status == 'completed' ? custody : [];
          await sweep(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
          await t.pumpWidget(const SizedBox());
        }
      });

      testWidgets('today, jobs list, offers', (t) async {
        final api = FakeApi()
          ..activeJobs = jobs
          ..offerList = [offered, mkManifestJob(status: 'offered', actions: ['accept', 'reject'], extra: {'allowPartial': false})]
          ..overviewResult = Overview({'availability': 'available', 'verificationStatus': 'pending', 'newOffers': 2, 'activeJobs': 3, 'jobsCompleted': 120, 'rating': 4.5, 'officeLinked': false, 'wallet': {'availableCents': 123456789, 'heldCents': 0, 'pendingCents': 400000}});
        for (final s in [const TodayScreen(), const JobsScreen(), const OffersScreen()]) {
          await sweep(t, s, api: api, lang: lang, loc: FakeLocation(granted: false));
          await t.pumpWidget(const SizedBox());
        }
      });

      testWidgets('wallet, profile, documents, notifications, chat, edit profile, login, register, change password', (t) async {
        final api = FakeApi();
        for (final s in [const WalletScreen(), const ProfileScreen(), const DocumentsScreen(), const NotificationsScreen(), const ChatScreen(offerId: 'o1'), const EditProfileScreen(), const LoginScreen(), const RegisterScreen(), const ChangePasswordScreen()]) {
          await sweep(t, s, api: api, lang: lang);
          await t.pumpWidget(const SizedBox());
        }
      });
    });
  }

  // ── field-operations screens (Mobile-A): arrival geofence, scan loading, reorder, stops with cash / signature / evidence, stat cards, completed ──
  const arrived = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null};
  /// Scrolls [k] to the middle of whatever scrolls it (page or sheet), then taps it.
  Future<void> tapVisible(WidgetTester t, Key k) async {
    final f = find.byKey(k);
    if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
    await Scrollable.ensureVisible(t.element(f), alignment: 0.5);
    await t.pump();
    await t.tap(f);
    await settle(t);
  }
  final scanning = scanJob(total: 30, scanned: [for (var i = 1; i <= 12; i++) i]);
  final cashJob = mkManifestJob(
    stops: [
      mkLegStop(1, current: true, type: 'business', extra: {...arrived, 'needsSignature': true, 'codCents': 123456, 'canDefer': true, 'notes': 'Second floor, blue door, ask for the manager at the front desk'}),
      for (var n = 2; n <= 6; n++) mkLegStop(n, extra: {'codCents': n == 3 ? 5000 : 0}),
      mkStop(7, status: 'delivered'), mkStop(8, status: 'failed', extra: {'failReason': 'refused'}),
    ],
    summary: {'total': 8, 'pending': 0, 'loaded': 6, 'delivered': 1, 'failed': 1, 'returned': 0, 'missing': 0},
    extra: {'route': mkRoute(provider: 'manual', extra: {'canReorder': true, 'manual': true}), 'policy': mkPolicy(), 'cod': mkCod(toCollect: 12345600, collected: 4000000, parcels: 9), 'ops': mkOps(signature: true)},
  );

  for (final lang in ['en', 'ar', 'ur']) {
    group('$lang @ 1.4x text, 320 dp — field operations', () {
      testWidgets('job page: arrival with distance, scan loading (30 parcels), working stop with cash + signature + reorder + stat cards, completed', (t) async {
        final states = <Job>[
          mkJob(status: 'accepted', actions: ['checkin', 'cancel'], extra: {'arrival': mkArrival(lat: 24.7028, lng: 46.7), 'ops': mkOps()}),
          scanning,
          cashJob,
          mkManifestJob(status: 'completed', actions: [], stops: [mkStop(1, status: 'delivered'), mkStop(2, status: 'failed', extra: {'failReason': 'refused'})], extra: {'cod': mkCod(toCollect: 5000, collected: 5000, parcels: 1)}),
          mkManifestJob(actions: ['approve_route', 'report_no_work'], stops: [for (var n = 1; n <= 5; n++) mkLegStop(n, extra: {'codCents': n == 2 ? 2500 : 0})], extra: {'routeApprovedAt': null, 'route': mkRoute(extra: {'canReorder': true}), 'policy': mkPolicy(), 'loading': mkLoading(assigned: 5, scanned: 5, finished: true)}),
        ];
        for (final j in states) {
          final api = FakeApi()..jobResult = j;
          seedBook(api, 30, scanned: [for (var i = 1; i <= 12; i++) i]);
          await sweep(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
          await t.pumpWidget(const SizedBox());
        }
      });

      testWidgets('job card counters and stat cards', (t) async {
        await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: Column(children: [JobCard(job: cashJob, lang: lang)]))), api: FakeApi(), lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        await settle(t);
        expect(t.takeException(), isNull);
      });

      testWidgets('arrival problems (too far, no permission) and the scan feedback do not overflow', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final api = FakeApi()..jobResult = mkJob(status: 'accepted', actions: ['checkin', 'cancel'], extra: {'arrival': mkArrival(lat: 24.7028, lng: 46.7)});
        final loc = FakeLocation(granted: false);
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang, location: loc);
        t.view.physicalSize = const Size(640, 1400);
        t.view.devicePixelRatio = 2;
        await settle(t);
        await tapVisible(t, const Key('checkin'));
        expect(find.byKey(const Key('checkin-denied')), findsOneWidget);
        expect(t.takeException(), isNull);
        loc.granted = true;
        api.errorOnNext = ApiException('TOO_FAR_FROM_WAREHOUSE', 'far', status: 422, details: {'distanceM': 12340, 'radiusM': 200});
        await tapVisible(t, const Key('checkin-retry'));
        expect(find.byKey(const Key('checkin-too-far')), findsOneWidget);
        expect(t.takeException(), isNull);
        await t.pumpWidget(const SizedBox());

        final api2 = FakeApi()..jobResult = scanning;
        seedBook(api2, 30);
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api2, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        await settle(t);
        await t.scrollUntilVisible(find.byKey(const Key('scan-code')), 300, scrollable: find.byType(Scrollable).first);
        await t.enterText(find.byKey(const Key('scan-code')), 'JR-000042-013');
        await t.pump();
        await tapVisible(t, const Key('scan-add'));
        expect(find.byKey(const Key('scan-feedback')), findsOneWidget);
        expect(t.takeException(), isNull);
      });

      testWidgets('sheets: delivery form (cash + signature), can\'t deliver (photo), postpone (evidence), reorder editor, finish-loading dialog', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final api = FakeApi()..jobResult = cashJob;
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        t.view.devicePixelRatio = 2;
        await settle(t);
        Future<void> reach(Key k) async { await t.scrollUntilVisible(find.byKey(k), 300, scrollable: find.byType(Scrollable).first); await Scrollable.ensureVisible(t.element(find.byKey(k)), alignment: 0.5); await t.pump(); }
        // the signature pad and the cash confirmation inside the inline form
        await reach(const Key('signature-pad'));
        expect(t.takeException(), isNull);
        await reach(const Key('cod-confirm'));
        expect(t.takeException(), isNull);
        // can't deliver, with a photo
        await tapVisible(t, const Key('cant-deliver'));
        await tapVisible(t, const Key('fail-damaged'));
        await tapVisible(t, const Key('fail-photo-camera'));
        expect(find.byKey(const Key('fail-photo-preview')), findsOneWidget);
        expect(t.takeException(), isNull);
        await tapVisible(t, const Key('fail-submit'));
        expect(find.byKey(const Key('fail-cancel')), findsOneWidget); // the confirmation dialog
        expect(t.takeException(), isNull);
        await t.tap(find.byKey(const Key('fail-cancel')));
        await settle(t);
        await t.tapAt(const Offset(5, 5)); // close the sheet
        await settle(t);
        // postpone with both evidence parts required
        await tapVisible(t, const Key('postpone'));
        await t.enterText(find.byKey(const Key('postpone-note')), 'The shop is closed until six in the evening, the neighbour confirmed it');
        await t.pump();
        await tapVisible(t, const Key('postpone-photo-camera'));
        expect(find.byKey(const Key('postpone-photo-preview')), findsOneWidget);
        expect(t.takeException(), isNull);
        await t.tapAt(const Offset(5, 5));
        await settle(t);
        // the reorder editor
        await tapVisible(t, const Key('reorder-edit'));
        await reach(const Key('order-save'));
        expect(t.takeException(), isNull);
        await t.pumpWidget(const SizedBox());

        // the finish-loading confirmation
        final api2 = FakeApi()..jobResult = scanJob(total: 30, scanned: [1, 2, 3]);
        seedBook(api2, 30, scanned: [1, 2, 3]);
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api2, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        await settle(t);
        await tapVisible(t, const Key('finish-loading'));
        expect(find.byKey(const Key('finish-loading-confirm')), findsOneWidget);
        expect(t.takeException(), isNull);
      });
    });
  }
}
