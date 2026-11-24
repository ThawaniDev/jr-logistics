import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// Update L / M — (1) the deliver form while text messages are switched off (no code box, no resend, a clear hint), (2) invitations from an office while the wallet is not empty.
Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<FakeApi> _open(WidgetTester t, Job job, {FakeApi? api, String lang = 'en'}) async {
  final a = (api ?? FakeApi())..jobResult = job;
  await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, lang: lang);
  await _settle(t);
  return a;
}

Future<void> _show(WidgetTester t, Key k) async {
  final f = find.byKey(k);
  if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
  await Scrollable.ensureVisible(t.element(f), alignment: 0.5);
  await t.pump();
}

Future<void> _tap(WidgetTester t, Key k) async { await _show(t, k); await t.tap(find.byKey(k)); await _settle(t); }
bool _enabled(WidgetTester t, Key k) => switch (t.widget(find.byKey(k))) { FilledButton b => b.onPressed != null, OutlinedButton b => b.onPressed != null, _ => throw StateError('not a button') };

const _arrived = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null};
const _smsOff = {'needsOtp': false, 'proofMode': 'scan', 'canResend': false, 'otpOffReason': 'sms_off'};
Job _job({Map<String, Object?>? stop, String type = 'consumer', bool smsOff = false}) => mkManifestJob(
      stops: [mkStop(1, current: true, type: type, extra: {..._arrived, ...?stop}), mkStop(2)],
      extra: smsOff ? {'deliveryCode': {'required': false, 'offReason': 'sms_off', 'smsActive': false}, 'ops': mkOps(otp: false)} : null,
    );

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('deliver form while SMS is off', () {
        testWidgets('no code box, no resend button, a clear hint — and the parcel code alone completes the delivery', (t) async {
          final api = await _open(t, _job(stop: _smsOff, smsOff: true));
          await _show(t, const Key('parcel-code'));
          expect(find.byKey(const Key('otp-code')), findsNothing);
          expect(find.byKey(const Key('resend-code')), findsNothing);
          expect(find.byKey(const Key('otp-locked')), findsNothing);
          expect(find.byKey(const Key('sms-off-note')), findsOneWidget);
          expect(find.byKey(const Key('scan-proof-note')), findsNothing, reason: 'not the "this warehouse has no codes" text');
          expect(find.text('Text messages are switched off on the platform, so this parcel needs no delivery code. Scan or type the parcel code — that is the proof — and take a photo or a signature if the app asks for one.'), findsOneWidget);
          expect(find.byKey(const Key('proof-mode')), findsNothing);
          expect(_enabled(t, const Key('deliver-submit')), isFalse);
          expect(find.text('Enter the parcel code to continue.'), findsOneWidget);
          await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
          await t.pump();
          expect(_enabled(t, const Key('deliver-submit')), isTrue);
          await _tap(t, const Key('deliver-submit'));
          expect(api.calls, contains('deliver:s1:JR-000042-001:::'), reason: 'no otp, no proof, no receiver name');
        });

        testWidgets('a business stop has no receipt-photo alternative either (the scan is the proof)', (t) async {
          await _open(t, _job(type: 'business', stop: _smsOff, smsOff: true));
          await _show(t, const Key('parcel-code'));
          expect(find.byKey(const Key('proof-mode')), findsNothing);
          expect(find.byKey(const Key('receipt-pick')), findsNothing);
          expect(find.byKey(const Key('sms-off-note')), findsOneWidget);
        });

        testWidgets('cash on delivery and a signature are still asked for (only the code goes)', (t) async {
          final api = await _open(t, _job(stop: {..._smsOff, 'codCents': 12000, 'needsSignature': true}, smsOff: true));
          await _show(t, const Key('parcel-code'));
          await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
          await t.pump();
          expect(find.byKey(const Key('cod-box')), findsOneWidget);
          expect(find.byKey(const Key('signature-pad')), findsOneWidget);
          expect(_enabled(t, const Key('deliver-submit')), isFalse, reason: 'signature and cash confirmation are still missing');
          expect(api.calls.where((c) => c.startsWith('deliver')), isEmpty);
        });

        testWidgets('the warehouse not using codes keeps its own (older) hint — SMS being on or off is not mixed up with it', (t) async {
          await _open(t, _job(stop: {'needsOtp': false, 'proofMode': 'scan', 'canResend': false, 'otpOffReason': 'warehouse'}));
          await _show(t, const Key('parcel-code'));
          expect(find.byKey(const Key('scan-proof-note')), findsOneWidget);
          expect(find.byKey(const Key('sms-off-note')), findsNothing);
          expect(find.text('No delivery code is needed for this parcel. Scanning or typing the parcel code is the proof.'), findsOneWidget);
          expect(find.byKey(const Key('otp-code')), findsNothing);
          expect(find.byKey(const Key('resend-code')), findsNothing);
        });

        testWidgets('SMS on and a code required: the code box and Resend are there as before', (t) async {
          await _open(t, _job());
          await _show(t, const Key('parcel-code'));
          expect(find.byKey(const Key('otp-code')), findsOneWidget);
          expect(find.byKey(const Key('resend-code')), findsOneWidget);
          expect(find.byKey(const Key('sms-off-note')), findsNothing);
          expect(find.byKey(const Key('scan-proof-note')), findsNothing);
        });

        testWidgets('SMS switched off while the form was open: Resend answers {sent: false, smsOff: true} — said plainly, no cool-down, and the form drops the code box', (t) async {
          final api = FakeApi()..resendResult = {'sent': false, 'smsOff': true};
          await _open(t, _job(), api: api);
          api.jobResult = _job(stop: _smsOff, smsOff: true); // what the next read of the job says
          await _tap(t, const Key('resend-code'));
          expect(api.calls, contains('resend:s1'));
          expect(find.text('No code was sent because text messages are switched off. No code is needed.'), findsOneWidget);
          expect(find.text('A new code was sent to the recipient.'), findsNothing);
          expect(find.byKey(const Key('otp-code')), findsNothing);
          expect(find.byKey(const Key('resend-code')), findsNothing);
          expect(find.byKey(const Key('sms-off-note')), findsOneWidget);
        });

        testWidgets('a normal resend still says the code was sent and starts the cool-down', (t) async {
          final api = FakeApi()..resendResult = {'sent': true};
          await _open(t, _job(), api: api);
          await _tap(t, const Key('resend-code'));
          expect(find.text('A new code was sent to the recipient.'), findsOneWidget);
          expect(find.textContaining('Resend in'), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: the hint is in the driver\'s language, right-to-left, and fits a small phone at 1.4x', (t) async {
            t.platformDispatcher.textScaleFactorTestValue = 1.4;
            addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
            t.view.physicalSize = const Size(640, 1400);
            await _open(t, _job(stop: _smsOff, smsOff: true), lang: lang);
            await _show(t, const Key('sms-off-note'));
            expect(Directionality.of(t.element(find.byKey(const Key('sms-off-note')))), TextDirection.rtl);
            expect(find.textContaining(lang == 'ar' ? 'الرسائل النصية متوقفة' : 'ٹیکسٹ میسج بند ہیں'), findsOneWidget);
            expect(find.byKey(const Key('otp-code')), findsNothing);
            expect(t.takeException(), isNull);
          });
        }
      });

      group('invitations from an office', () {
        Map<String, Object?> invite() => {'id': 'i1', 'officeName': 'Najd Express'};
        Future<FakeApi> open(WidgetTester t, {Map<String, Object?>? block, String lang = 'en'}) async {
          final api = FakeApi()..invitesResult = {'items': [invite()], 'walletBlock': ?block};
          await pumpRoutedB(t, const ProfileScreen(), api: api, lang: lang);
          await _settle(t);
          return api;
        }
        const blocked = {'availableCents': 12500, 'heldCents': 500, 'pendingWithdrawals': 1, 'blocks': true};

        testWidgets('a wallet that is not empty: the card explains why and Accept is off; Decline still works', (t) async {
          final api = await open(t, block: blocked);
          expect(find.text('Najd Express invited you to join their office'), findsOneWidget);
          expect(find.byKey(const Key('invite-wallet-block')), findsOneWidget);
          expect(find.text('Empty your wallet before you join an office'), findsOneWidget);
          expect(find.text('You have SAR 130.00 in your wallet or a withdrawal waiting (1). Once you join, the office is paid and you can no longer see or withdraw it. Withdraw it first (or ask support to move it to the office), then accept.'), findsOneWidget);
          expect(_enabled(t, const Key('invite-accept-i1')), isFalse);
          await t.tap(find.byKey(const Key('invite-accept-i1')), warnIfMissed: false);
          await t.pump();
          expect(api.calls.where((c) => c.startsWith('invite')), isEmpty);
          await t.tap(find.byKey(const Key('invite-decline-i1')));
          await _settle(t);
          expect(api.calls, contains('invite:i1:false'));
        });

        testWidgets('an empty wallet (or an older server without walletBlock): Accept works', (t) async {
          for (final block in [{'availableCents': 0, 'heldCents': 0, 'pendingWithdrawals': 0, 'blocks': false}, null]) {
            final api = await open(t, block: block);
            expect(find.byKey(const Key('invite-wallet-block')), findsNothing);
            expect(_enabled(t, const Key('invite-accept-i1')), isTrue);
            await t.tap(find.byKey(const Key('invite-accept-i1')));
            await _settle(t);
            expect(api.calls, contains('invite:i1:true'));
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('409 WALLET_NOT_EMPTY (money arrived after the page loaded): the explanation, and the card is blocked from then on', (t) async {
          final api = await open(t, block: {'availableCents': 0, 'heldCents': 0, 'pendingWithdrawals': 0, 'blocks': false});
          api.errorOnNext = ApiException('WALLET_NOT_EMPTY', 'x', status: 409, details: {'availableCents': 5000, 'heldCents': 0, 'pendingWithdrawals': 0});
          api.invitesResult = {'items': [invite()], 'walletBlock': {'availableCents': 5000, 'heldCents': 0, 'pendingWithdrawals': 0, 'blocks': true}};
          await t.tap(find.byKey(const Key('invite-accept-i1')));
          await _settle(t);
          expect(find.textContaining('You still have money in your wallet or a withdrawal waiting.'), findsWidgets);
          expect(find.byKey(const Key('invite-wallet-block')), findsOneWidget);
          expect(_enabled(t, const Key('invite-accept-i1')), isFalse);
        });

        testWidgets('Arabic: the explanation in Arabic', (t) async {
          await open(t, block: blocked, lang: 'ar');
          expect(find.text('فرّغ محفظتك قبل الانضمام إلى مكتب'), findsOneWidget);
          expect(find.textContaining('130.00 ر.س'), findsOneWidget);
        });
      });
    });
  }
}
