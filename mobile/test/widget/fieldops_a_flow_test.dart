import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/geo.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/widgets/barcode_scanner.dart';
import '../helpers.dart';

// Mobile-A widget tests, part 1: warehouse arrival geofence, loading by scanning, camera scanner field, manual route order.

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<FakeApi> open(WidgetTester t, Job job, {FakeApi? api, FakeLocation? loc, FakeLinks? links, FakeBarcodeScanner? scanner, FakeEvidencePhotos? evidence, String lang = 'en'}) async {
  final a = (api ?? FakeApi())..jobResult = job;
  await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, location: loc, links: links, scanner: scanner, evidence: evidence, lang: lang);
  await settle(t);
  return a;
}

Future<void> show(WidgetTester t, Key k) async {
  final f = find.byKey(k);
  if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
  await Scrollable.ensureVisible(t.element(f), alignment: 0.5); // mid-screen: right under the app bar a tap can miss
  await t.pump();
}

Future<void> tapKey(WidgetTester t, Key k) async { await show(t, k); await t.tap(find.byKey(k)); await settle(t); }
int count(FakeApi a, String prefix) => a.calls.where((c) => c.startsWith(prefix)).length;

void main() {
  group('arrival at the warehouse (geofence, E1/E2)', () {
    final accepted = mkJob(status: 'accepted', actions: ['checkin', 'cancel'], extra: {'arrival': mkArrival(lat: 24.7028, lng: 46.7), 'ops': mkOps()});

    testWidgets('shows the live distance to the warehouse and how close to get', (t) async {
      await open(t, accepted);
      final d = distanceMeters(24.7, 46.7, 24.7028, 46.7).round();
      expect(find.text('$d m from the warehouse — get within 200 m'), findsOneWidget);
    });

    testWidgets('inside the allowed radius it says so', (t) async {
      await open(t, mkJob(status: 'accepted', actions: ['checkin'], extra: {'arrival': mkArrival(lat: 24.7005, lng: 46.7)}));
      final d = distanceMeters(24.7, 46.7, 24.7005, 46.7).round();
      expect(find.text("You're at the warehouse ($d m away, allowed 200 m). You can check in."), findsOneWidget);
    });

    testWidgets('without location permission the distance is not guessed, the driver is told to turn location on', (t) async {
      await open(t, accepted, loc: FakeLocation(granted: false));
      expect(find.text('Turn on location to see how far you are from the warehouse.'), findsOneWidget);
    });

    testWidgets('sends the GPS fix; a confirmed arrival (no warehouse confirmation needed) goes straight to loading', (t) async {
      final api = FakeApi()..checkInResult = {'status': 'attendance_confirmed'};
      await open(t, accepted, api: api);
      await tapKey(t, const Key('checkin'));
      expect(api.calls, contains('checkIn:24.7,46.7'));
      expect(find.text('Arrival confirmed. You can start loading.'), findsOneWidget);
    });

    testWidgets('an arrival the warehouse still has to confirm says so', (t) async {
      final api = FakeApi()..checkInResult = {'status': 'arrived'};
      await open(t, accepted, api: api);
      await tapKey(t, const Key('checkin'));
      expect(find.text('Arrival logged. Waiting for the warehouse to confirm it.'), findsOneWidget);
    });

    testWidgets('TOO_FAR_FROM_WAREHOUSE: the message carries the distance and the radius, and Try again re-sends', (t) async {
      final api = FakeApi();
      await open(t, accepted, api: api);
      api.errorOnNext = ApiException('TOO_FAR_FROM_WAREHOUSE', 'far', status: 422, details: {'distanceM': 340, 'radiusM': 200});
      await tapKey(t, const Key('checkin'));
      expect(find.byKey(const Key('checkin-too-far')), findsOneWidget);
      expect(find.text('You are 340 m from the warehouse. Get within 200 m and try again.'), findsOneWidget);
      expect(find.text('340 m from the warehouse — get within 200 m'), findsOneWidget, reason: 'the live line follows the server number');
      await tapKey(t, const Key('checkin-retry'));
      expect(count(api, 'checkIn:'), 2);
    });

    testWidgets('LOCATION_REQUIRED from the server: explains, offers Settings and a retry', (t) async {
      final links = FakeLinks();
      final api = FakeApi();
      await open(t, accepted, api: api, links: links);
      api.errorOnNext = ApiException('LOCATION_REQUIRED', 'gps', status: 422);
      await tapKey(t, const Key('checkin'));
      expect(find.byKey(const Key('checkin-location-required')), findsOneWidget);
      expect(find.text('Turn on location so we can confirm you are at the warehouse.'), findsOneWidget);
      await tapKey(t, const Key('checkin-settings'));
      expect(links.settingsOpened, 1);
      expect(find.byKey(const Key('checkin-retry')), findsOneWidget);
    });

    testWidgets('permission refused: nothing is sent, the guidance offers Open Settings; allowing it lets the next try through', (t) async {
      final links = FakeLinks();
      final loc = FakeLocation(granted: false);
      final api = FakeApi();
      await open(t, accepted, api: api, links: links, loc: loc);
      await tapKey(t, const Key('checkin'));
      expect(loc.permissionRequests, 1, reason: 'the tap asks for the permission');
      expect(count(api, 'checkIn:'), 0, reason: 'no GPS, no check-in: the warehouse checks the position');
      expect(find.byKey(const Key('checkin-denied')), findsOneWidget);
      expect(find.textContaining('Location permission is off'), findsOneWidget);
      await tapKey(t, const Key('checkin-settings'));
      expect(links.settingsOpened, 1);
      loc.granted = true; // the driver allowed it in Settings
      await tapKey(t, const Key('checkin-retry'));
      expect(api.calls, contains('checkIn:24.7,46.7'));
    });

    testWidgets('the OS prompt is answered "Allow": the check-in goes on without a second tap', (t) async {
      final api = FakeApi();
      await open(t, accepted, api: api, loc: FakeLocation(granted: false, grantOnRequest: true));
      await tapKey(t, const Key('checkin'));
      expect(api.calls, contains('checkIn:24.7,46.7'));
      expect(find.byKey(const Key('checkin-denied')), findsNothing);
    });

    testWidgets('no GPS fix: says so with a retry and sends nothing', (t) async {
      final api = FakeApi();
      await open(t, accepted, api: api, loc: FakeLocation(pos: null));
      await tapKey(t, const Key('checkin'));
      expect(find.byKey(const Key('checkin-nofix')), findsOneWidget);
      expect(count(api, 'checkIn:'), 0);
    });

    testWidgets('no geofence / no warehouse pin: never blocks, never prompts, position sent when there is one', (t) async {
      final loc = FakeLocation(granted: false);
      final api = FakeApi();
      await open(t, mkJob(status: 'accepted', actions: ['checkin']), api: api, loc: loc);
      expect(find.byKey(const Key('arrival-distance')), findsNothing);
      await tapKey(t, const Key('checkin'));
      expect(loc.permissionRequests, 0);
      expect(api.calls, contains('checkIn:null,null'));
    });

    testWidgets('a second tap while the check-in is running does not send a second one', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await open(t, accepted, api: api);
      await show(t, const Key('checkin'));
      await t.tap(find.byKey(const Key('checkin')));
      await t.pump();
      await t.tap(find.byKey(const Key('checkin')), warnIfMissed: false);
      await t.pump();
      expect(count(api, 'checkIn:'), 1);
      api.gate!.complete();
      await settle(t);
      expect(count(api, 'checkIn:'), 1);
    });
  });

  group('loading by scanning (E3/E4)', () {
    testWidgets('scan mode: progress, checklist and the scan hint — never "waiting for the warehouse to record the loading"', (t) async {
      await open(t, scanJob(total: 4, scanned: [1]));
      expect(find.byKey(const Key('loading-scan')), findsOneWidget);
      expect(find.text('1 of 4 scanned'), findsOneWidget);
      expect(find.text('Scan each parcel as you load it onto your vehicle, then tap Finish loading.'), findsOneWidget);
      expect(find.textContaining('hand you the parcels'), findsNothing);
      expect(find.byKey(const Key('ack')), findsNothing);
      expect(find.byKey(const Key('dispute')), findsNothing);
      expect(find.text('Not scanned yet (3)'), findsOneWidget);
      expect(find.text('Scanned (1)'), findsOneWidget);
      expect(find.byKey(const Key('scan-row-s2')), findsOneWidget);
      expect(find.byKey(const Key('job-stats')), findsNothing, reason: 'the scan panel has its own progress');
    });

    testWidgets('a typed code (or order reference) scans: feedback, progress and checklist update at once', (t) async {
      final api = FakeApi();
      seedBook(api, 4);
      await open(t, scanJob(), api: api);
      await show(t, const Key('scan-code'));
      await t.enterText(find.byKey(const Key('scan-code')), 'JR-000042-001');
      await t.pump();
      await t.tap(find.byKey(const Key('scan-add')));
      await settle(t);
      expect(api.calls, contains('scan:JR-000042-001'));
      expect(find.text('Scanned JR-000042-001 · 1 of 4'), findsOneWidget);
      expect(find.text('1 of 4 scanned'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('scan-code'))).controller!.text, '', reason: 'ready for the next parcel');
      expect(find.byKey(const Key('scan-undo-s1')), findsOneWidget, reason: 's1 moved to the scanned list');
      await t.enterText(find.byKey(const Key('scan-code')), 'ORD-2');
      await t.pump();
      await t.testTextInput.receiveAction(TextInputAction.done); // the keyboard's Done also submits
      await settle(t);
      expect(api.calls, contains('scan:ORD-2'));
      expect(find.text('2 of 4 scanned'), findsOneWidget);
    });

    testWidgets('scanning the same parcel again says "already scanned" and does not count twice', (t) async {
      final api = FakeApi();
      seedBook(api, 4);
      await open(t, scanJob(), api: api);
      for (final c in ['JR-000042-001', 'JR-000042-001']) {
        await show(t, const Key('scan-code'));
        await t.enterText(find.byKey(const Key('scan-code')), c);
        await t.pump();
        await t.tap(find.byKey(const Key('scan-add')));
        await settle(t);
      }
      expect(find.text('JR-000042-001 was already scanned'), findsOneWidget);
      expect(find.text('1 of 4 scanned'), findsOneWidget);
    });

    testWidgets('an unknown code and an incomplete parcel are explained', (t) async {
      final api = FakeApi();
      seedBook(api, 4);
      await open(t, scanJob(), api: api);
      await show(t, const Key('scan-code'));
      await t.enterText(find.byKey(const Key('scan-code')), 'NOPE-1');
      await t.pump();
      await t.tap(find.byKey(const Key('scan-add')));
      await settle(t);
      expect(find.text("That code isn't one of your parcels. Check the label and try again."), findsOneWidget);
      expect(find.text('0 of 4 scanned'), findsOneWidget);
      api.errorOnNext = ApiException('DETAILS_INCOMPLETE', 'x', status: 422, details: {'count': 1, 'codes': ['JR-000042-002']});
      await t.enterText(find.byKey(const Key('scan-code')), 'JR-000042-002');
      await t.pump();
      await t.tap(find.byKey(const Key('scan-add')));
      await settle(t);
      expect(find.text('This parcel has no recipient details yet. Ask the warehouse to complete them, then scan it again.'), findsOneWidget);
      expect(find.text('0 of 4 scanned'), findsOneWidget);
    });

    testWidgets('undo: a scanned parcel can be removed from the checklist', (t) async {
      final api = FakeApi();
      seedBook(api, 4, scanned: [1, 2]);
      await open(t, scanJob(scanned: [1, 2]), api: api);
      expect(find.text('2 of 4 scanned'), findsOneWidget);
      await tapKey(t, const Key('scan-undo-s1'));
      expect(api.calls, contains('unscan:JR-000042-001'));
      expect(find.text('1 of 4 scanned'), findsOneWidget);
      expect(find.byKey(const Key('scan-undo-s1')), findsNothing);
      expect(find.text('Not scanned yet (3)'), findsOneWidget);
    });

    testWidgets('the camera stays open and feeds every code: ok, already scanned, not mine', (t) async {
      final api = FakeApi();
      seedBook(api, 4);
      final scanner = FakeBarcodeScanner()..queue.addAll(['JR-000042-001', 'JR-000042-002', 'JR-000042-001', 'XYZ']);
      await open(t, scanJob(), api: api, scanner: scanner);
      await tapKey(t, const Key('scan-camera'));
      expect(scanner.opened.single.continuous, isTrue);
      expect([for (final v in scanner.verdicts) v.ok], [true, true, false, false]);
      expect(scanner.verdicts[2].warning, isTrue, reason: 'already scanned is a soft warning');
      expect(scanner.verdicts[0].message, 'Scanned JR-000042-001 · 1 of 4');
      expect(find.text('2 of 4 scanned'), findsOneWidget);
    });

    testWidgets('the camera button of the typing field fills it and scans', (t) async {
      final api = FakeApi();
      seedBook(api, 4);
      final scanner = FakeBarcodeScanner()..queue.add('JR-000042-003');
      await open(t, scanJob(), api: api, scanner: scanner);
      await tapKey(t, const Key('scan-code-scan'));
      expect(scanner.opened.single.continuous, isFalse);
      expect(api.calls, contains('scan:JR-000042-003'));
      expect(find.text('1 of 4 scanned'), findsOneWidget);
    });

    testWidgets('finish needs at least one scanned parcel', (t) async {
      await open(t, scanJob());
      await show(t, const Key('finish-loading'));
      expect(t.widget<FilledButton>(find.byKey(const Key('finish-loading'))).onPressed, isNull);
      expect(find.text('Scan at least one parcel to finish loading.'), findsOneWidget);
    });

    testWidgets('finish with parcels left: asks first (N go back to the pool), then plans the route and shows the review', (t) async {
      final api = FakeApi();
      seedBook(api, 4, scanned: [1, 2]);
      api.finishReleased = 2;
      api.jobAfterFinish = mkManifestJob(actions: ['approve_route', 'report_no_work'], stops: [mkStop(1), mkStop(2)], extra: {'routeApprovedAt': null, 'loading': mkLoading(assigned: 2, scanned: 2, finished: true), 'route': mkRoute(extra: {'canReorder': true})});
      await open(t, scanJob(scanned: [1, 2]), api: api);
      await tapKey(t, const Key('finish-loading'));
      expect(find.text('Finish loading?'), findsOneWidget);
      expect(find.text('2 parcels you did not scan go back to the warehouse pool. You will deliver the 2 you scanned.'), findsOneWidget);
      expect(api.calls, isNot(contains('finish-loading')));
      await t.tap(find.byKey(const Key('finish-loading-cancel')));
      await settle(t);
      expect(api.calls, isNot(contains('finish-loading')));
      await tapKey(t, const Key('finish-loading'));
      await t.tap(find.byKey(const Key('finish-loading-confirm')));
      await settle(t);
      expect(api.calls, contains('finish-loading'));
      expect(find.byKey(const Key('loading-scan')), findsNothing);
      expect(find.byKey(const Key('route-review')), findsOneWidget, reason: 'the route was planned: review it');
      await t.drag(find.byType(Scrollable).first, const Offset(0, 3000)); // back to the top: the next-step card
      await settle(t);
      expect(find.text('Review your route, then approve it to start delivering.'), findsOneWidget);
    });

    testWidgets('finish with everything scanned needs no confirmation', (t) async {
      final api = FakeApi();
      seedBook(api, 3, scanned: [1, 2, 3]);
      await open(t, scanJob(total: 3, scanned: [1, 2, 3]), api: api);
      expect(find.text('Every parcel is scanned.'), findsOneWidget);
      await tapKey(t, const Key('finish-loading'));
      expect(find.text('Finish loading?'), findsNothing);
      expect(api.calls, contains('finish-loading'));
    });

    testWidgets('warehouse mode keeps the old hand-over flow (driver acknowledges)', (t) async {
      final api = await open(t, mkManifestJob(actions: ['ack_loading', 'dispute_loading', 'report_no_work'], stops: [mkStop(1), mkStop(2)], extra: {'loadedAckByDriver': null, 'routeApprovedAt': null, 'loading': mkLoading(mode: 'warehouse')}));
      expect(find.byKey(const Key('loading-scan')), findsNothing);
      expect(find.byKey(const Key('ack')), findsOneWidget);
      expect(find.byKey(const Key('dispute')), findsOneWidget);
      await t.tap(find.byKey(const Key('ack')));
      await settle(t);
      expect(api.calls, contains('ack:true'));
    });

    testWidgets('scanning finished and the route is still being prepared: a calm line, no waiting-for-the-warehouse copy', (t) async {
      await open(t, mkManifestJob(actions: ['report_no_work'], stops: [mkStop(1), mkStop(2)], extra: {'routeApprovedAt': null, 'loading': mkLoading(assigned: 2, scanned: 2, finished: true)}));
      expect(find.text('Loading is finished. Your route is being prepared.'), findsOneWidget);
      expect(find.textContaining('hand you the parcels'), findsNothing);
    });
  });

  group('ScanField (camera button + manual typing)', () {
    Future<(FakeBarcodeScanner, TextEditingController)> pump(WidgetTester t, {ValueChanged<String>? onScanned}) async {
      final scanner = FakeBarcodeScanner();
      final c = TextEditingController();
      addTearDown(c.dispose);
      await pumpScreen(t, Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: ScanField(fieldKey: const Key('f'), controller: c, label: 'Parcel code', onScanned: onScanned))), api: FakeApi(), scanner: scanner);
      return (scanner, c);
    }

    testWidgets('a camera scan fills the field (trimmed) and reports it', (t) async {
      String? got;
      final (scanner, c) = await pump(t, onScanned: (v) => got = v);
      scanner.queue.add('  JR-000042-001\n');
      await t.tap(find.byKey(const Key('f-scan')));
      await t.pump();
      expect(c.text, 'JR-000042-001');
      expect(got, 'JR-000042-001');
      expect(scanner.opened.single.title, 'Parcel code');
    });

    testWidgets('cancelling the camera (or "type instead") leaves the text and focuses the field; typing always works', (t) async {
      final (scanner, c) = await pump(t);
      await t.enterText(find.byKey(const Key('f')), 'ABC');
      await t.tap(find.byKey(const Key('f-scan'))); // the fake camera sees nothing
      await t.pump();
      expect(scanner.opened.length, 1);
      expect(c.text, 'ABC');
      await t.enterText(find.byKey(const Key('f')), '١٢٣'); // Arabic-Indic digits are normalised
      expect(c.text, '123');
    });

    testWidgets('camera permission refused: the scanner explains, offers Open Settings and typing instead', (t) async {
      final links = FakeLinks();
      var typed = 0;
      await pumpScreen(t, Scaffold(body: ScanErrorView(denied: true, onType: () => typed++)), api: FakeApi(), links: links);
      expect(find.byKey(const Key('scan-error')), findsOneWidget);
      expect(find.text('Camera access is off. Allow it in Settings to scan, or type the code instead.'), findsOneWidget);
      await t.tap(find.byKey(const Key('scan-open-settings')));
      expect(links.settingsOpened, 1);
      await t.tap(find.byKey(const Key('scan-type-error')));
      expect(typed, 1);
    });

    testWidgets('any other camera failure: no Settings button, typing instead', (t) async {
      await pumpScreen(t, Scaffold(body: ScanErrorView(denied: false, onType: () {})), api: FakeApi());
      expect(find.byKey(const Key('scan-open-settings')), findsNothing);
      expect(find.text("The camera can't be used right now. Type the code instead."), findsOneWidget);
    });

    testWidgets('the real scanner page builds (torch, close, type instead) and "type instead" closes it with no code', (t) async {
      String? result = 'unset';
      await pumpScreen(t, Scaffold(body: Builder(builder: (c) => Center(child: FilledButton(key: const Key('open'), onPressed: () async { result = await const CameraBarcodeScanner().scan(c, title: 'Scan', continuous: true); }, child: const Text('open'))))), api: FakeApi());
      await t.tap(find.byKey(const Key('open')));
      await settle(t);
      expect(find.byKey(const Key('scan-torch')), findsOneWidget);
      expect(find.byKey(const Key('scan-done')), findsOneWidget, reason: 'continuous mode has a Done button');
      expect(find.text('Scan'), findsOneWidget);
      await t.tap(find.byKey(const Key('scan-type')));
      await settle(t);
      expect(result, isNull);
    });

    testWidgets('delivery: the parcel-code field has a camera button', (t) async {
      final scanner = FakeBarcodeScanner()..queue.add('JR-000042-001');
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z'}), mkStop(2)]), scanner: scanner);
      expect(find.text('Enter the parcel code to continue.'), findsOneWidget);
      await tapKey(t, const Key('parcel-code-scan'));
      expect(t.widget<TextField>(find.byKey(const Key('parcel-code'))).controller!.text, 'JR-000042-001');
      expect(find.text('Enter the parcel code to continue.'), findsNothing);
    });
  });

  group('manual route order (E5)', () {
    Job review({bool canReorder = true, Json? policy}) => mkManifestJob(actions: ['approve_route', 'report_no_work'], stops: [for (var n = 1; n <= 4; n++) mkLegStop(n)], extra: {
          'routeApprovedAt': null, 'route': mkRoute(extra: {'canReorder': canReorder}), 'policy': policy ?? mkPolicy(), 'loading': mkLoading(assigned: 4, scanned: 4, finished: true),
        });

    testWidgets('review: Change order → Make next / arrows → Save order sends the whole order; approving waits for it', (t) async {
      final api = FakeApi()..jobAfterReorder = mkManifestJob(actions: ['approve_route'], stops: [mkLegStop(3), mkLegStop(2), mkLegStop(1), mkLegStop(4)], extra: {'routeApprovedAt': null, 'route': mkRoute(provider: 'manual', extra: {'canReorder': true, 'manual': true}), 'policy': mkPolicy()});
      await open(t, review(), api: api);
      expect(find.byKey(const Key('order-editor')), findsNothing);
      await tapKey(t, const Key('reorder-edit'));
      expect(find.byKey(const Key('order-editor')), findsOneWidget);
      expect(t.widget<FilledButton>(find.byKey(const Key('order-save'))).onPressed, isNull, reason: 'nothing changed yet');
      expect(t.widget<FilledButton>(find.byKey(const Key('approve-route'))).onPressed, isNull, reason: 'save or cancel first');
      expect(find.byKey(const Key('approve-blocked-hint')), findsOneWidget);
      await tapKey(t, const Key('order-first-s3')); // [s3, s1, s2, s4]
      await tapKey(t, const Key('order-down-s1')); // [s3, s2, s1, s4]
      expect(t.widget<FilledButton>(find.byKey(const Key('order-save'))).onPressed, isNotNull);
      await tapKey(t, const Key('order-save'));
      expect(api.calls, contains('reorder:s3,s2,s1,s4'));
      expect(find.byKey(const Key('order-editor')), findsNothing, reason: 'saved: back to the list');
      expect(find.text('Arranged by you'), findsOneWidget, reason: 'the summary now says the order is the driver\'s');
      expect(find.byKey(const Key('route-manual-notice')), findsOneWidget);
      expect(find.byKey(const Key('route-estimate-notice')), findsNothing);
      expect(find.byKey(const Key('route-optimize')), findsOneWidget, reason: 'Re-optimise stays: last action wins');
    });

    testWidgets('dragging the handle re-orders; Cancel throws the change away', (t) async {
      final api = FakeApi();
      await open(t, review(), api: api);
      await tapKey(t, const Key('reorder-edit'));
      await show(t, const Key('order-handle-s1'));
      await t.timedDrag(find.byKey(const Key('order-handle-s1')), const Offset(0, 260), const Duration(milliseconds: 500));
      await settle(t);
      expect(t.widget<FilledButton>(find.byKey(const Key('order-save'))).onPressed, isNotNull, reason: 'the order changed');
      await tapKey(t, const Key('order-cancel'));
      expect(find.byKey(const Key('order-editor')), findsNothing);
      expect(count(api, 'reorder:'), 0);
      await tapKey(t, const Key('reorder-edit'));
      expect(t.widget<FilledButton>(find.byKey(const Key('order-save'))).onPressed, isNull, reason: 'starts from the server order again');
      await tapKey(t, const Key('order-handle-s1')); // (a tap does not move anything)
      expect(count(api, 'reorder:'), 0);
    });

    testWidgets('a drag followed by Save sends the dragged order', (t) async {
      final api = FakeApi();
      await open(t, review(), api: api);
      await tapKey(t, const Key('reorder-edit'));
      await show(t, const Key('order-handle-s1'));
      await t.timedDrag(find.byKey(const Key('order-handle-s1')), const Offset(0, 260), const Duration(milliseconds: 500));
      await settle(t);
      await tapKey(t, const Key('order-save'));
      final sent = api.calls.firstWhere((c) => c.startsWith('reorder:')).substring('reorder:'.length).split(',');
      expect(sent.toSet(), {'s1', 's2', 's3', 's4'});
      expect(sent.first, isNot('s1'), reason: 's1 was dragged down');
    });

    testWidgets('the server refusing (setting turned off) is shown inside the editor', (t) async {
      final api = FakeApi();
      await open(t, review(), api: api);
      await tapKey(t, const Key('reorder-edit'));
      await tapKey(t, const Key('order-first-s2'));
      api.errorOnNext = ApiException('FEATURE_DISABLED', 'off', status: 403);
      await tapKey(t, const Key('order-save'));
      expect(find.byKey(const Key('order-error')), findsOneWidget);
      expect(find.text('This option is turned off by the platform.'), findsOneWidget);
      expect(find.byKey(const Key('order-editor')), findsOneWidget, reason: 'nothing is lost');
    });

    testWidgets('disabled by the platform: no editing, one line saying why', (t) async {
      await open(t, review(canReorder: false, policy: mkPolicy(reorder: false)));
      expect(find.byKey(const Key('reorder-edit')), findsNothing);
      expect(find.byKey(const Key('reorder-off')), findsOneWidget);
      expect(find.text('Changing the stop order is turned off by the platform.'), findsOneWidget);
    });

    testWidgets('re-ordering not possible for another reason (e.g. one stop left): no button, no "turned off" line', (t) async {
      await open(t, review(canReorder: false));
      expect(find.byKey(const Key('reorder-edit')), findsNothing);
      expect(find.byKey(const Key('reorder-off')), findsNothing);
    });

    Job working({bool canReorder = true}) => mkManifestJob(stops: [mkLegStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z'}), mkLegStop(2), mkLegStop(3), mkLegStop(4)], extra: {'route': mkRoute(extra: {'canReorder': canReorder}), 'policy': mkPolicy()});

    testWidgets('working: "Make next" on an upcoming stop puts it right after the stop the driver is at (which is pinned and not in the order)', (t) async {
      final api = FakeApi();
      await open(t, working(), api: api);
      expect(find.byKey(const Key('make-next-s2')), findsNothing, reason: 's2 is already next');
      expect(find.byKey(const Key('make-next-s1')), findsNothing);
      await tapKey(t, const Key('make-next-s4'));
      expect(api.calls, contains('reorder:s4,s2,s3'));
      expect(find.text('Stop order saved.'), findsOneWidget);
    });

    testWidgets('working: the editor lists only the movable stops and saves them', (t) async {
      final api = FakeApi();
      await open(t, working(), api: api);
      await tapKey(t, const Key('reorder-edit'));
      expect(find.byKey(const Key('order-row-s1')), findsNothing, reason: 'the stop being served is pinned');
      expect([for (final s in ['s2', 's3', 's4']) find.byKey(Key('order-row-$s')).evaluate().length], [1, 1, 1]);
      await tapKey(t, const Key('order-up-s3'));
      await tapKey(t, const Key('order-save'));
      expect(api.calls, contains('reorder:s3,s2,s4'));
    });

    testWidgets('working: the current stop that the driver has NOT reached yet is movable too', (t) async {
      final j = mkManifestJob(stops: [mkLegStop(1, current: true), mkLegStop(2), mkLegStop(3)], extra: {'route': mkRoute(extra: {'canReorder': true}), 'policy': mkPolicy()});
      final api = await open(t, j);
      await tapKey(t, const Key('make-next-s3'));
      expect(api.calls, contains('reorder:s3,s1,s2'));
    });

    testWidgets('working: platform switch off → no Make next, one line saying why', (t) async {
      await open(t, mkManifestJob(stops: [mkLegStop(1, current: true), mkLegStop(2), mkLegStop(3)], extra: {'route': mkRoute(), 'policy': mkPolicy(reorder: false)}));
      expect(find.byKey(const Key('reorder-edit')), findsNothing);
      expect(find.byKey(const Key('reorder-off')), findsOneWidget);
      expect(find.byKey(const Key('make-next-s3')), findsNothing);
    });

    testWidgets('working: find a parcel by code, order reference or address, by typing or scanning', (t) async {
      final scanner = FakeBarcodeScanner()..queue.add('JR-000042-004');
      await open(t, working(), scanner: scanner);
      await show(t, const Key('find-parcel'));
      await t.enterText(find.byKey(const Key('find-parcel')), 'street 3');
      await t.pump();
      expect(find.byKey(const Key('upcoming-s3')), findsOneWidget);
      expect(find.byKey(const Key('upcoming-s2')), findsNothing);
      await t.enterText(find.byKey(const Key('find-parcel')), 'zzz');
      await t.pump();
      expect(find.byKey(const Key('find-none')), findsOneWidget);
      await tapKey(t, const Key('find-parcel-scan'));
      expect(find.byKey(const Key('upcoming-s4')), findsOneWidget);
      expect(find.byKey(const Key('upcoming-s3')), findsNothing);
    });
  });
}

