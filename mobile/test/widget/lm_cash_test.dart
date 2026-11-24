import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show ApiException, Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/cash/cash_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../helpers_lm.dart';

/// Update L / M — cash-risk limits in the app: the banner on Today and on the cash page, paused offers, CASH_LIMIT on accept / apply, CASH_OUTSTANDING and the
/// held-back part of the wallet on withdrawals, and how old each order's cash is.
Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }
Future<void> _show(WidgetTester t, Finder f) async { await t.ensureVisible(f); await t.pump(); }

Overview _overview(Json? cash, {int available = 12500}) => Overview({...FakeApi().overviewResult.j, 'cash': ?cash, 'wallet': {'availableCents': available, 'heldCents': 0, 'pendingCents': 0}});

class _OppApi extends FakeApi {
  @override
  Future<List<Json>> opportunities() async => [{'requestId': 'r7', 'service': 'delivery_driver', 'startsAt': '2026-12-01T06:00:00.000Z', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'openSlots': 2, 'expectedUnits': 12, 'allowPartial': true}];
}

String _text(WidgetTester t, Finder inside) => t.widgetList<Text>(find.descendant(of: inside, matching: find.byType(Text))).map((x) => x.data ?? '').join(' | ');

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('Today: the banner', () {
        testWidgets('near the limit (warn): amber, with the figures and the way to the cash page', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk());
          await pumpRoutedB(t, const TodayScreen(), api: api);
          await _settle(t);
          expect(find.byKey(const Key('cash-risk-banner')), findsOneWidget);
          expect(find.text('You are close to your cash limit'), findsOneWidget);
          expect(find.text('You hold SAR 2,400.00 in cash — 80% of your SAR 3,000.00 limit. Hand it over to the warehouse soon so new jobs keep coming.'), findsOneWidget);
          expect(find.text('Open “Cash with me”'), findsOneWidget);
          await t.tap(find.byKey(const Key('cash-risk-open')));
          await _settle(t);
          expect(find.text('PAGE:/cash'), findsOneWidget);
        });

        testWidgets('over the limit: red, and "paused" when the platform blocks offers', (t) async {
          for (final blocks in [false, true]) {
            final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'over_limit', blocks: blocks, reason: blocks ? 'limit' : null, outstanding: 320000));
            await pumpRoutedB(t, const TodayScreen(), api: api);
            await _settle(t);
            expect(find.text(blocks ? 'New jobs are paused — cash limit reached' : 'You are over your cash limit'), findsOneWidget, reason: 'blocks=$blocks');
            if (blocks) expect(find.textContaining('Jobs you already accepted keep running.'), findsOneWidget);
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('overdue: says how much, since how long, and that offers are paused', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 90000, days: 4, lien: 90000));
          await pumpRoutedB(t, const TodayScreen(), api: api);
          await _settle(t);
          expect(find.text('New jobs are paused — cash overdue'), findsOneWidget);
          expect(find.textContaining('SAR 900.00 of your cash has been with you for more than 3 days (the oldest for 4 days)'), findsOneWidget);
          expect(find.byKey(const Key('cash-risk-lien')), findsOneWidget);
          expect(find.text('SAR 900.00 of your wallet balance is held back and cannot be withdrawn until the overdue cash is handed over.'), findsOneWidget);
        });

        testWidgets('ok, no cash block (an older server) or limits off: no banner at all', (t) async {
          for (final cash in [mkCashRisk(state: 'ok', outstanding: 1000), null, {'outstandingCents': 5000, 'orders': 1}]) {
            final api = FakeApi()..overviewResult = _overview(cash);
            await pumpRoutedB(t, const TodayScreen(), api: api);
            await _settle(t);
            expect(find.byKey(const Key('cash-risk-banner')), findsNothing, reason: '$cash');
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('Arabic: the same banner in Arabic, right-to-left', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'over_limit', blocks: true, reason: 'limit', outstanding: 320000));
          await pumpRoutedB(t, const TodayScreen(), api: api, lang: 'ar');
          await _settle(t);
          expect(find.text('العروض الجديدة متوقفة — بلغت حدّ النقد'), findsOneWidget);
          expect(Directionality.of(t.element(find.byKey(const Key('cash-risk-banner')))), TextDirection.rtl);
          expect(find.textContaining('3,200.00 ر.س'), findsWidgets);
        });
      });

      group('the cash page', () {
        CashSummary summary() => CashSummary({
              'collectedCents': 300000, 'receivedCents': 60000, 'outstandingCents': 240000,
              'orders': [
                {'offerId': 'o1', 'ref': 'JR-000042', 'businessName': 'Nakheel', 'parcels': 3, 'collectedCents': 200000, 'receivedCents': 0, 'outstandingCents': 200000, 'lastCollectedAt': '2026-11-17T06:00:00Z', 'ageDays': 5},
                {'offerId': 'o2', 'ref': 'JR-000043', 'businessName': 'Oasis', 'parcels': 1, 'collectedCents': 40000, 'receivedCents': 0, 'outstandingCents': 40000, 'lastCollectedAt': '2026-11-21T06:00:00Z', 'ageDays': 1},
                {'offerId': 'o3', 'ref': 'JR-000040', 'businessName': 'Old', 'parcels': 1, 'collectedCents': 60000, 'receivedCents': 60000, 'outstandingCents': 0, 'lastCollectedAt': '2026-11-10T06:00:00Z', 'ageDays': null},
              ],
              'recent': [],
            });

        testWidgets('the full banner: the share of the limit, the two steps, and the age of each order\'s cash (overdue ones tagged)', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 200000, days: 5, pct: 80));
          await pumpRoutedB(t, const CashScreen(), api: api, extraApi: FakeExtraApi()..cashResult = summary());
          await _settle(t);
          expect(find.byKey(const Key('cash-risk-banner')), findsOneWidget);
          expect(find.byKey(const Key('cash-risk-bar')), findsOneWidget);
          expect(find.text('80% of your SAR 3,000.00 limit'), findsOneWidget);
          expect(find.text('What to do'), findsOneWidget);
          expect(find.text('1. Take the cash to the warehouse of each order listed in “Cash with me”.'), findsOneWidget);
          expect(find.textContaining('2. The warehouse records “Receive money”'), findsOneWidget);
          await _show(t, find.byKey(const Key('cash-order-o1')));
          expect(find.byKey(const Key('cash-age-o1')), findsOneWidget);
          expect(t.widget<Text>(find.byKey(const Key('cash-age-o1'))).data, 'With you for 5 day(s)');
          expect(find.byKey(const Key('cash-overdue-o1')), findsOneWidget, reason: '5 days > the 3-day handover time');
          await _show(t, find.byKey(const Key('cash-order-o2')));
          expect(t.widget<Text>(find.byKey(const Key('cash-age-o2'))).data, 'With you for 1 day(s)');
          expect(find.byKey(const Key('cash-overdue-o2')), findsNothing);
          expect(find.byKey(const Key('cash-age-o3')), findsNothing, reason: 'nothing outstanding on that order');
        });

        testWidgets('no risk: no banner, no tags; an order\'s age is still shown', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'ok', outstanding: 100000));
          await pumpRoutedB(t, const CashScreen(), api: api, extraApi: FakeExtraApi()..cashResult = summary());
          await _settle(t);
          expect(find.byKey(const Key('cash-risk-banner')), findsNothing);
          await _show(t, find.byKey(const Key('cash-order-o1')));
          expect(find.byKey(const Key('cash-age-o1')), findsOneWidget);
          expect(find.byKey(const Key('cash-overdue-o1')), findsOneWidget, reason: 'the tag follows the platform\'s handover time');
        });
      });

      group('Offers: paused', () {
        OffersInfo paused({String reason = 'limit'}) => OffersInfo(cashBlocked: true, cash: CashRisk(mkCashRisk(state: reason == 'overdue' ? 'overdue' : 'over_limit', blocks: true, reason: reason, outstanding: 320000, overdue: 100000)));

        testWidgets('the server\'s {items: [], cashBlocked: true, cash} is a paused state with the way out — not "no offers"', (t) async {
          final api = FakeApi();
          await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: FakeExtraApi()..offers = paused());
          await _settle(t);
          expect(find.byKey(const Key('offers-paused')), findsOneWidget);
          expect(find.text('New offers are paused'), findsWidgets);
          expect(find.textContaining('You reached your cash limit. Hand the cash over to the warehouse'), findsOneWidget);
          expect(find.byKey(const Key('offers-paused-empty')), findsOneWidget);
          expect(find.text('No offers right now'), findsNothing);
          expect(find.textContaining('SAR 3,200.00'), findsOneWidget, reason: 'the figures from the server\'s cash block');
          await t.tap(find.byKey(const Key('offers-paused-cash')));
          await _settle(t);
          expect(find.text('PAGE:/cash'), findsOneWidget);
        });

        testWidgets('overdue cash says that instead; the open-requests tab is paused too', (t) async {
          await pumpRoutedB(t, const OffersScreen(), api: FakeApi(), extraApi: FakeExtraApi()..offers = paused(reason: 'overdue'));
          await _settle(t);
          expect(find.textContaining('Some of your cash is overdue.'), findsOneWidget);
          await t.tap(find.text('Open requests'));
          await _settle(t);
          expect(find.byKey(const Key('opps-paused-empty')), findsOneWidget);
        });

        testWidgets('the overview alone is enough to know (the offers calls may fail): blocksOffers pauses the page', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 100000));
          await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: FakeExtraApi());
          await _settle(t);
          expect(find.byKey(const Key('offers-paused')), findsOneWidget);
        });

        testWidgets('not blocked: the normal empty page', (t) async {
          await pumpRoutedB(t, const OffersScreen(), api: FakeApi(), extraApi: FakeExtraApi());
          await _settle(t);
          expect(find.byKey(const Key('offers-paused')), findsNothing);
          expect(find.text('No offers right now'), findsOneWidget);
        });
      });

      group('Offers: 403 CASH_LIMIT', () {
        ApiException cashLimit() => ApiException('CASH_LIMIT', 'x', status: 403, details: {'cash': mkCashRisk(state: 'over_limit', blocks: true, reason: 'limit', outstanding: 320000)});

        Future<void> acceptFlow(WidgetTester t, FakeApi api, {String key = 'accept-o1'}) async {
          await t.tap(find.byKey(Key(key)));
          await _settle(t);
          await t.tap(find.byKey(const Key('terms-check')));
          await t.pump();
          await t.tap(find.byKey(const Key('confirm-accept')));
          await _settle(t);
        }

        testWidgets('accepting a job while over the limit: a dialog with the reason and the figures, and the way to the cash page', (t) async {
          final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
          await pumpRoutedB(t, const OffersScreen(), api: api);
          await _settle(t);
          api.errorOnNext = cashLimit();
          await acceptFlow(t, api);
          expect(find.byKey(const Key('cash-limit-dialog')), findsOneWidget);
          expect(find.text('New offers are paused'), findsWidgets);
          expect(find.textContaining('New jobs are paused while you hold too much cash'), findsOneWidget);
          expect(find.byKey(const Key('cash-limit-detail')), findsOneWidget);
          expect(t.widget<Text>(find.byKey(const Key('cash-limit-detail'))).data, contains('SAR 3,200.00'));
          expect(find.textContaining('went wrong'), findsNothing, reason: 'not the generic error');
          await t.tap(find.byKey(const Key('cash-limit-open')));
          await _settle(t);
          expect(find.text('PAGE:/cash'), findsOneWidget);
        });

        testWidgets('applying for an open request: the same', (t) async {
          final api = _OppApi();
          await pumpRoutedB(t, const OffersScreen(), api: api);
          await _settle(t);
          await t.tap(find.text('Open requests'));
          await _settle(t);
          api.errorOnNext = cashLimit();
          await acceptFlow(t, api, key: 'apply-r7');
          expect(find.byKey(const Key('cash-limit-dialog')), findsOneWidget);
          await t.tap(find.text('Close'));
          await _settle(t);
          expect(find.byKey(const Key('cash-limit-dialog')), findsNothing);
          expect(find.text('PAGE:/cash'), findsNothing);
        });

        testWidgets('other errors keep their own toast (no cash dialog)', (t) async {
          final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
          await pumpRoutedB(t, const OffersScreen(), api: api);
          await _settle(t);
          api.errorOnNext = ApiException('CONFLICT', 'x', status: 409);
          await acceptFlow(t, api);
          expect(find.byKey(const Key('cash-limit-dialog')), findsNothing);
        });
      });

      group('Wallet: the part held back by overdue cash', () {
        Future<FakeApi> openWallet(WidgetTester t, {int lien = 5000, int available = 12500}) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 5000, lien: lien), available: available);
          await pumpRoutedB(t, const WalletScreen(), api: api);
          await _settle(t);
          return api;
        }

        testWidgets('says how much is held back and how much can go out now; Withdraw offers only that', (t) async {
          final api = await openWallet(t);
          expect(find.byKey(const Key('wallet-lien')), findsOneWidget);
          expect(find.textContaining('SAR 50.00 of your wallet balance is held back'), findsOneWidget);
          expect(find.textContaining('You can withdraw SAR 75.00 now'), findsOneWidget);
          await t.tap(find.byKey(const Key('withdraw')));
          await _settle(t);
          expect(find.textContaining('≤ SAR 75.00'), findsOneWidget);
          await t.enterText(find.byKey(const Key('amount')), '80');
          await t.pump();
          expect(t.widget<FilledButton>(find.byKey(const Key('withdraw-submit'))).onPressed, isNull, reason: 'SAR 80 is more than the 75 that can go out');
          await t.enterText(find.byKey(const Key('amount')), '75');
          await t.pump();
          await t.tap(find.byKey(const Key('withdraw-submit')));
          await _settle(t);
          expect(api.calls, contains('withdraw:7500'));
        });

        testWidgets('everything held back: nothing to withdraw, and the page says why', (t) async {
          await openWallet(t, lien: 12500);
          expect(t.widget<FilledButton>(find.byKey(const Key('withdraw'))).onPressed, isNull);
          expect(find.textContaining('You can withdraw SAR 0.00 now'), findsOneWidget);
        });

        testWidgets('no lien: no banner, the full balance', (t) async {
          final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'ok', outstanding: 1000, lien: 0));
          await pumpRoutedB(t, const WalletScreen(), api: api);
          await _settle(t);
          expect(find.byKey(const Key('wallet-lien')), findsNothing);
          await t.tap(find.byKey(const Key('withdraw')));
          await _settle(t);
          expect(find.textContaining('≤ SAR 125.00'), findsOneWidget);
        });

        testWidgets('the server\'s 409 CASH_OUTSTANDING (the app was a step behind): a dialog with the maximum and the held-back amount, and the cash page', (t) async {
          final api = FakeApi()..overviewResult = _overview(null);
          await pumpRoutedB(t, const WalletScreen(), api: api);
          await _settle(t);
          await t.tap(find.byKey(const Key('withdraw')));
          await _settle(t);
          await t.enterText(find.byKey(const Key('amount')), '100');
          await t.pump();
          api.errorOnNext = ApiException('CASH_OUTSTANDING', 'x', status: 409, details: {'availableCents': 12500, 'overdueCents': 5000, 'maxCents': 7500});
          await t.tap(find.byKey(const Key('withdraw-submit')));
          await _settle(t);
          expect(find.byKey(const Key('cash-outstanding-dialog')), findsOneWidget);
          expect(t.widget<Text>(find.byKey(const Key('cash-outstanding-text'))).data, 'You can withdraw at most SAR 75.00 right now. SAR 50.00 is held back because it is overdue cash.');
          await t.tap(find.byKey(const Key('cash-outstanding-open')));
          await _settle(t);
          expect(find.text('PAGE:/cash'), findsOneWidget);
        });
      });
    });
  }

  group('texts in Arabic and Urdu', () {
    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang: the paused page and the held-back wallet read right-to-left without overflow at 1.4x', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final api = FakeApi()..overviewResult = _overview(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 5000, lien: 5000, days: 4));
        await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: FakeExtraApi()..offers = OffersInfo(cashBlocked: true, cash: CashRisk(mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', overdue: 5000))), lang: lang, size: const Size(640, 1200));
        await _settle(t);
        expect(find.byKey(const Key('offers-paused')), findsOneWidget);
        expect(_text(t, find.byKey(const Key('offers-paused'))), isNot(contains('{')));
        expect(Directionality.of(t.element(find.byKey(const Key('offers-paused')))), TextDirection.rtl);
        expect(t.takeException(), isNull);
        await t.pumpWidget(const SizedBox());
        await pumpRoutedB(t, const WalletScreen(), api: api, lang: lang, size: const Size(640, 1200));
        await _settle(t);
        expect(find.byKey(const Key('wallet-lien')), findsOneWidget);
        expect(t.takeException(), isNull);
      });
    }
  });
}
