import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show ApiException, Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/shipment_card.dart';
import 'package:jr_driver/features/jobs/shipments_screen.dart';
import '../helpers.dart';

// Platform update J, worker MJ — the shipments screen ("DRS") with routing OFF: cards, filters, search, call / WhatsApp, the stop sheet, the bottom bar,
// 500 shipments, and that routing ON keeps the one-stop-at-a-time flow.

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

const _arrived = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null};
Json offPolicy() => {...mkPolicy(photo: false), 'routingEnabled': false};

/// A shipment as the server sends it with routing off: name and phone for every open one, plus payment mode, date and pieces.
Json ship(int n, {String status = 'loaded', bool current = false, Json? extra}) => mkStop(n, status: status, current: current, extra: {
      'recipientName': 'Recipient $n', 'recipientPhone': '+9665550${n.toString().padLeft(5, '0')}', 'createdAt': '2026-11-20T10:30:00.000Z', 'paymentMode': 'prepaid', 'pieces': 1, ...?extra,
    });

Job drsJob(List<Json> stops, {List<String>? actions, String status = 'attendance_confirmed', Json? extra}) =>
    mkManifestJob(status: status, actions: actions ?? ['work_stops', 'end_route'], stops: stops, extra: {'policy': offPolicy(), ...?extra});

Future<(FakeApi, FakeLinks)> open(WidgetTester t, Job job, {String lang = 'en', FakeApi? api}) async {
  final a = (api ?? FakeApi())..jobResult = job;
  final links = FakeLinks();
  await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, links: links, lang: lang);
  t.view.physicalSize = const Size(900, 3000); // a tall phone: the list builds lazily, so every card of a short test list is on screen
  await settle(t);
  return (a, links);
}

String code(int n) => 'JR-000042-${n.toString().padLeft(3, '0')}';
Finder card(int n) => find.byKey(Key('ship-card-${code(n)}'));
Future<void> tapKey(WidgetTester t, Key k) async { await t.ensureVisible(find.byKey(k)); await t.pump(); await t.tap(find.byKey(k)); await settle(t); }

void main() {
  group('routing OFF: the job page is the run sheet', () {
    final stops = [ship(1, current: true), ship(2), ship(3, status: 'delivered'), ship(4, status: 'failed', extra: {'failReason': 'refused'})];

    testWidgets('header counters + progress, one card per shipment, no route approval / map / one-at-a-time panel', (t) async {
      await open(t, drsJob(stops));
      expect(find.byKey(const Key('manifest-panel')), findsNothing);
      expect(find.byKey(const Key('approve-route')), findsNothing);
      expect(find.byKey(const Key('route-map-button')), findsNothing);
      expect(find.byKey(const Key('current-stop')), findsNothing);
      for (var n = 1; n <= 4; n++) { expect(card(n), findsOneWidget, reason: 'card $n'); }
      String v(String k) => t.widget<Text>(find.byKey(Key('$k-value'))).data!;
      expect([v('stat-total'), v('stat-to-deliver'), v('stat-delivered'), v('stat-not-delivered')], ['4', '2', '1', '1']);
      expect(find.text('2 of 4 shipments done'), findsOneWidget);
      expect(find.byKey(const Key('drs-hint')), findsNothing, reason: 'the guidance line is for a driver who has not done a shipment yet');
      expect(find.text('Delivery driver'), findsOneWidget);
    });

    testWidgets('a fresh run sheet has one line of guidance (any order works)', (t) async {
      await open(t, drsJob([ship(1, current: true), ship(2)]));
      expect(find.byKey(const Key('drs-hint')), findsOneWidget);
      expect(find.textContaining('Any order works'), findsOneWidget);
    });

    testWidgets('a card shows code, status, name, address, COD amount, payment mode, pieces, contents and the date', (t) async {
      await open(t, drsJob([ship(1, current: true, extra: {'codCents': 10000, 'paymentMode': 'cod', 'contents': 'Blue jacket'}), ship(2)]));
      final c1 = card(1);
      String txt(String k, int n) => (t.widget<Text>(find.byKey(Key('$k-${code(n)}'))).textSpan ?? TextSpan(text: t.widget<Text>(find.byKey(Key('$k-${code(n)}'))).data)).toPlainText();
      expect(find.descendant(of: c1, matching: find.text(code(1))), findsOneWidget);
      expect(find.descendant(of: c1, matching: find.text('Out for delivery')), findsOneWidget);
      expect(txt('ship-name', 1), 'Name: Recipient 1');
      expect(txt('ship-address', 1), 'Address: Street 1, Riyadh · Riyadh');
      expect(find.descendant(of: c1, matching: find.text('SAR 100.00')), findsOneWidget); // the highlighted COD amount
      expect(find.descendant(of: c1, matching: find.text('COD amount:')), findsOneWidget);
      expect(txt('ship-payment', 1), 'Payment mode: COD');
      expect(txt('ship-pieces', 1), 'Pieces: 1');
      expect(txt('ship-contents', 1), 'Contents: Blue jacket');
      expect(find.descendant(of: c1, matching: find.text('20 Nov 2026')), findsOneWidget);
      // a prepaid parcel: SAR 0.00 and "Prepaid"
      expect(txt('ship-payment', 2), 'Payment mode: Prepaid');
      expect(find.descendant(of: card(2), matching: find.text('SAR 0.00')), findsOneWidget);
      // only the first open one carries the "Next" tag
      expect(find.byKey(Key('ship-next-${code(1)}')), findsOneWidget);
      expect(find.byKey(Key('ship-next-${code(2)}')), findsNothing);
    });

    testWidgets('chips filter the list and carry their counts; All brings everything back', (t) async {
      await open(t, drsJob(stops));
      expect(find.text('All 4'), findsOneWidget);
      expect(find.text('To deliver 2'), findsOneWidget);
      expect(find.text('Delivered 1'), findsOneWidget);
      expect(find.text('Not delivered 1'), findsOneWidget);
      await tapKey(t, const Key('ship-filter-delivered'));
      expect([card(1).evaluate().isEmpty, card(2).evaluate().isEmpty, card(3).evaluate().isEmpty, card(4).evaluate().isEmpty], [true, true, false, true]);
      await tapKey(t, const Key('ship-filter-not_delivered'));
      expect([card(3).evaluate().isEmpty, card(4).evaluate().isEmpty], [true, false]);
      await tapKey(t, const Key('ship-filter-to_deliver'));
      expect([card(1).evaluate().isEmpty, card(2).evaluate().isEmpty, card(3).evaluate().isEmpty], [false, false, true]);
      await tapKey(t, const Key('ship-filter-all'));
      for (var n = 1; n <= 4; n++) { expect(card(n), findsOneWidget); }
    });

    testWidgets('search by name, phone digits and code; no match shows an empty state with a way back', (t) async {
      await open(t, drsJob(stops));
      await tapKey(t, const Key('ship-search-toggle'));
      Future<void> type(String q) async { await t.enterText(find.byKey(const Key('ship-search')), q); await settle(t); }
      await type('recipient 2');
      expect([card(1).evaluate().isEmpty, card(2).evaluate().isEmpty], [true, false]);
      await type('000003'); // part of the phone number +966555000003
      expect([card(2).evaluate().isEmpty, card(3).evaluate().isEmpty], [true, false]);
      await type(code(4));
      expect([card(3).evaluate().isEmpty, card(4).evaluate().isEmpty], [true, false]);
      await type('nobody');
      expect(find.byKey(const Key('ship-empty')), findsOneWidget);
      await tapKey(t, const Key('ship-clear'));
      for (var n = 1; n <= 4; n++) { expect(card(n), findsOneWidget); }
      expect(t.widget<TextField>(find.byKey(const Key('ship-search'))).controller!.text, '');
    });

    testWidgets('finished cards are dimmed but still shown', (t) async {
      await open(t, drsJob(stops));
      Finder dimmed(int n) => find.ancestor(of: card(n), matching: find.byType(Opacity));
      expect([dimmed(1).evaluate().isEmpty, dimmed(2).evaluate().isEmpty, dimmed(3).evaluate().isEmpty, dimmed(4).evaluate().isEmpty], [true, true, false, false]);
    });
  });

  group('call, WhatsApp and the stop sheet (routing OFF: any shipment, any order)', () {
    final stops = [ship(1, current: true), ship(2, extra: {'canDefer': true}), ship(3, status: 'delivered')];

    testWidgets('the round buttons call tel: and open the WhatsApp message of THAT shipment, not only the first one', (t) async {
      final (api, links) = await open(t, drsJob(stops));
      await tapKey(t, Key('ship-call-${code(2)}'));
      expect(links.called, ['+966555000002']);
      await tapKey(t, Key('ship-whatsapp-${code(2)}'));
      expect(api.calls, contains('wa:contact:en:s2'));
      expect(links.opened.single.toString(), 'https://wa.me/966555555555?text=hi');
    });

    testWidgets('a finished shipment has greyed buttons that do nothing', (t) async {
      final (api, links) = await open(t, drsJob(stops));
      await t.tap(find.byKey(Key('ship-call-${code(3)}')), warnIfMissed: false);
      await t.tap(find.byKey(Key('ship-whatsapp-${code(3)}')), warnIfMissed: false);
      await settle(t);
      expect(links.called, isEmpty);
      expect(api.calls.where((c) => c.startsWith('wa:')), isEmpty);
    });

    testWidgets('tap a NON-first shipment: arrive, then deliver with its code — the server is called for that stop', (t) async {
      final (api, _) = await open(t, drsJob(stops));
      await t.tap(card(2));
      await settle(t);
      expect(find.byKey(const Key('shipment-sheet')), findsOneWidget);
      expect(find.byKey(const Key('sheet-locked')), findsNothing);
      expect(find.byKey(const Key('sheet-arrive')), findsOneWidget);
      expect(find.byKey(const Key('sheet-deliver')), findsNothing);
      // the server answers the next read with the stop arrived
      api.jobResult = drsJob([ship(1, current: true), ship(2, extra: {..._arrived, 'canDefer': true}), ship(3, status: 'delivered')]);
      await t.tap(find.byKey(const Key('sheet-arrive')));
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('arrive:s2')), hasLength(1));
      expect(find.byKey(const Key('sheet-deliver')), findsOneWidget);
      expect(find.byKey(const Key('sheet-arrive')), findsNothing);
      expect(find.byKey(const Key('sheet-postpone')), findsOneWidget);
      await t.tap(find.byKey(const Key('sheet-deliver')));
      await settle(t);
      await t.enterText(find.byKey(const Key('parcel-code')), code(2));
      await t.enterText(find.byKey(const Key('otp-code')), '1234');
      await t.pump();
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls.where((c) => c.startsWith('deliver:s2:${code(2)}:1234')), hasLength(1));
    });

    testWidgets('can\'t deliver and postpone work on a shipment that is not the first', (t) async {
      final (api, _) = await open(t, drsJob(stops));
      await t.tap(card(2));
      await settle(t);
      await t.tap(find.byKey(const Key('sheet-postpone')));
      await settle(t);
      await t.enterText(find.byKey(const Key('postpone-note')), 'Closed until noon');
      await t.pump();
      api.jobResult = drsJob([ship(1, current: true), ship(2, extra: {'deferCount': 1}), ship(3, status: 'delivered')]);
      await tapKey(t, const Key('postpone-submit'));
      expect(api.calls.where((c) => c.startsWith('defer:s2')), hasLength(1));
      expect(find.byKey(const Key('shipment-sheet')), findsNothing, reason: 'the sheet closes once the shipment was postponed');
      expect(find.descendant(of: card(2), matching: find.text('Postponed')), findsOneWidget);
    });

    testWidgets('the sheet: details, copy address and open in maps', (t) async {
      String? clipboard;
      t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async { if (call.method == 'Clipboard.setData') { clipboard = (call.arguments as Map)['text'] as String?; } return null; });
      addTearDown(() => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      final (_, links) = await open(t, drsJob([ship(1, current: true, extra: {'codCents': 5000, 'paymentMode': 'cod', 'notes': 'Second floor', 'lat': 24.7, 'lng': 46.7, 'located': true})]));
      await t.tap(card(1));
      await settle(t);
      expect(find.byKey(const Key('sheet-cod')), findsOneWidget);
      expect(find.byKey(const Key('sheet-notes')), findsOneWidget);
      expect(find.byKey(const Key('sheet-recipient')), findsOneWidget);
      await t.tap(find.byKey(const Key('sheet-navigate')));
      await settle(t);
      expect(links.opened.single.toString(), contains('destination=24.7,46.7'));
      await t.tap(find.byKey(const Key('sheet-copy')));
      await settle(t);
      expect(find.text('Copied'), findsOneWidget);
      expect(clipboard, 'Street 1, Riyadh · Riyadh');
    });

    testWidgets('a finished shipment opens a read-only sheet (result, no actions)', (t) async {
      await open(t, drsJob([ship(1, current: true), ship(2, status: 'failed', extra: {'failReason': 'refused'})]));
      await t.tap(card(2));
      await settle(t);
      expect(find.byKey(const Key('shipment-sheet')), findsOneWidget);
      expect(find.byKey(const Key('sheet-fail')), findsOneWidget);
      for (final k in ['sheet-arrive', 'sheet-deliver', 'sheet-cant', 'sheet-postpone']) { expect(find.byKey(Key(k)), findsNothing, reason: k); }
    });

    testWidgets('an older server that still answers STOP_LOCKED for a non-current stop: the error is shown, nothing breaks', (t) async {
      final api = FakeApi()..errorOnNext = ApiException('STOP_LOCKED', 'locked', status: 409);
      final (_, _) = await open(t, drsJob(stops), api: api);
      await tapKey(t, Key('ship-whatsapp-${code(2)}'));
      expect(find.text('Finish the current stop first.'), findsOneWidget);
    });
  });

  group('bottom bar', () {
    testWidgets('"Next shipment" opens the first shipment still to do', (t) async {
      await open(t, drsJob([ship(1, status: 'delivered'), ship(2), ship(3)]));
      expect(find.byKey(const Key('drs-left')), findsOneWidget);
      expect(find.text('2 left to deliver'), findsOneWidget);
      await tapKey(t, const Key('drs-next'));
      expect(find.byKey(const Key('shipment-sheet')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('sheet-code'))).data, code(2));
    });

    testWidgets('all shipments done: summary, return warning and "Finish route"; finishing sends delivered', (t) async {
      final (api, _) = await open(t, drsJob([ship(1, status: 'delivered'), ship(2, status: 'failed', extra: {'failReason': 'refused'})], actions: ['report_delivered']));
      expect(find.byKey(const Key('drs-next')), findsNothing);
      expect(find.text('1 delivered · 1 not delivered'), findsOneWidget);
      expect(find.byKey(const Key('return-warning')), findsOneWidget);
      await tapKey(t, const Key('finish'));
      expect(api.calls, contains('delivered:{}'));
    });

    testWidgets('a finished job: the run sheet is its result — completed card, rating, no bottom bar', (t) async {
      await open(t, drsJob([ship(1, status: 'delivered'), ship(2, status: 'failed')], status: 'completed', actions: []));
      expect(find.byKey(const Key('job-completed')), findsOneWidget);
      expect(find.byKey(const Key('rating')), findsOneWidget);
      expect(find.byKey(const Key('drs-bottom-bar')), findsNothing);
      expect(card(1), findsOneWidget);
    });

    testWidgets('the menu: end the route early, and the full job details page', (t) async {
      final (api, _) = await open(t, drsJob([ship(1, current: true), ship(2)]));
      await t.tap(find.byKey(const Key('drs-menu')));
      await settle(t);
      await t.tap(find.byKey(const Key('end-route')));
      await settle(t);
      await t.enterText(find.byKey(const Key('end-reason')), 'Vehicle broke down');
      await t.pump();
      await tapKey(t, const Key('end-submit'));
      expect(api.calls.where((c) => c.startsWith('endRoute:Vehicle broke down')), hasLength(1));
      await t.tap(find.byKey(const Key('drs-menu')));
      await settle(t);
      await t.tap(find.byKey(const Key('job-info')));
      await settle(t);
      expect(find.byKey(const Key('hint')), findsOneWidget, reason: 'the information page has the next-step card');
      expect(find.byKey(const Key('ship-scroll')), findsNothing);
    });
  });

  group('custody on the run sheet', () {
    testWidgets('an item still waiting for the driver\'s acknowledgement shows on the run sheet and can be acknowledged there; nothing is shown once it is', (t) async {
      final api = FakeApi()..custodyItems = [{'id': 'c1', 'itemType': 'thermal_bag', 'qty': 2, 'description': null, 'status': 'handed_over'}];
      await open(t, drsJob([ship(1, current: true)]), api: api);
      expect(find.byKey(const Key('custody')), findsOneWidget);
      await tapKey(t, const Key('ack-custody-c1'));
      expect(api.calls, contains('custody:c1'));
      await t.pumpWidget(const SizedBox());
      await open(t, drsJob([ship(1, current: true)]), api: FakeApi()..custodyItems = [{'id': 'c2', 'itemType': 'thermal_bag', 'qty': 1, 'description': null, 'status': 'acknowledged'}]);
      expect(find.byKey(const Key('custody')), findsNothing);
    });
  });

  group('states before the parcels are with the driver', () {
    testWidgets('counting the parcels (loading confirmation) and scan loading keep the guided job page, even with routing off', (t) async {
      await open(t, drsJob([ship(1), ship(2)], actions: ['ack_loading', 'dispute_loading'], extra: {'loadedAckByDriver': null, 'routeApprovedAt': null}));
      expect(find.byKey(const Key('ack')), findsOneWidget);
      expect(find.byKey(const Key('ship-scroll')), findsNothing);
      await t.pumpWidget(const SizedBox());
      await open(t, scanJob(total: 3, scanned: [1], extra: {'policy': offPolicy()}));
      expect(find.byKey(const Key('ship-scroll')), findsNothing);
    });

    testWidgets('routing OFF, mid-flow without route approval (job switched while under way): works straight away', (t) async {
      await open(t, drsJob([ship(1, current: true), ship(2)], extra: {'routeApprovedAt': null}));
      expect(find.byKey(const Key('ship-scroll')), findsOneWidget);
      expect(find.byKey(const Key('approve-route')), findsNothing);
    });
  });

  group('routing ON: exactly the one-stop-at-a-time flow', () {
    testWidgets('the stops panel stays; no run sheet on the job page; "All shipments" is an overview where only the current stop is open', (t) async {
      final job = mkManifestJob(stops: [ship(1, current: true), ship(2), ship(3)], extra: {'policy': mkPolicy()});
      expect(job.routingEnabled, isTrue);
      await open(t, job);
      expect(find.byKey(const Key('manifest-panel')), findsOneWidget);
      expect(find.byKey(const Key('current-stop')), findsOneWidget);
      expect(find.byKey(const Key('ship-scroll')), findsNothing);
      await tapKey(t, const Key('all-shipments'));
      expect(find.byKey(const Key('ship-scroll')), findsOneWidget);
      expect(find.byKey(const Key('drs-route')), findsOneWidget, reason: 'the route icon only while routing is on');
      expect(find.byType(ShipmentsScreen), findsOneWidget);
      await t.tap(card(2));
      await settle(t);
      expect(find.byKey(const Key('sheet-locked')), findsOneWidget);
      for (final k in ['sheet-arrive', 'sheet-deliver', 'sheet-cant']) { expect(find.byKey(Key(k)), findsNothing, reason: k); }
      // the call / WhatsApp circles of a locked shipment are inert
      expect(t.widget<RoundAction>(find.byKey(Key('ship-call-${code(2)}'))).onTap, isNull);
      expect(t.widget<RoundAction>(find.byKey(Key('ship-whatsapp-${code(2)}'))).onTap, isNull);
    });

    testWidgets('B2B off: the "Individual (B2C)" tag disappears from the stop (a business parcel that already exists keeps its tag); B2B on / unknown: as before', (t) async {
      final policy = {...mkPolicy(), 'b2bShipmentsEnabled': false};
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)], extra: {'policy': policy}));
      expect(find.text('Individual (B2C)'), findsNothing);
      await t.pumpWidget(const SizedBox());
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, type: 'business'), mkStop(2)], extra: {'policy': policy}));
      expect(find.text('Business (B2B)'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)], extra: {'policy': {...mkPolicy(), 'b2bShipmentsEnabled': true}}));
      expect(find.text('Individual (B2C)'), findsOneWidget);
    });

    testWidgets('an older server without policy.routingEnabled is treated as routing ON', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)]));
      expect(find.byKey(const Key('manifest-panel')), findsOneWidget);
      expect(find.byKey(const Key('ship-scroll')), findsNothing);
    });
  });

  group('1 to 500 shipments', () {
    testWidgets('one shipment', (t) async {
      await open(t, drsJob([ship(1, current: true)]));
      expect(card(1), findsOneWidget);
      expect(find.text('All 1'), findsOneWidget);
    });

    testWidgets('500 shipments are virtualised: a handful of cards is built, scrolling reaches the end, search finds one at once', (t) async {
      final many = [for (var n = 1; n <= 500; n++) ship(n, status: n <= 120 ? 'delivered' : 'loaded', current: n == 121)];
      await open(t, drsJob(many));
      expect(find.text('All 500'), findsOneWidget);
      expect(find.text('To deliver 380'), findsOneWidget);
      expect(find.byType(ShipmentCard).evaluate().length, lessThan(30), reason: 'only what is on screen (plus a little) is built');
      // scroll to the very end
      for (var i = 0; i < 60 && find.byKey(Key('ship-card-${code(500)}')).evaluate().isEmpty; i++) { await t.drag(find.byKey(const Key('ship-scroll')), const Offset(0, -3000)); await t.pump(); }
      expect(find.byKey(Key('ship-card-${code(500)}')), findsOneWidget);
      // the pinned filter bar is still there
      expect(find.byKey(const Key('ship-filter-all')), findsOneWidget);
      await tapKey(t, const Key('ship-search-toggle'));
      await t.enterText(find.byKey(const Key('ship-search')), code(437));
      await settle(t);
      expect(find.byType(ShipmentCard), findsOneWidget);
      expect(find.byKey(Key('ship-card-${code(437)}')), findsOneWidget);
      await t.enterText(find.byKey(const Key('ship-search')), '');
      await tapKey(t, const Key('ship-filter-delivered'));
      expect(find.byKey(Key('ship-card-${code(1)}')), findsOneWidget);
      expect(find.byKey(Key('ship-card-${code(121)}')), findsNothing);
    });
  });
}
