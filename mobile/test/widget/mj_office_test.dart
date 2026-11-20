import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import 'mj_shipments_test.dart' as m;

// Platform update J, worker MJ (J4) — a driver of an office has no wallet and sees no earnings; the cash he holds stays visible. A direct driver is unchanged.

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Json cashBlock() => {'outstandingCents': 150000, 'orders': 2};
Overview officeOverview({String? officeName = 'Al Noor Couriers'}) => Overview({
      'availability': 'available', 'verificationStatus': 'verified', 'newOffers': 1, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': true,
      'wallet': null, 'walletManagedByOffice': true, 'officeName': officeName, 'cash': cashBlock(),
    });
Overview directOverview() => Overview({'availability': 'available', 'verificationStatus': 'verified', 'newOffers': 0, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': false, 'wallet': {'availableCents': 12500, 'heldCents': 0, 'pendingCents': 4000}, 'cash': cashBlock()});

/// `GET /wallet` as an office driver gets it (D): managed, no figures, no entries.
class OfficeApi extends FakeApi {
  OfficeApi({String? officeName = 'Al Noor Couriers', bool overviewKnows = true}) {
    if (overviewKnows) overviewResult = officeOverview(officeName: officeName);
  }
  int walletCalls = 0;
  @override
  Future<Json> wallet() async { walletCalls++; return {'managedByOffice': true, 'availableCents': null, 'reservedCents': null, 'heldCents': null, 'entries': [], 'total': 0, 'page': 1, 'pageSize': 25}; }
}

class OppApi extends FakeApi {
  @override
  Future<List<Map<String, dynamic>>> opportunities() async => [
        {'requestId': 'r1', 'service': 'delivery_driver', 'startsAt': '2026-12-01T06:00:00.000Z', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'expectedUnits': 25, 'expectedEarningCents': 13750, 'openSlots': 2, 'allowPartial': true},
      ];
}

final cash = CashSummary({
  'collectedCents': 200000, 'receivedCents': 50000, 'outstandingCents': 150000,
  'orders': [{'offerId': 'o1', 'ref': 'JR-000042', 'businessName': 'Nakheel Fresh Foods', 'parcels': 2, 'collectedCents': 200000, 'receivedCents': 50000, 'outstandingCents': 150000, 'lastCollectedAt': '2026-12-01T06:00:00.000Z'}],
  'recent': [],
});

void main() {
  group('wallet screen of an office driver', () {
    for (final (lang, title, managed, officePill) in const [
      ('en', 'Wallet & cash', 'Your wallet is managed by your office', 'Office: Al Noor Couriers'),
      ('ar', 'المحفظة والنقد', 'محفظتك يديرها مكتبك', 'المكتب: Al Noor Couriers'),
      ('ur', 'والٹ اور نقد', 'آپ کا والٹ آپ کا دفتر سنبھالتا ہے', 'دفتر: Al Noor Couriers'),
    ]) {
      testWidgets('$lang: the calm card with the office name, no balance, no withdrawal — and the cash section as usual', (t) async {
        final api = OfficeApi();
        await pumpScreen(t, const WalletScreen(), api: api, lang: lang, extra: extraOverrides(api: FakeExtraApi()..cashResult = cash));
        await settle(t);
        expect(find.text(title), findsOneWidget); // the app bar
        expect(find.byKey(const Key('wallet-managed')), findsOneWidget);
        expect(find.text(managed), findsOneWidget);
        expect(find.text(officePill), findsOneWidget);
        expect(find.byKey(const Key('wallet-managed-hint')), findsOneWidget);
        // no wallet figures at all
        for (final k in ['wallet-available', 'wallet-on-hold', 'wallet-in-withdrawal', 'withdraw']) { expect(find.byKey(Key(k)), findsNothing, reason: k); }
        // the cash stays: with me, collected, handed over, by order
        expect(find.byKey(const Key('wallet-cash-section')), findsOneWidget);
        expect(t.widget<Text>(find.byKey(const Key('cash-with-me-amount'))).data, lang == 'en' ? 'SAR 1,500.00' : '1,500.00 ر.س');
        expect(find.byKey(const Key('cash-collected')), findsOneWidget);
        expect(find.byKey(const Key('cash-received')), findsOneWidget);
        expect(find.byKey(const Key('cash-order-o1')), findsOneWidget);
        expect(api.walletCalls, lessThanOrEqualTo(1), reason: 'at most the first load (before the overview answered) asks for the wallet');
      });
    }

    testWidgets('without the office name the hint is generic', (t) async {
      await pumpScreen(t, const WalletScreen(), api: OfficeApi(officeName: null), extra: extraOverrides());
      await settle(t);
      expect(find.byKey(const Key('wallet-managed-office')), findsNothing);
      expect(find.text('Ask your office about your pay or payouts.'), findsOneWidget);
    });

    testWidgets('the wallet endpoint alone is enough (an overview from an older server does not say it): managed, with the office name from the wallet', (t) async {
      final api = _WalletOnlyApi();
      await pumpScreen(t, const WalletScreen(), api: api, extra: extraOverrides(api: FakeExtraApi()..cashResult = cash));
      await settle(t);
      expect(find.byKey(const Key('wallet-managed')), findsOneWidget);
      expect(find.text('Office: Gulf Express'), findsOneWidget);
      expect(find.byKey(const Key('withdraw')), findsNothing);
      expect(find.byKey(const Key('cash-with-me-amount')), findsOneWidget);
    });

    testWidgets('a direct driver is unchanged: balance, on hold, withdraw — no managed card, no cash section', (t) async {
      final api = FakeApi()..overviewResult = directOverview();
      await pumpScreen(t, const WalletScreen(), api: api, extra: extraOverrides());
      await settle(t);
      expect(find.byKey(const Key('wallet-managed')), findsNothing);
      expect(find.byKey(const Key('wallet-cash-section')), findsNothing);
      expect(t.widget<Text>(find.byKey(const Key('wallet-available'))).data, 'SAR 125.00');
      expect(find.byKey(const Key('withdraw')), findsOneWidget);
      expect(find.text('Earnings'), findsOneWidget);
    });

    testWidgets('pull to refresh reloads the cash of an office driver', (t) async {
      final extra = FakeExtraApi()..cashResult = cash;
      await pumpScreen(t, const WalletScreen(), api: OfficeApi(), extra: extraOverrides(api: extra));
      await settle(t);
      final before = extra.calls.where((c) => c == 'cash').length;
      await t.fling(find.byType(ListView).first, const Offset(0, 500), 1500);
      await settle(t);
      await settle(t);
      expect(extra.calls.where((c) => c == 'cash').length, greaterThan(before));
    });
  });

  group('Today', () {
    testWidgets('an office driver: no wallet tiles (on hold / available), a calm "managed by your office" line, his cash card stays', (t) async {
      await pumpScreen(t, const TodayScreen(), api: OfficeApi(), extra: extraOverrides());
      await settle(t);
      expect(find.text('Available balance'), findsNothing);
      expect(find.text('On hold'), findsNothing);
      expect(find.byKey(const Key('wallet-managed-tile')), findsOneWidget);
      expect(find.byKey(const Key('cash-card')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('cash-card-amount'))).data, 'SAR 1,500.00');
    });

    testWidgets('a direct driver: both money tiles, no managed line', (t) async {
      final api = FakeApi()..overviewResult = directOverview();
      await pumpScreen(t, const TodayScreen(), api: api, extra: extraOverrides());
      await settle(t);
      expect(find.text('Available balance'), findsOneWidget);
      expect(find.text('SAR 125.00'), findsOneWidget);
      expect(find.text('On hold'), findsOneWidget);
      expect(find.byKey(const Key('wallet-managed-tile')), findsNothing);
    });
  });

  group('offers, order cards and the job page show no earnings for him', () {
    testWidgets('open requests (opportunities): no amount for an office driver, the amount for a direct driver', (t) async {
      await pumpScreen(t, const OffersScreen(), api: OppApi()..overviewResult = officeOverview(), extra: extraOverrides());
      await settle(t);
      await t.tap(find.text('Open requests'));
      await settle(t);
      expect(find.text('Up to 25 parcels in Riyadh'), findsOneWidget);
      expect(find.text('SAR 137.50'), findsNothing);
      await t.pumpWidget(const SizedBox());
      await pumpScreen(t, const OffersScreen(), api: OppApi()..overviewResult = directOverview(), extra: extraOverrides());
      await settle(t);
      await t.tap(find.text('Open requests'));
      await settle(t);
      expect(find.text('SAR 137.50'), findsOneWidget);
    });

    testWidgets('a completed job: no "earnings added to your wallet" wording for an office driver — the office handles payment', (t) async {
      final job = mkManifestJob(status: 'completed', actions: [], stops: [mkStop(1, status: 'delivered')], extra: {'earningHidden': true, 'expectedEarningCents': null});
      final api = FakeApi()..jobResult = job;
      await pumpRouted(t, const JobDetailScreen(offerId: 'o1'), api: api);
      await settle(t);
      expect(find.text('Your delivery is confirmed. Your office handles the payment.'), findsOneWidget);
      expect(find.textContaining('wallet'), findsNothing);
      expect(find.textContaining('earning'), findsNothing);
      expect(find.text('Cash with me'), findsOneWidget);
      expect(find.byKey(const Key('hint')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('hint'))).data, 'Job completed. Your office handles the payment.');
    });

    testWidgets('a completed job of a direct driver keeps the wallet wording and his expected earning', (t) async {
      final job = mkManifestJob(status: 'completed', actions: [], stops: [mkStop(1, status: 'delivered')]);
      await pumpRouted(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = job);
      await settle(t);
      expect(find.text('Your delivery is confirmed and your earnings were added to your wallet.'), findsOneWidget);
      expect(find.text('View wallet'), findsOneWidget);
    });

    testWidgets('the run sheet (routing off) of an office driver: finishing says the office handles the payment, no earning line', (t) async {
      final job = m.drsJob([m.ship(1, status: 'delivered')], actions: ['report_delivered'], extra: {'earningHidden': true, 'expectedEarningCents': null});
      await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = job);
      await settle(t);
      expect(find.text('Finishing confirms the delivery. Your office handles the payment.'), findsOneWidget);
      expect(find.textContaining('wallet'), findsNothing);
    });
  });
}

/// An older overview (no `walletManagedByOffice`) next to a wallet answer that says so and names the office.
class _WalletOnlyApi extends FakeApi {
  @override
  Future<Json> wallet() async => {'managedByOffice': true, 'officeName': 'Gulf Express', 'availableCents': null, 'entries': []};
}
