import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/cash/cash_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/jobs/route_map_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/support/new_ticket_screen.dart';
import 'package:jr_driver/features/support/support_screen.dart';
import 'package:jr_driver/features/support/ticket_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// Every Mobile-B screen, in every language, at the largest text size the app allows (1.4x) on a 320 dp wide phone — scrolled top to bottom.
/// Any RenderFlex overflow or other layout exception fails the test.
Future<void> _sweep(WidgetTester t, Widget screen, {required String lang, FakeApi? api, FakeExtraApi? ex, FakeNotifier? notifier, Map<String, Object> prefs = const {}, Finder? scroller, Future<void> Function()? afterLoad, String why = ''}) async {
  t.platformDispatcher.textScaleFactorTestValue = 1.4;
  addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
  await pumpRoutedB(t, screen, api: api ?? FakeApi(), extraApi: ex ?? FakeExtraApi(), lang: lang, size: const Size(640, 1400), notifier: notifier, prefsValues: prefs, picker: FakeAttachmentPicker(), actions: FakeMapActions(), location: FakeLocation(granted: false));
  await settleB(t);
  if (afterLoad != null) { await afterLoad(); await settleB(t); }
  final errors = <String>[];
  void collect() {
    for (Object? e = t.takeException(); e != null; e = t.takeException()) {
      // Name the offending row: its texts and its creator chain (the plain message only says "overflowed by N pixels").
      final where = <String>[];
      void walk(Element el) {
        final ro = el.renderObject;
        if (ro is RenderFlex && ro.hasSize) {
          var sum = 0.0;
          var c = ro.firstChild;
          while (c != null) { if (c.hasSize) sum += ro.direction == Axis.horizontal ? c.size.width : c.size.height; c = (c.parentData as FlexParentData).nextSibling; }
          final limit = ro.direction == Axis.horizontal ? ro.size.width : ro.size.height;
          if (sum > limit + 0.5) {
            final texts = <String>[];
            void tx(Element x) { final w = x.widget; if (w is Text && w.data != null) texts.add(w.data!); x.visitChildren(tx); }
            el.visitChildren(tx);
            where.add('${el.debugGetCreatorChain(5)} texts=${texts.take(3)}');
          }
        }
        el.visitChildren(walk);
      }
      t.binding.rootElement!.visitChildren(walk);
      errors.add('${e.toString().split('\n').first} @ ${where.take(2)}');
    }
  }
  collect();
  final list = scroller ?? find.byType(Scrollable);
  if (list.evaluate().isNotEmpty) {
    final scr = list.evaluate().first.widget is Scrollable ? list.first : find.descendant(of: list.first, matching: find.byType(Scrollable)).first;
    // Only scroll what can scroll: dragging a content-sized bottom sheet would dismiss it instead.
    if (t.state<ScrollableState>(scr).position.maxScrollExtent > 0) {
      for (var i = 0; i < 10; i++) { await t.drag(scr, const Offset(0, -450)); await t.pump(); collect(); }
    }
  }
  expect(errors.toSet().toList(), isEmpty, reason: '${screen.runtimeType} / $lang $why');
}

const _longAddress = 'Prince Mohammed bin Abdulaziz Street, Al Olaya District, Building 12, Floor 3, Office 305, near the old market';

Job _mapJob() => mkManifestJob(
      stops: [
        mkLegStop(1, current: true, legM: 20200, legS: 1620, extra: {'address': _longAddress, 'codCents': 123456789, 'notes': 'Call the security desk before entering the building and ask for the loading bay', 'canDefer': true}),
        mkLegStop(2, legM: 1800, legS: 300, extra: {'address': _longAddress}), mkStop(3, extra: {'address': _longAddress}),
      ],
      extra: {'route': mkRoute(extra: {'canReorder': true})},
    );

Json _ticket(String id, String status, {String priority = 'normal'}) => mkTicketRow(id, ref: 'TK-0000$id', status: status, priority: priority, category: 'shipment_count_differs', subject: 'The number of parcels handed over does not match what the warehouse recorded in the manifest');

void main() {
  for (final lang in ['en', 'ar', 'ur']) {
    group('$lang @ 1.4x text, 320 dp — Mobile-B screens', () {
      testWidgets('route map: list + the popup of the current stop and of another stop', (t) async {
        final api = FakeApi()..jobResult = _mapJob();
        await _sweep(t, const RouteMapScreen(offerId: 'o1'), lang: lang, api: api, scroller: find.byKey(const Key('map-list')), why: 'list');
        await t.pumpWidget(const SizedBox());
        for (final id in ['s1', 's2']) {
          await _sweep(t, const RouteMapScreen(offerId: 'o1'), lang: lang, api: api, scroller: find.byKey(const Key('map-popup')), why: 'popup $id', afterLoad: () async { await t.scrollUntilVisible(find.byKey(Key('map-row-$id')), 150, scrollable: find.descendant(of: find.byKey(const Key('map-list')), matching: find.byType(Scrollable)).first); await t.ensureVisible(find.byKey(Key('map-row-$id'))); await t.pump(); await t.tap(find.byKey(Key('map-row-$id'))); await settleB(t); expect(find.byKey(const Key('map-popup')), findsOneWidget); });
          await t.pumpWidget(const SizedBox());
        }
      });

      testWidgets('route map without any coordinates', (t) async {
        final api = FakeApi()..jobResult = mkManifestJob(stops: [mkStop(1, current: true, extra: {'address': _longAddress}), mkStop(2)]);
        await _sweep(t, const RouteMapScreen(offerId: 'o1'), lang: lang, api: api, scroller: find.byKey(const Key('map-list')));
      });

      testWidgets('cash with me: totals, orders, hand-overs', (t) async {
        final ex = FakeExtraApi()..cashResult = CashSummary({
          'collectedCents': 123456789, 'receivedCents': 100000, 'outstandingCents': 123356789,
          'orders': [{'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'businessName': 'Nakheel Fresh Foods and Dairy Trading Company', 'parcels': 12, 'collectedCents': 123456789, 'receivedCents': 100000, 'outstandingCents': 123356789, 'lastCollectedAt': '2026-12-01T06:00:00Z'}],
          'recent': [{'id': 'h1', 'ref': 'JR-000040', 'amountCents': 100000, 'receivedByName': 'Abdulrahman Al-Shamrani', 'receivedByRole': 'business', 'note': 'Counted together at the loading bay after the last delivery', 'createdAt': '2026-12-02T06:00:00Z'}],
        });
        await _sweep(t, const CashScreen(), lang: lang, ex: ex);
      });

      testWidgets('home: cash card, active-job card, notification prompt, on-hold figure', (t) async {
        final api = FakeApi()..overviewResult = Overview({...FakeApi().overviewResult.j, 'availability': 'available', 'cash': {'outstandingCents': 123456789, 'orders': 3}, 'activeJob': {'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'attendance_confirmed'}, 'wallet': {'availableCents': 123456789, 'heldCents': 0, 'pendingCents': 400000}});
        await _sweep(t, const TodayScreen(), lang: lang, api: api, notifier: FakeNotifier(permission: false), afterLoad: () async {
          for (final k in ['cash-card', 'active-job-card', 'notify-prompt']) { await t.scrollUntilVisible(find.byKey(Key(k)), 200, scrollable: find.byType(Scrollable).first); expect(find.byKey(Key(k)), findsOneWidget, reason: k); }
        });
      });

      testWidgets('offers with the "finish your job" banner', (t) async {
        final ex = FakeExtraApi()..offers = OffersInfo(hidden: true, activeJob: ActiveJobRef.fromJson({'offerId': 'o9', 'requestId': 'r9', 'ref': 'JR-000009', 'status': 'accepted'}));
        await _sweep(t, const OffersScreen(), lang: lang, ex: ex);
        expect(find.byKey(const Key('offers-hidden')), findsOneWidget);
      });

      testWidgets('notifications (unread + read, the "off in settings" banner) and wallet and profile', (t) async {
        final api = _NotifApi()..result = {'items': [
          mkNotification('n1', 'offer_new', data: {'ref': 'JR-000042', 'parcels': 120, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'}),
          mkNotification('n2', 'cod_received', data: {'ref': 'JR-000040', 'amountCents': 123456789}, readAt: '2026-12-01T08:00:00Z'),
          mkNotification('n3', 'ticket_reply_user', data: {'ref': 'TK-000007'}),
        ], 'unread': 2};
        await _sweep(t, const NotificationsScreen(), lang: lang, api: api, notifier: FakeNotifier(permission: false), prefs: {'notif_asked': true}, afterLoad: () async { expect(find.byKey(const Key('notify-off')), findsOneWidget); });
        await t.pumpWidget(const SizedBox());
        await _sweep(t, const WalletScreen(), lang: lang, api: FakeApi()..overviewResult = Overview({...FakeApi().overviewResult.j, 'wallet': {'availableCents': 123456789, 'heldCents': 5000000, 'pendingCents': 400000}}));
        await t.pumpWidget(const SizedBox());
        await _sweep(t, const ProfileScreen(), lang: lang, ex: FakeExtraApi()..unread = [AppNotification(mkNotification('n1', 'ticket_reply', data: {'ref': 'TK-000007'}))]);
      });

      testWidgets('support: list, new ticket (with a job and photos), thread (open, resolved in window, resolved too long ago)', (t) async {
        final ex = FakeExtraApi()..ticketList = [Ticket(_ticket('1', 'open')), Ticket(_ticket('2', 'in_review', priority: 'urgent')), Ticket(_ticket('3', 'resolved'))]
          ..unread = [AppNotification(mkNotification('n1', 'ticket_reply', data: {'ref': 'TK-0000' '1'}))];
        await _sweep(t, const SupportScreen(), lang: lang, ex: ex);
        await t.pumpWidget(const SizedBox());
        await _sweep(t, const NewTicketScreen(), lang: lang, api: FakeApi()..activeJobs = [mkJob()], afterLoad: () async {
          await t.tap(find.byKey(const Key('ticket-category')));
          await settleB(t);
          await t.tap(find.text(strings(lang)('ticket_cat.business_not_ready')).last);
          await settleB(t);
          for (var i = 0; i < 3; i++) {
            await t.scrollUntilVisible(find.byKey(const Key('att-add')), 200, scrollable: find.byType(Scrollable).first);
            await t.tap(find.byKey(const Key('att-add')));
            await settleB(t);
            await t.tap(find.byKey(const Key('att-source-camera')));
            await settleB(t);
          }
        });
        await t.pumpWidget(const SizedBox());
        for (final th in [mkThread(), mkThread(status: 'resolved', resolvedAt: DateTime.now().toUtc().subtract(const Duration(days: 2)).toIso8601String()), mkThread(status: 'resolved', resolvedAt: '2020-01-01T00:00:00Z', priority: 'urgent')]) {
          final e = FakeExtraApi()..threads[th.ticket.id] = th;
          await _sweep(t, TicketScreen(ticketId: th.ticket.id), lang: lang, ex: e, why: th.ticket.status);
          await t.pumpWidget(const SizedBox());
        }
      });
    });
  }
}

class _NotifApi extends FakeApi {
  Json result = {'items': [], 'unread': 0};
  @override
  Future<Json> notifications() async => result;
}
