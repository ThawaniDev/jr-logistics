import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/shipment_card.dart';
import 'package:jr_driver/features/jobs/shipments_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import 'mj_shipments_test.dart' as m;

// Platform update J, worker MJ — nothing overflows: the shipment card (LTR + RTL, long names and addresses, three text scales, narrow phones), the run sheet,
// the stop sheet, the order cards with their stat cards, and the wallet of an office driver. Pattern of overflow_sweep_test.dart.

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

/// Pumps [screen] on a [width]-dp wide phone at [scale]x text, scrolls it from top to bottom, and fails on any layout exception.
Future<void> sweep(WidgetTester t, Widget screen, {required FakeApi api, required String lang, required double scale, double width = 320, FakeLinks? links, List<Override> extra = const []}) async {
  t.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
  await pumpScreen(t, screen, api: api, lang: lang, links: links, extra: extra);
  t.view.physicalSize = Size(width * 2, 1400);
  t.view.devicePixelRatio = 2;
  await settle(t);
  final errors = <String>[];
  void collect() { for (Object? e = t.takeException(); e != null; e = t.takeException()) { errors.add(e.toString().split('\n').first); } }
  collect();
  final list = find.byType(Scrollable);
  if (list.evaluate().isNotEmpty) {
    for (var i = 0; i < 10; i++) { await t.drag(list.first, const Offset(0, -420)); await t.pump(); collect(); }
  }
  expect(errors.toSet().toList(), isEmpty, reason: '${screen.runtimeType} / $lang / ${scale}x / ${width}dp');
}

final officeCash = CashSummary({
  'collectedCents': 9876543, 'receivedCents': 5000000, 'outstandingCents': 4876543,
  'orders': [{'offerId': 'o1', 'ref': 'JR-000042', 'businessName': 'Nakheel Fresh Foods and Dairy Products Company', 'parcels': 9, 'collectedCents': 9876543, 'receivedCents': 5000000, 'outstandingCents': 4876543, 'lastCollectedAt': '2026-12-01T06:00:00.000Z'}],
  'recent': [{'id': 'h1', 'ref': 'JR-000042', 'amountCents': 5000000, 'receivedByName': 'Warehouse manager with a long name', 'receivedByRole': 'business', 'note': 'Handed over at the gate', 'createdAt': '2026-12-01T06:00:00.000Z'}],
});

const _long = 'Abdulrahman Mohammed Al-Qahtani Al-Dossary bin Abdullah, Villa 12';
const _address = 'Prince Sultan Bin Abdulaziz Road, Al Olaya District, Building 4, Floor 2, Apartment 205, near the Kingdom Centre tower';

void main() {
  for (final lang in ['en', 'ar', 'ur']) {
    for (final scale in [1.0, 1.2, 1.4]) {
      group('$lang @ ${scale}x', () {
        testWidgets('shipment cards: long name/address/contents, big COD, business, next, postponed, delivered, failed, prepaid — 320 and 412 dp', (t) async {
          final stops = [
            m.ship(1, current: true, extra: {'recipientName': _long, 'address': _address, 'codCents': 123456789, 'paymentMode': 'cod', 'contents': 'Fragile glassware and ceramic dishes, handle with care', 'recipientType': 'business', 'pieces': 12}),
            m.ship(2, extra: {'deferCount': 1, 'recipientName': _long, 'address': _address, 'arrivedAt': null}),
            m.ship(3, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z', 'recipientName': 'Mona'}),
            m.ship(4, status: 'delivered', extra: {'recipientName': _long}),
            m.ship(5, status: 'failed', extra: {'failReason': 'refused', 'recipientName': _long, 'address': _address}),
            m.ship(6, status: 'returned'), m.ship(7, status: 'missing'), m.ship(8, status: 'pending'), m.ship(9, status: 'cancelled'),
            m.ship(10, extra: {'recipientName': null, 'recipientPhone': null, 'createdAt': null}),
          ];
          for (final width in [320.0, 412.0]) {
            await sweep(t, Scaffold(body: ListView(padding: const EdgeInsets.all(16), children: [
              for (final s in stops) Padding(padding: const EdgeInsets.only(bottom: 10), child: ShipmentCard(stop: Stop(s), lang: lang, isNext: s['id'] == 's1', onTap: () {}, onCall: () {}, onWhatsapp: () {})),
            ])), api: FakeApi(), lang: lang, scale: scale, width: width);
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('the run sheet (header with cash, chips, search open, cards) and its stop sheet — 320 dp', (t) async {
          final job = m.drsJob([
            m.ship(1, current: true, extra: {'recipientName': _long, 'address': _address, 'codCents': 5000, 'paymentMode': 'cod', 'notes': 'Second floor, blue door, ask for the manager', 'contents': 'Frozen food and dairy products'}),
            m.ship(2), m.ship(3, status: 'delivered'), m.ship(4, status: 'failed', extra: {'failReason': 'refused'}),
          ], extra: {'cod': {'toCollectCents': 123456700, 'collectedCents': 4000000, 'parcels': 9}});
          final api = FakeApi()..jobResult = job;
          await sweep(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang, scale: scale);
          // scrolled to the bottom, the filter bar is pinned at the top: open the search, then the sheet of the next shipment
          await t.tap(find.byKey(const Key('ship-search-toggle')));
          await settle(t);
          expect(t.takeException(), isNull);
          await t.tap(find.byKey(const Key('drs-next')));
          await settle(t);
          expect(find.byKey(const Key('shipment-sheet')), findsOneWidget);
          expect(t.takeException(), isNull);
          await t.pumpWidget(const SizedBox());
          // routing ON: the overview page of all shipments
          final on = mkManifestJob(stops: [m.ship(1, current: true, extra: {'recipientName': _long, 'address': _address}), m.ship(2)], extra: {'policy': mkPolicy()});
          await sweep(t, const ShipmentsScreen(offerId: 'o1'), api: FakeApi()..jobResult = on, lang: lang, scale: scale);
        });

        testWidgets('order cards with stat cards in every state — 320 dp', (t) async {
          Job mk(String status, {Json? summary, Json? extra}) => mkManifestJob(status: status, actions: [], stops: [], summary: summary ?? {'total': 0, 'pending': 0, 'loaded': 0, 'delivered': 0, 'failed': 0, 'returned': 0, 'missing': 0}, extra: {'expectedUnits': 12345, 'stops': null, 'loadedUnits': null, ...?extra});
          final cards = [
            mk('offered'), mk('accepted', extra: {'cod': mkCod(toCollect: 123456700, collected: 0, parcels: 3)}),
            mk('attendance_confirmed', summary: {'total': 20, 'pending': 0, 'loaded': 9, 'delivered': 8, 'failed': 2, 'returned': 1, 'missing': 0}, extra: {'cod': mkCod(toCollect: 123456700, collected: 4000000, parcels: 9)}),
            mk('completed', summary: {'total': 20, 'pending': 0, 'loaded': 0, 'delivered': 17, 'failed': 2, 'returned': 1, 'missing': 0}, extra: {'cod': {'toCollectCents': 0, 'collectedCents': 9876543, 'handedOverCents': 9876543, 'parcels': 9}, 'earningHidden': true}),
          ];
          await sweep(t, Scaffold(body: ListView(padding: const EdgeInsets.all(16), children: [for (final c in cards) Padding(padding: const EdgeInsets.only(bottom: 12), child: JobCard(job: c, lang: lang))])), api: FakeApi(), lang: lang, scale: scale);
        });

        testWidgets('the wallet of an office driver, and Today for him — 320 dp', (t) async {
          final api = _OfficeApi();
          final cash = extraOverrides(api: FakeExtraApi()..cashResult = officeCash);
          await sweep(t, const WalletScreen(), api: api, lang: lang, scale: scale, extra: cash);
          await t.pumpWidget(const SizedBox());
          await sweep(t, const TodayScreen(), api: api, lang: lang, scale: scale, extra: cash);
        });
      });
    }
  }
}

/// A driver of a courier office: no wallet, only cash.
class _OfficeApi extends FakeApi {
  _OfficeApi() {
    overviewResult = Overview({'availability': 'available', 'verificationStatus': 'verified', 'newOffers': 0, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': true, 'wallet': null, 'walletManagedByOffice': true, 'officeName': 'Al Noor Courier Services and Logistics Company', 'cash': {'outstandingCents': 150000, 'orders': 2}});
  }
  @override
  Future<Json> wallet() async => {'managedByOffice': true, 'availableCents': null, 'reservedCents': null, 'heldCents': null, 'entries': [], 'total': 0, 'page': 1, 'pageSize': 25};
}
