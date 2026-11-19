import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/cash/cash_screen.dart';
import 'package:jr_driver/features/home/shell.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/services_notify.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

Overview _overview({Json? cash, Json? activeJob, int newOffers = 0, int pending = 4000}) => Overview({
      ...FakeApi().overviewResult.j, 'newOffers': newOffers, 'cash': ?cash, 'activeJob': ?activeJob,
      'wallet': {'availableCents': 12500, 'heldCents': 0, 'pendingCents': pending},
    });

void main() {
  group('Cash with me (E17) — the screen', () {
    CashSummary sample() => CashSummary({
          'collectedCents': 300000, 'receivedCents': 100000, 'outstandingCents': 200000,
          'orders': [
            {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'businessName': 'Nakheel Fresh Foods', 'parcels': 3, 'collectedCents': 250000, 'receivedCents': 50000, 'outstandingCents': 200000, 'lastCollectedAt': '2026-12-01T06:00:00Z'},
            {'offerId': 'o2', 'requestId': 'r2', 'ref': 'JR-000040', 'businessName': 'Oasis', 'parcels': 1, 'collectedCents': 50000, 'receivedCents': 50000, 'outstandingCents': 0, 'lastCollectedAt': '2026-11-30T06:00:00Z'},
          ],
          'recent': [{'id': 'h1', 'ref': 'JR-000040', 'amountCents': 50000, 'receivedByName': 'Sara', 'receivedByRole': 'business', 'note': 'Counted together', 'createdAt': '2026-12-02T06:00:00Z'}],
        });

    testWidgets('explains what the cash is, shows collected / handed over / with me, each order and the recent hand-overs', (t) async {
      final ex = FakeExtraApi()..cashResult = sample();
      await pumpRoutedB(t, const CashScreen(), api: FakeApi(), extraApi: ex);
      await settleB(t);
      expect(find.byKey(const Key('cash-explain')), findsOneWidget);
      expect(find.textContaining('belongs to the warehouse'), findsOneWidget);
      expect(find.text('SAR 2,000.00'), findsWidgets);
      expect(t.widget<Text>(find.byKey(const Key('cash-with-me-amount'))).data, 'SAR 2,000.00');
      expect(find.descendant(of: find.byKey(const Key('cash-collected')), matching: find.text('SAR 3,000.00')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('cash-received')), matching: find.text('SAR 1,000.00')), findsOneWidget);
      // per order
      final o1 = find.byKey(const Key('cash-order-o1'));
      expect(find.descendant(of: o1, matching: find.text('JR-000042')), findsOneWidget);
      expect(find.descendant(of: o1, matching: find.textContaining('Nakheel Fresh Foods')), findsOneWidget);
      expect(find.descendant(of: o1, matching: find.text('3 parcel(s) paid in cash')), findsOneWidget);
      expect(find.descendant(of: o1, matching: find.text('SAR 2,500.00')), findsOneWidget);
      expect(find.descendant(of: o1, matching: find.text('To hand over')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('cash-order-o2')), matching: find.text('All handed over')), findsOneWidget);
      // recent
      final h = find.byKey(const Key('cash-handover-h1'));
      await t.scrollUntilVisible(h, 300, scrollable: find.byType(Scrollable).first);
      expect(find.descendant(of: h, matching: find.text('Received by Sara · Warehouse')), findsOneWidget);
      expect(find.descendant(of: h, matching: find.text('Counted together')), findsOneWidget);
    });

    testWidgets('nothing collected: a clear empty state, not a blank page', (t) async {
      await pumpRoutedB(t, const CashScreen(), api: FakeApi(), extraApi: FakeExtraApi());
      await settleB(t);
      expect(find.byKey(const Key('cash-empty')), findsOneWidget);
      expect(find.text('No cash collected yet'), findsOneWidget);
      expect(find.text('You are not holding any cash for a warehouse.'), findsOneWidget);
    });

    testWidgets('a failed load shows the localized error with Retry', (t) async {
      final ex = FakeExtraApi()..errorOnNext = ApiException('NETWORK', 'x');
      await pumpRoutedB(t, const CashScreen(), api: FakeApi(), extraApi: ex);
      await settleB(t);
      expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
      ex.cashResult = sample();
      await t.tap(find.byKey(const Key('retry')));
      await settleB(t);
      expect(find.byKey(const Key('cash-with-me-amount')), findsOneWidget);
    });

    testWidgets('pull to refresh asks the server again', (t) async {
      final ex = FakeExtraApi()..cashResult = sample();
      await pumpRoutedB(t, const CashScreen(), api: FakeApi(), extraApi: ex);
      await settleB(t);
      expect(ex.calls.where((c) => c == 'cash').length, 1);
      ex.cashResult = CashSummary({...sample().j, 'outstandingCents': 0});
      await t.fling(find.byType(ListView).first, const Offset(0, 400), 1500);
      await settleB(t);
      await t.pump(const Duration(seconds: 1));
      expect(ex.calls.where((c) => c == 'cash').length, 2);
      expect(t.widget<Text>(find.byKey(const Key('cash-with-me-amount'))).data, 'SAR 0.00');
    });

    testWidgets('Arabic renders (Latin digits, SAR as ر.س)', (t) async {
      final ex = FakeExtraApi()..cashResult = sample();
      await pumpRoutedB(t, const CashScreen(), api: FakeApi(), extraApi: ex, lang: 'ar');
      await settleB(t);
      expect(find.text('2,000.00 ر.س'), findsWidgets);
      expect(t.takeException(), isNull);
    });
  });

  group('Home screen — cash card, active job card, wording', () {
    testWidgets('"Cash with me: SAR X" card from overview.cash opens the cash screen', (t) async {
      final api = FakeApi()..overviewResult = _overview(cash: {'outstandingCents': 123450, 'orders': 2});
      await pumpRoutedB(t, const TodayScreen(), api: api);
      await settleB(t);
      expect(find.byKey(const Key('cash-card')), findsOneWidget);
      expect(find.text('Cash with me'), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('cash-card-amount'))).data, 'SAR 1,234.50');
      await t.tap(find.byKey(const Key('cash-card')));
      await settleB(t);
      expect(find.text('PAGE:/cash'), findsOneWidget);
    });

    testWidgets('no cash card without cash (older servers, or nothing ever collected)', (t) async {
      for (final cash in [null, {'outstandingCents': 0, 'orders': 0}]) {
        final api = FakeApi()..overviewResult = _overview(cash: cash);
        await pumpRoutedB(t, const TodayScreen(), api: api);
        await settleB(t);
        expect(find.byKey(const Key('cash-card')), findsNothing, reason: '$cash');
        await t.pumpWidget(const SizedBox());
      }
    });

    testWidgets('"Active job" shortcut from overview.activeJob opens that job; new offers are not advertised meanwhile', (t) async {
      final api = FakeApi()..overviewResult = _overview(activeJob: {'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'attendance_confirmed'});
      await pumpRoutedB(t, const TodayScreen(), api: api);
      await settleB(t);
      expect(find.byKey(const Key('active-job-card')), findsOneWidget);
      expect(find.text('Active job'), findsOneWidget);
      expect(find.text('JR-000009 · Working'), findsOneWidget);
      expect(find.textContaining('New offers'), findsNothing);
      await t.tap(find.byKey(const Key('active-job-card')));
      await settleB(t);
      expect(find.text('JOB-PAGE-o9'), findsOneWidget);
    });

    testWidgets('no active-job card without an active job', (t) async {
      await pumpRoutedB(t, const TodayScreen(), api: FakeApi());
      await settleB(t);
      expect(find.byKey(const Key('active-job-card')), findsNothing);
    });

    testWidgets('the pending figure is labelled "On hold" (open complaint), not "Pending payment"', (t) async {
      await pumpRoutedB(t, const TodayScreen(), api: FakeApi());
      await settleB(t);
      expect(find.text('On hold'), findsOneWidget);
      expect(find.text('Pending payment'), findsNothing);
    });
  });

  group('Polite notification prompt on the home screen (E12)', () {
    testWidgets('shown only while the OS has not been asked; "Turn on" asks once, then the card is gone for good', (t) async {
      final n = FakeNotifier(permission: false);
      await pumpRoutedB(t, const TodayScreen(), api: FakeApi(), notifier: n);
      await settleB(t);
      expect(find.byKey(const Key('notify-prompt')), findsOneWidget);
      expect(find.text('Be first to know about new offers'), findsOneWidget);
      expect(n.asked, 0, reason: 'nothing is asked until the driver taps');
      await t.tap(find.byKey(const Key('notify-allow')));
      await settleB(t);
      expect(n.asked, 1);
      expect(find.byKey(const Key('notify-prompt')), findsNothing);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('notif_asked'), isTrue);
    });

    testWidgets('"Not now" hides it and remembers; it never blocks the screen', (t) async {
      final n = FakeNotifier(permission: false);
      await pumpRoutedB(t, const TodayScreen(), api: FakeApi(), notifier: n);
      await settleB(t);
      await t.tap(find.byKey(const Key('notify-later')));
      await settleB(t);
      expect(find.byKey(const Key('notify-prompt')), findsNothing);
      expect(n.asked, 0);
      expect((await SharedPreferences.getInstance()).getBool('notif_prompt_dismissed'), isTrue);
      expect(find.byKey(const Key('toggle')), findsOneWidget, reason: 'the rest of the screen is untouched');
    });

    testWidgets('denying the OS prompt tells the driver how it still works; already on / unsupported / asked before → no card', (t) async {
      final denied = FakeNotifier(permission: false, grantOnRequest: false);
      await pumpRoutedB(t, const TodayScreen(), api: FakeApi(), notifier: denied);
      await settleB(t);
      await t.tap(find.byKey(const Key('notify-allow')));
      await settleB(t);
      expect(find.textContaining('Notifications stay off'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      for (final (n, prefs) in [(FakeNotifier(permission: true), <String, Object>{}), (FakeNotifier(permission: null), <String, Object>{}), (FakeNotifier(permission: false), <String, Object>{'notif_asked': true})]) {
        await pumpRoutedB(t, const TodayScreen(), api: FakeApi(), notifier: n, prefsValues: prefs);
        await settleB(t);
        expect(find.byKey(const Key('notify-prompt')), findsNothing, reason: 'permission=${n.permission} $prefs');
        await t.pumpWidget(const SizedBox());
      }
    });
  });

  group('Offers hidden while busy (E11)', () {
    Overview busy() => _overview(activeJob: {'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'accepted'});

    testWidgets('a friendly banner with a button to the active job — the list below stays (empty, as the server sends)', (t) async {
      final ex = FakeExtraApi()..offers = OffersInfo(hidden: true, activeJob: ActiveJobRef.fromJson({'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'accepted'}));
      await pumpRoutedB(t, const OffersScreen(), api: FakeApi()..overviewResult = busy(), extraApi: ex);
      await settleB(t);
      expect(find.byKey(const Key('offers-hidden')), findsOneWidget);
      expect(find.textContaining('Finish your current job to see new offers.'), findsOneWidget);
      expect(find.textContaining('Current job: JR-000009'), findsOneWidget);
      expect(find.text('No offers right now'), findsOneWidget);
      await t.tap(find.byKey(const Key('offers-active-job')));
      await settleB(t);
      expect(find.text('JOB-PAGE-o9'), findsOneWidget);
    });

    testWidgets('not busy: no banner, the offers are listed as before', (t) async {
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
      await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: FakeExtraApi());
      await settleB(t);
      expect(find.byKey(const Key('offers-hidden')), findsNothing);
      expect(find.byKey(const Key('accept-o1')), findsOneWidget);
    });

    testWidgets('the banner endpoint failing never hides the offers or shows an error', (t) async {
      final ex = FakeExtraApi();
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
      ex.offers = OffersInfo.none;
      await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: _FailingOffersInfo());
      await settleB(t);
      expect(find.byKey(const Key('offers-hidden')), findsNothing);
      expect(find.byKey(const Key('accept-o1')), findsOneWidget);
      expect(find.byKey(const Key('retry')), findsNothing);
    });

    testWidgets('hidden without an active-job reference still explains (no button to nowhere)', (t) async {
      final ex = FakeExtraApi()..offers = const OffersInfo(hidden: true);
      await pumpRoutedB(t, const OffersScreen(), api: FakeApi(), extraApi: ex);
      await settleB(t);
      expect(find.byKey(const Key('offers-hidden')), findsOneWidget);
      expect(find.byKey(const Key('offers-active-job')), findsNothing);
    });
  });

  group('Wallet wording (E18)', () {
    testWidgets('no approval / review / settlement wording; earnings arrive automatically; "on hold" = an open complaint', (t) async {
      await pumpRoutedB(t, const WalletScreen(), api: FakeApi());
      await settleB(t);
      expect(find.textContaining(RegExp('approv|review|settle|pending payment', caseSensitive: false)), findsNothing);
      expect(find.byKey(const Key('wallet-auto-note')), findsOneWidget);
      expect(find.textContaining('automatically when a job ends'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('wallet-on-hold')), matching: find.text('On hold')), findsOneWidget);
      expect(find.textContaining('complaint about a job is open'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('wallet-in-withdrawal')), matching: find.text('Withdrawal requested')), findsOneWidget);
      expect(find.byKey(const Key('withdraw')), findsOneWidget, reason: 'withdrawals stay');
    });

    testWidgets('the held-by-complaint amount is the overview\'s pendingCents', (t) async {
      final api = FakeApi()..overviewResult = _overview(pending: 7550);
      await pumpRoutedB(t, const WalletScreen(), api: api);
      await settleB(t);
      expect(find.descendant(of: find.byKey(const Key('wallet-on-hold')), matching: find.text('SAR 75.50')), findsOneWidget);
    });

    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang uses its own words for the on-hold figure', (t) async {
        await pumpRoutedB(t, const WalletScreen(), api: FakeApi(), lang: lang);
        await settleB(t);
        expect(find.descendant(of: find.byKey(const Key('wallet-on-hold')), matching: find.text(strings(lang)('fmb.wallet_on_hold'))), findsOneWidget);
      });
    }
  });

  group('Profile → Support', () {
    testWidgets('a Support row opens the tickets; a dot shows when a ticket has news', (t) async {
      final ex = FakeExtraApi()..unread = [AppNotification(mkNotification('n1', 'ticket_reply', data: {'ref': 'TK-000007'}))];
      await pumpRoutedB(t, const ProfileScreen(), api: FakeApi(), extraApi: ex);
      await settleB(t);
      expect(find.text('Support'), findsOneWidget);
      expect(find.byKey(const Key('support-unread-dot')), findsOneWidget);
      await t.tap(find.text('Support'));
      await settleB(t);
      expect(find.text('PAGE:/support'), findsOneWidget);
    });

    testWidgets('no dot when nothing is new', (t) async {
      await pumpRoutedB(t, const ProfileScreen(), api: FakeApi(), extraApi: FakeExtraApi());
      await settleB(t);
      expect(find.byKey(const Key('support-unread-dot')), findsNothing);
    });
  });

  group('Offers tab badge (new-offer alerts)', () {
    Future<ProviderContainer> pumpShell(WidgetTester t, {FakeApi? api}) async {
      SharedPreferences.setMockInitialValues({'lang': 'en'});
      final prefs = await SharedPreferences.getInstance();
      t.view.physicalSize = const Size(900, 1900);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      final router = GoRouter(routes: [
        StatefulShellRoute.indexedStack(
          builder: (_, _, shell) => HomeShell(shell: shell),
          branches: [for (final p in ['/', '/jobs', '/offers', '/wallet', '/profile']) StatefulShellBranch(routes: [GoRoute(path: p, builder: (_, _) => const SizedBox())])],
        ),
      ]);
      await t.pumpWidget(ProviderScope(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api ?? FakeApi()), tokenStoreProvider.overrideWithValue(MemoryTokenStore())], child: MaterialApp.router(
        theme: buildTheme(), routerConfig: router,
        builder: (c, w) => Directionality(textDirection: TextDirection.ltr, child: StringsScope(strings: strings('en'), child: w!)),
      )));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      return ProviderScope.containerOf(t.element(find.byType(HomeShell)));
    }

    Badge badge(WidgetTester t) => t.widget<Badge>(find.byKey(const Key('offers-badge')));

    testWidgets('an alert puts a dot on the Offers tab; opening the tab clears it', (t) async {
      final c = await pumpShell(t);
      expect(badge(t).isLabelVisible, isFalse);
      c.read(offerAlertsProvider.notifier).raise(1, 'New job offer');
      await t.pump();
      expect(badge(t).isLabelVisible, isTrue);
      expect(badge(t).label, isNull, reason: 'a dot until the list has refreshed and has a count');
      await t.tap(find.text('Offers'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(c.read(offerAlertsProvider).unseen, 0, reason: 'looking at the Offers tab clears the alert');
      await t.tap(find.text('Today'));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(badge(t).isLabelVisible, isFalse);
    });

    testWidgets('with offers in the list the badge shows their count', (t) async {
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept']), mkJob(status: 'offered', actions: ['accept'])];
      await pumpShell(t, api: api);
      await t.pump(const Duration(milliseconds: 100));
      expect(badge(t).isLabelVisible, isTrue);
      expect(find.descendant(of: find.byKey(const Key('offers-badge')), matching: find.text('2')), findsOneWidget);
    });
  });
}

class _FailingOffersInfo extends FakeExtraApi {
  @override
  Future<OffersInfo> offersInfo() async => throw ApiException('NETWORK', 'x');
  @override
  Future<OffersInfo> opportunitiesInfo() async => throw ApiException('NETWORK', 'x');
}
