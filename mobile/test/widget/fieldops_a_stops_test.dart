import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/stop_actions.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';

// Mobile-A widget tests, part 2: the per-stop actions — postpone / can't deliver evidence, delivery proof (no code, signature, cash on delivery),
// stat cards, the completed state, and StopActions called from outside the stops screen (the route-map popup does that).

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<FakeApi> open(WidgetTester t, Job job, {FakeApi? api, FakeLocation? loc, FakeEvidencePhotos? evidence, FakeBarcodeScanner? scanner, String lang = 'en'}) async {
  final a = (api ?? FakeApi())..jobResult = job;
  await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, location: loc, evidence: evidence, scanner: scanner, lang: lang);
  await settle(t);
  return a;
}

Future<void> show(WidgetTester t, Key k) async {
  final f = find.byKey(k);
  if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
  await Scrollable.ensureVisible(t.element(f), alignment: 0.5);
  await t.pump();
}

Future<void> tapKey(WidgetTester t, Key k) async { await show(t, k); await t.tap(find.byKey(k)); await settle(t); }
int count(FakeApi a, String prefix) => a.calls.where((c) => c.startsWith(prefix)).length;
bool enabled(WidgetTester t, Key k) {
  final w = t.widget(find.byKey(k));
  return switch (w) { FilledButton b => b.onPressed != null, OutlinedButton b => b.onPressed != null, _ => throw StateError('not a button: $w') };
}

const _arrived = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null};
Job oneStop({Json? stop, Json? job, String type = 'consumer'}) => mkManifestJob(stops: [mkStop(1, current: true, type: type, extra: {..._arrived, ...?stop}), mkStop(2)], extra: job);

/// Draws a short line on the signature pad.
Future<void> sign(WidgetTester t) async {
  await show(t, const Key('signature-pad'));
  final g = await t.startGesture(t.getCenter(find.byKey(const Key('signature-pad'))) - const Offset(60, 20));
  await g.moveBy(const Offset(40, 30));
  await g.moveBy(const Offset(40, -30));
  await g.moveBy(const Offset(40, 20));
  await g.up();
  await t.pump();
}

void main() {
  group('postpone ("reschedule") evidence (E7)', () {
    Job stop({required bool text, required bool photo}) => oneStop(stop: {'canDefer': true}, job: {'policy': mkPolicy(text: text, photo: photo)});

    testWidgets('policy text + photo: both are needed, the button says what is missing, then both are uploaded and sent', (t) async {
      final api = await open(t, stop(text: true, photo: true));
      await tapKey(t, const Key('postpone'));
      expect(enabled(t, const Key('postpone-submit')), isFalse);
      expect(find.text('Write why you are postponing (a few words).'), findsOneWidget);
      expect(find.text('Why are you postponing? (required)'), findsOneWidget);
      expect(find.text('Photo (required)'), findsOneWidget);
      await t.enterText(find.byKey(const Key('postpone-note')), 'Shop is closed until 6 pm');
      await t.pump();
      expect(enabled(t, const Key('postpone-submit')), isFalse, reason: 'text alone is not enough');
      expect(find.text('Add a photo as evidence.'), findsOneWidget);
      await t.tap(find.byKey(const Key('postpone-photo-camera')));
      await settle(t);
      expect(find.byKey(const Key('postpone-photo-preview')), findsOneWidget);
      expect(enabled(t, const Key('postpone-submit')), isTrue);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('media:') || c.startsWith('defer:')).toList(), ['media:s1:defer:evidence.jpg', 'defer:s1:note=Shop is closed until 6 pm:media=m1']);
      expect(find.byKey(const Key('postpone-submit')), findsNothing, reason: 'the sheet closes');
      expect(find.text('Postponed'), findsOneWidget);
    });

    testWidgets('policy text only: the photo is optional', (t) async {
      final api = await open(t, stop(text: true, photo: false));
      await tapKey(t, const Key('postpone'));
      expect(find.text('Photo (optional)'), findsOneWidget);
      expect(enabled(t, const Key('postpone-submit')), isFalse);
      await t.enterText(find.byKey(const Key('postpone-note')), 'Nobody home, neighbour says back at 5');
      await t.pump();
      expect(enabled(t, const Key('postpone-submit')), isTrue);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(count(api, 'media:'), 0);
      expect(api.calls, contains('defer:s1:note=Nobody home, neighbour says back at 5'));
    });

    testWidgets('policy photo only: the reason is optional', (t) async {
      final evidence = FakeEvidencePhotos();
      final api = await open(t, stop(text: false, photo: true), evidence: evidence);
      await tapKey(t, const Key('postpone'));
      expect(find.text('Why are you postponing? (optional)'), findsOneWidget);
      expect(enabled(t, const Key('postpone-submit')), isFalse);
      expect(find.text('Add a photo as evidence.'), findsOneWidget);
      await t.tap(find.byKey(const Key('postpone-photo-gallery')));
      await settle(t);
      expect(evidence.sources, [ImageSource.gallery], reason: 'a photo from the gallery works too');
      expect(enabled(t, const Key('postpone-submit')), isTrue);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('defer:')).toList(), ['defer:s1:media=m1']);
    });

    testWidgets('policy needs neither: postponing is one tap', (t) async {
      final api = await open(t, stop(text: false, photo: false));
      await tapKey(t, const Key('postpone'));
      expect(enabled(t, const Key('postpone-submit')), isTrue);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(api.calls, contains('defer:s1'));
    });

    testWidgets('the photo can be removed again (and then it is missing again)', (t) async {
      await open(t, stop(text: false, photo: true));
      await tapKey(t, const Key('postpone'));
      await t.tap(find.byKey(const Key('postpone-photo-camera')));
      await settle(t);
      expect(enabled(t, const Key('postpone-submit')), isTrue);
      await t.tap(find.byKey(const Key('postpone-photo-remove')));
      await t.pump();
      expect(enabled(t, const Key('postpone-submit')), isFalse);
    });

    testWidgets('EVIDENCE_REQUIRED from the server makes the missing part required and says which', (t) async {
      final api = await open(t, oneStop(stop: {'canDefer': true})); // an app that did not know the policy
      await tapKey(t, const Key('postpone'));
      api.errorOnNext = ApiException('EVIDENCE_REQUIRED', 'x', status: 422, details: {'note': true, 'photo': false});
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(find.text('A written reason is required. Add it and try again.'), findsOneWidget);
      expect(find.text('Why are you postponing? (required)'), findsOneWidget);
      expect(enabled(t, const Key('postpone-submit')), isFalse);
    });

    testWidgets('a failed upload keeps the sheet and what was typed; the retry uploads again', (t) async {
      final api = await open(t, stop(text: true, photo: true));
      await tapKey(t, const Key('postpone'));
      await t.enterText(find.byKey(const Key('postpone-note')), 'closed for lunch');
      await t.tap(find.byKey(const Key('postpone-photo-camera')));
      await settle(t);
      api.errorOnNext = ApiException('NETWORK', 'reset');
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(find.byKey(const Key('postpone-error')), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('postpone-note'))).controller!.text, 'closed for lunch');
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(count(api, 'media:'), 2);
      expect(api.calls, contains('defer:s1:note=closed for lunch:media=m1'));
    });

    testWidgets('a photo that was uploaded is not uploaded twice when only the final call failed', (t) async {
      final api = _FlakyApi();
      await open(t, stop(text: true, photo: true), api: api);
      await tapKey(t, const Key('postpone'));
      await t.enterText(find.byKey(const Key('postpone-note')), 'closed for lunch');
      await t.tap(find.byKey(const Key('postpone-photo-camera')));
      await settle(t);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(find.byKey(const Key('postpone-error')), findsOneWidget);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(count(api, 'media:'), 1);
      expect(count(api, 'defer:'), 1);
    });
  });

  group("can't deliver (E14)", () {
    Job stopJob({bool strict = false, Json? stop}) => oneStop(stop: {..._arrived, ...?stop}, job: {'policy': mkPolicy(strict: strict)});
    Future<void> chooseAndSubmit(WidgetTester t, String reason) async {
      await tapKey(t, const Key('cant-deliver'));
      await t.tap(find.byKey(Key('fail-$reason')));
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
    }

    testWidgets('every reason is selectable before arrival, without a wait and without a note (not strict)', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)], extra: {'policy': mkPolicy()}));
      await tapKey(t, const Key('cant-deliver'));
      for (final k in ['unreachable', 'refused', 'closed', 'no_otp', 'gate_access', 'damaged', 'wrong_address', 'out_of_zone', 'other']) {
        expect(t.widget<ListTile>(find.byKey(Key('fail-$k'))).enabled, isTrue, reason: k);
      }
      await t.tap(find.byKey(const Key('fail-damaged')));
      await t.pump();
      expect(find.text('Note'), findsOneWidget, reason: 'the note is optional even for "damaged"');
      await show(t, const Key('fail-submit'));
      expect(enabled(t, const Key('fail-submit')), isTrue);
    });

    testWidgets('the photo is optional: without it only the reason is sent', (t) async {
      final api = await open(t, stopJob());
      await chooseAndSubmit(t, 'refused');
      expect(find.text('Mark this parcel as not delivered?'), findsOneWidget);
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'failed', extra: {'failReason': 'refused'}), mkStop(2, current: true)]);
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('fail:') || c.startsWith('media:')).toList(), ['fail:s1:refused:']);
      expect(find.text('Stop 2 of 2'), findsOneWidget);
    });

    testWidgets('a photo and a note can be attached to any reason: uploaded as kind "fail", then referenced', (t) async {
      final api = await open(t, stopJob());
      await tapKey(t, const Key('cant-deliver'));
      await t.tap(find.byKey(const Key('fail-closed')));
      await t.pump();
      await t.enterText(find.byKey(const Key('fail-note')), 'Shutters down');
      await show(t, const Key('fail-photo-camera'));
      await t.tap(find.byKey(const Key('fail-photo-camera')));
      await settle(t);
      expect(find.byKey(const Key('fail-photo-preview')), findsOneWidget);
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'failed', extra: {'failReason': 'closed'}), mkStop(2, current: true)]);
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('fail:') || c.startsWith('media:')).toList(), ['media:s1:fail:evidence.jpg', 'fail:s1:closed:Shutters down:media=m1']);
    });

    testWidgets('a failure inside the sheet shows inline and keeps the choice', (t) async {
      final api = await open(t, stopJob());
      await tapKey(t, const Key('cant-deliver'));
      await t.tap(find.byKey(const Key('fail-refused')));
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      api.errorOnNext = ApiException('FORBIDDEN', 'no', status: 403);
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(find.byKey(const Key('fail-error')), findsOneWidget);
      expect(find.text("You don't have permission to do that."), findsOneWidget);
      expect(find.byKey(const Key('fail-submit')), findsOneWidget, reason: 'the sheet stays open');
    });

    testWidgets('strict platform rules still gate reasons (arrival, note)', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)], extra: {'policy': mkPolicy(strict: true)}));
      await tapKey(t, const Key('cant-deliver'));
      expect(t.widget<ListTile>(find.byKey(const Key('fail-refused'))).enabled, isFalse, reason: 'needs arrival');
      expect(t.widget<ListTile>(find.byKey(const Key('fail-wrong_address'))).enabled, isTrue);
      await t.tap(find.byKey(const Key('fail-wrong_address')));
      await t.pump();
      expect(find.text('Add a short note (required)'), findsOneWidget);
      await show(t, const Key('fail-submit'));
      expect(enabled(t, const Key('fail-submit')), isFalse);
    });
  });

  group('door timer (E8)', () {
    testWidgets('no countdown after arrival when the platform sets no wait', (t) async {
      await open(t, oneStop(stop: {'waitRemainingSec': 600}, job: {'policy': mkPolicy(wait: 0)}));
      expect(find.byKey(const Key('wait-notice')), findsNothing);
      expect(find.byKey(const Key('wait-over')), findsNothing);
    });

    testWidgets('with a wait configured it counts down as before', (t) async {
      await open(t, oneStop(stop: {'waitRemainingSec': 600}, job: {'policy': mkPolicy(wait: 10, strict: true)}));
      await show(t, const Key('wait-notice'));
      expect(find.text('10:00'), findsOneWidget);
    });
  });

  group('delivery proof (E9/E10)', () {
    testWidgets('no delivery code needed (proofMode scan): no code field, the parcel code is the proof', (t) async {
      final api = await open(t, oneStop(stop: {'needsOtp': false, 'proofMode': 'scan'}));
      expect(find.byKey(const Key('otp-code')), findsNothing);
      expect(find.byKey(const Key('scan-proof-note')), findsOneWidget);
      expect(find.byKey(const Key('resend-code')), findsNothing);
      await show(t, const Key('parcel-code'));
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      expect(find.text('Enter the parcel code to continue.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.pump();
      expect(enabled(t, const Key('deliver-submit')), isTrue);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls, contains('deliver:s1:JR-000042-001:::'), reason: 'no otp, no proof, no receiver');
    });

    testWidgets('a business stop without delivery codes has no receipt alternative either (the scan is the proof)', (t) async {
      await open(t, oneStop(type: 'business', stop: {'needsOtp': false, 'proofMode': 'scan'}));
      expect(find.byKey(const Key('proof-mode')), findsNothing);
    });

    testWidgets('with delivery codes the business receipt alternative stays', (t) async {
      await open(t, oneStop(type: 'business'));
      await show(t, const Key('proof-mode'));
      expect(find.byKey(const Key('proof-mode')), findsOneWidget);
    });

    testWidgets('signature required: Confirm waits for it, the picture is uploaded as "signature" and referenced', (t) async {
      final api = await open(t, oneStop(stop: {'needsOtp': false, 'proofMode': 'scan', 'needsSignature': true}));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.pump();
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      await show(t, const Key('deliver-hint'));
      expect(find.text('The recipient must sign first.'), findsOneWidget);
      await sign(t);
      expect(enabled(t, const Key('deliver-submit')), isTrue);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls.where((c) => c.startsWith('media:') || c.startsWith('deliver:')).toList(), ['media:s1:signature:signature.png:7b', 'deliver:s1:JR-000042-001::::sig=m1']);
    });

    testWidgets('signature: Undo removes the last stroke, Clear wipes the pad (and disables Confirm again)', (t) async {
      await open(t, oneStop(stop: {'needsOtp': false, 'proofMode': 'scan', 'needsSignature': true}));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'X-1');
      await t.pump(); // let the focused field finish scrolling into view before the pad is scrolled to
      await sign(t);
      expect(enabled(t, const Key('deliver-submit')), isTrue);
      await tapKey(t, const Key('signature-undo'));
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      await sign(t);
      await sign(t);
      await tapKey(t, const Key('signature-clear'));
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      expect(find.text('Sign here'), findsOneWidget);
    });

    testWidgets('with a delivery code AND a signature both are needed', (t) async {
      final api = await open(t, oneStop(stop: {'needsSignature': true}));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.enterText(find.byKey(const Key('otp-code')), '1234');
      await t.pump();
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      await sign(t);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls, contains('deliver:s1:JR-000042-001:1234:::sig=m1'));
    });

    testWidgets('SIGNATURE_REQUIRED from the server is shown inline', (t) async {
      final api = await open(t, oneStop(stop: {'needsOtp': false, 'proofMode': 'scan'}));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'X-1');
      await t.pump();
      api.errorOnNext = ApiException('SIGNATURE_REQUIRED', 'x', status: 422);
      await tapKey(t, const Key('deliver-submit'));
      expect(find.text("The recipient's signature is required for this delivery."), findsOneWidget);
    });
  });

  group('cash on delivery (E17)', () {
    final cod = {'codCents': 12050};

    testWidgets('the cash to collect is shown before arriving, and again in the hand-over form', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: cod), mkStop(2)]));
      expect(find.byKey(const Key('cod-box')), findsOneWidget);
      expect(find.text('SAR 120.50'), findsOneWidget);
      expect(find.text('COLLECT CASH'), findsOneWidget);
    });

    testWidgets('delivery needs the "I collected SAR X" confirmation and sends exactly that amount', (t) async {
      final api = await open(t, oneStop(stop: {...cod, 'needsOtp': false, 'proofMode': 'scan'}));
      expect(find.byKey(const Key('cod-box')), findsOneWidget);
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.pump();
      expect(enabled(t, const Key('deliver-submit')), isFalse);
      await show(t, const Key('deliver-hint'));
      expect(find.text('Collect the cash, then tick the box.'), findsOneWidget);
      expect(find.text('I collected SAR 120.50 in cash'), findsOneWidget);
      await tapKey(t, const Key('cod-confirm'));
      expect(enabled(t, const Key('deliver-submit')), isTrue);
      await tapKey(t, const Key('deliver-submit'));
      expect(api.calls, contains('deliver:s1:JR-000042-001::::cash=12050'));
    });

    testWidgets('CASH_MISMATCH: says what is due and asks to confirm again', (t) async {
      final api = await open(t, oneStop(stop: {...cod, 'needsOtp': false, 'proofMode': 'scan'}));
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'X-1');
      await tapKey(t, const Key('cod-confirm'));
      api.errorOnNext = ApiException('CASH_MISMATCH', 'x', status: 422, details: {'expectedCents': 13000});
      await tapKey(t, const Key('deliver-submit'));
      expect(find.text('The amount due is SAR 130.00. Collect exactly that amount and confirm again.'), findsOneWidget);
      expect(t.widget<CheckboxListTile>(find.byKey(const Key('cod-confirm'))).value, isFalse);
      expect(enabled(t, const Key('deliver-submit')), isFalse);
    });

    testWidgets('upcoming stops and the route review mark the parcels that carry cash', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true), mkStop(2, extra: cod), mkStop(3)]));
      await show(t, const Key('upcoming'));
      expect(find.text('Cash SAR 120.50'), findsOneWidget);
    });

    testWidgets('in Arabic the amount keeps Latin digits', (t) async {
      await open(t, mkManifestJob(stops: [mkStop(1, current: true, extra: cod), mkStop(2)]), lang: 'ar');
      expect(find.text('120.50 ر.س'), findsOneWidget);
    });
  });

  group('stat cards (E13) and the job card', () {
    final summary = {'total': 5, 'pending': 0, 'loaded': 2, 'delivered': 2, 'failed': 1, 'returned': 0, 'missing': 0};
    Job underWay({Json? extra}) => mkManifestJob(stops: [mkStop(1, current: true), mkStop(2), mkStop(3, status: 'delivered'), mkStop(4, status: 'delivered'), mkStop(5, status: 'failed')], summary: summary, extra: {'cod': mkCod(toCollect: 123000, collected: 40000, parcels: 5), ...?extra});

    testWidgets('shipments · to deliver · delivered · not delivered · cash, outside the stops panels', (t) async {
      await open(t, underWay());
      String v(String k) => t.widget<Text>(find.byKey(Key('$k-value'))).data!;
      expect([v('stat-total'), v('stat-to-deliver'), v('stat-delivered'), v('stat-not-delivered')], ['5', '2', '2', '1']);
      expect(find.text('To deliver'), findsOneWidget);
      expect(find.text('Not delivered'), findsOneWidget);
      expect(v('stat-cash'), 'SAR 1,230.00');
      expect(find.text('Collected SAR 400.00 · 5 parcels with cash'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('manifest-panel')), matching: find.byKey(const Key('job-stats'))), findsNothing);
    });

    testWidgets('no cash tile without cash parcels; no cards before the parcels are on board or for legacy jobs', (t) async {
      await open(t, underWay(extra: {'cod': mkCod()}));
      expect(find.byKey(const Key('stat-cash')), findsNothing);
      expect(find.byKey(const Key('stat-total')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await open(t, mkJob());
      expect(find.byKey(const Key('job-stats')), findsNothing);
    });

    testWidgets('Arabic and Urdu labels', (t) async {
      await open(t, underWay(), lang: 'ar');
      expect(find.text('للتسليم'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await open(t, underWay(), lang: 'ur');
      expect(find.text('ڈیلیور کرنے ہیں'), findsOneWidget);
    });

    testWidgets('job card: stat cards (shipments · to deliver · delivered · not delivered · cash)', (t) async {
      await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: JobCard(job: underWay(), lang: 'en'))), api: FakeApi());
      String v(String k) => t.widget<Text>(find.byKey(Key('card-stat-$k-value'))).data!;
      expect([v('total'), v('to-deliver'), v('delivered'), v('not-delivered')], ['5', '2', '2', '1']);
      expect(v('cash'), 'SAR 1,230.00'); // still to collect
      expect(v('collected'), 'SAR 400.00');
    });

    testWidgets('job card: an offer shows the expected parcels with nothing delivered yet (J5)', (t) async {
      await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: JobCard(job: mkManifestJob(status: 'offered', actions: ['accept']), lang: 'en'))), api: FakeApi());
      expect(find.byKey(const Key('job-card-stats')), findsOneWidget);
      String v(String k) => t.widget<Text>(find.byKey(Key('card-stat-$k-value'))).data!;
      expect([v('total'), v('to-deliver'), v('delivered'), v('not-delivered')], ['3', '3', '0', '0']);
      expect(find.byKey(const Key('card-stat-cash')), findsNothing);
    });
  });

  group('finished route (E16/E18)', () {
    testWidgets('finishing the route: the job is completed at once — earnings in the wallet, nothing waits for the warehouse', (t) async {
      final stops = [mkStop(1, status: 'delivered'), mkStop(2, status: 'failed', extra: {'failReason': 'refused'}), mkStop(3, status: 'delivered')];
      final api = await open(t, mkManifestJob(actions: ['report_delivered'], stops: stops));
      expect(find.textContaining('can only be confirmed'), findsNothing, reason: 'the old "confirmed after the parcels are received back" copy is gone');
      expect(find.textContaining('Return the 1 undelivered parcels to the warehouse.'), findsOneWidget);
      expect(find.textContaining('adds your earnings to your wallet right away'), findsOneWidget);
      api.jobResult = mkManifestJob(status: 'completed', actions: [], stops: stops, extra: {'routeApprovedAt': '2026-12-01T06:30:00.000Z'});
      await tapKey(t, const Key('finish'));
      expect(api.calls, contains('delivered:{}'));
      expect(find.text('Job completed. Earnings added to your wallet.'), findsOneWidget, reason: 'the success message');
      await t.drag(find.byType(Scrollable).first, const Offset(0, 3000));
      await settle(t);
      expect(find.byKey(const Key('job-completed')), findsOneWidget);
      expect(find.text('Job completed'), findsOneWidget);
      expect(find.text('Your delivery is confirmed and your earnings were added to your wallet.'), findsOneWidget);
      expect(find.text('Job completed. Your earnings were added to your wallet.'), findsOneWidget, reason: 'the next-step hint');
      expect(find.textContaining('Waiting for the business'), findsNothing);
      expect(find.byKey(const Key('finish')), findsNothing);
    });

    testWidgets('a legacy "delivered, waiting" job no longer says it waits for the warehouse', (t) async {
      await open(t, mkJob(status: 'delivered_reported', actions: []));
      expect(find.text('Waiting for the business to confirm your delivery.'), findsNothing);
      expect(find.text('Your delivery was recorded. Your earnings are being added to your wallet.'), findsOneWidget);
    });

    testWidgets('the old "route is fixed by the warehouse" wording is gone from the route review', (t) async {
      await open(t, mkManifestJob(actions: ['approve_route'], stops: [mkStop(1), mkStop(2)], extra: {'routeApprovedAt': null}));
      expect(find.textContaining('fixed by the warehouse'), findsNothing);
    });
  });

  group('StopActions from outside the stops screen (the route-map popup)', () {
    /// A bare page with a button per action, like the popup: it holds the result of the last call.
    Future<ValueNotifier<bool?>> harness(WidgetTester t, FakeApi api, Future<bool> Function(BuildContext, WidgetRef) action) async {
      final result = ValueNotifier<bool?>(null);
      await pumpScreen(t, Scaffold(body: Consumer(builder: (c, ref, _) => Center(child: FilledButton(key: const Key('go'), onPressed: () async { result.value = await action(c, ref); }, child: const Text('go'))))), api: api);
      await settle(t);
      return result;
    }

    testWidgets('deliver: opens the delivery sheet; before arriving it offers "I\'ve arrived", then the same form; true after delivering', (t) async {
      final api = FakeApi();
      final job = mkManifestJob(stops: [mkStop(1, current: true), mkStop(2)]);
      api.jobResult = job;
      final result = await harness(t, api, (c, ref) => StopActions.deliver(c, ref, job, job.stops.first));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      expect(find.byKey(const Key('deliver-sheet-title')), findsOneWidget);
      expect(find.text('Recipient 1'), findsOneWidget);
      expect(find.byKey(const Key('arrive')), findsOneWidget);
      expect(find.byKey(const Key('parcel-code')), findsNothing);
      api.jobResult = mkManifestJob(stops: [mkStop(1, current: true, extra: _arrived), mkStop(2)]); // what the server says after arriving
      await t.tap(find.byKey(const Key('arrive')));
      await settle(t);
      expect(api.calls, contains('arrive:s1:24.7,46.7'));
      expect(find.byKey(const Key('parcel-code')), findsOneWidget, reason: 'the form appears without reopening the sheet');
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      await t.enterText(find.byKey(const Key('otp-code')), '1234');
      await t.pump();
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'delivered'), mkStop(2, current: true)]);
      await t.tap(find.byKey(const Key('deliver-submit')));
      await settle(t);
      expect(api.calls, contains('deliver:s1:JR-000042-001:1234::'));
      expect(find.byKey(const Key('deliver-sheet-title')), findsNothing, reason: 'the sheet closes');
      expect(result.value, isTrue);
    });

    testWidgets('deliver: cancelling the sheet returns false and sends nothing', (t) async {
      final api = FakeApi();
      final job = oneStop();
      api.jobResult = job;
      final result = await harness(t, api, (c, ref) => StopActions.deliver(c, ref, job, job.stops.first));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      await t.tapAt(const Offset(10, 10)); // the barrier
      await settle(t);
      expect(result.value, isFalse);
      expect(count(api, 'deliver:'), 0);
    });

    testWidgets("cantDeliver / postpone / makeNext return true when applied", (t) async {
      final api = FakeApi();
      final job = mkManifestJob(stops: [mkLegStop(1, current: true, extra: {..._arrived, 'canDefer': true}), mkLegStop(2), mkLegStop(3)], extra: {'route': mkRoute(extra: {'canReorder': true}), 'policy': mkPolicy(text: false, photo: false)});
      api.jobResult = job;
      var result = await harness(t, api, (c, ref) => StopActions.makeNext(c, ref, job, job.stops[2]));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      expect(api.calls, contains('reorder:s3,s2'));
      expect(result.value, isTrue);
      await t.pumpWidget(const SizedBox());

      result = await harness(t, api, (c, ref) => StopActions.postpone(c, ref, job, job.stops.first));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      await t.tap(find.byKey(const Key('postpone-submit')));
      await settle(t);
      expect(api.calls, contains('defer:s1'));
      expect(result.value, isTrue);
      await t.pumpWidget(const SizedBox());

      result = await harness(t, api, (c, ref) => StopActions.cantDeliver(c, ref, job, job.stops.first));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      await t.tap(find.byKey(const Key('fail-other')));
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(api.calls, contains('fail:s1:other:'));
      expect(result.value, isTrue);
    });

    testWidgets('makeNext on the stop that is already next, or with re-ordering off, does nothing and says why', (t) async {
      final api = FakeApi();
      final job = mkManifestJob(stops: [mkLegStop(1, current: true, extra: _arrived), mkLegStop(2), mkLegStop(3)], extra: {'route': mkRoute(extra: {'canReorder': true})});
      api.jobResult = job;
      var result = await harness(t, api, (c, ref) => StopActions.makeNext(c, ref, job, job.stops[1]));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      expect(result.value, isFalse);
      expect(find.text('This stop is already next.'), findsOneWidget);
      expect(count(api, 'reorder:'), 0);
      await t.pumpWidget(const SizedBox());
      final off = mkManifestJob(stops: [mkLegStop(1), mkLegStop(2)], extra: {'route': mkRoute()});
      result = await harness(t, api, (c, ref) => StopActions.makeNext(c, ref, off, off.stops[1]));
      await t.tap(find.byKey(const Key('go')));
      await settle(t);
      expect(result.value, isFalse);
      expect(find.text("You can't change the stop order right now."), findsOneWidget);
    });

    testWidgets('only one action per job at a time (the shared in-flight flag)', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      final job = oneStop();
      api.jobResult = job;
      await pumpScreen(t, Scaffold(body: Consumer(builder: (c, ref, _) => Column(children: [
        FilledButton(key: const Key('a'), onPressed: () => StopActions.arrive(c, ref, job, job.stops.first), child: const Text('a')),
        FilledButton(key: const Key('b'), onPressed: () => StopActions.makeNext(c, ref, job, job.stops.first), child: const Text('b')),
      ]))), api: api);
      await t.tap(find.byKey(const Key('a')));
      await t.pump();
      await t.tap(find.byKey(const Key('a')));
      await t.pump();
      expect(count(api, 'arrive:'), 1);
      api.gate!.complete();
      await settle(t);
      expect(count(api, 'arrive:'), 1);
    });
  });
}

/// FakeApi that fails the FIRST defer (after the photo went up) — to see the photo is not uploaded twice.
class _FlakyApi extends FakeApi {
  int failures = 1;
  @override
  Future<Json> deferStop(String offerId, String stopId, {String? note, String? mediaId}) async {
    if (failures > 0) { failures--; throw ApiException('NETWORK', 'reset'); }
    return super.deferStop(offerId, stopId, note: note, mediaId: mediaId);
  }
}

