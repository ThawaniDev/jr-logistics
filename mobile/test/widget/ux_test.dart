import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/app.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/services.dart';
import 'package:jr_driver/widgets/common.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

/// GPS that answers only when the test says so (to tap again while the position is still being read).
class HoldLocation implements LocationService {
  final hold = Completer<void>();
  @override
  Future<bool> hasPermission() async => true;
  @override
  Future<bool> requestPermission() async => true;
  @override
  Future<LatLng?> current() async { await hold.future; return (lat: 24.7, lng: 46.7); }
}

class _BlankNameAuth extends AuthNotifier {
  @override
  Future<AuthState> build() async => const AuthState(user: {'name': '  ', 'phone': '0500000011', 'role': 'driver'});
}

void main() {
  final arrived = {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': 600};

  Future<FakeApi> open(WidgetTester t, Job job, {FakeLinks? links, LocationService? loc, FakePhotos? photos, String lang = 'en', FakeApi? api}) async {
    final a = (api ?? FakeApi())..jobResult = job;
    await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: a, links: links, location: loc, photos: photos, lang: lang);
    await settle(t);
    return a;
  }

  Future<void> show(WidgetTester t, Key k) async { await Scrollable.ensureVisible(t.element(find.byKey(k)), alignment: 0.5); await t.pump(); }
  Future<void> tapKey(WidgetTester t, Key k) async { await show(t, k); await t.tap(find.byKey(k)); await settle(t); }
  Job oneStop({Json? extra, String type = 'consumer'}) => mkManifestJob(stops: [mkStop(1, current: true, type: type, extra: extra ?? arrived), mkStop(2)]);
  int count(FakeApi a, String prefix) => a.calls.where((c) => c.startsWith(prefix)).length;
  Future<void> fillCodes(WidgetTester t, {String otp = '1234'}) async {
    await show(t, const Key('parcel-code'));
    await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
    await t.enterText(find.byKey(const Key('otp-code')), otp);
    await t.pump();
  }

  group('current stop — what next, always visible', () {
    testWidgets('big recipient + address, the parcel to pick, and one-tap call / WhatsApp / navigate', (t) async {
      final links = FakeLinks();
      final api = await open(t, oneStop(extra: {...arrived, 'notes': 'Gate 2, ring twice'}), links: links);
      expect(find.byKey(const Key('stop-recipient')), findsOneWidget);
      expect(t.widget<Text>(find.byKey(const Key('stop-address'))).style!.fontSize, greaterThanOrEqualTo(20));
      expect(find.byKey(const Key('stop-parcel')), findsOneWidget);
      expect(find.text('Parcel 1'), findsOneWidget);
      expect(find.textContaining('JR-000042-001'), findsWidgets);
      expect(find.text('Gate 2, ring twice'), findsOneWidget);
      for (final k in ['stop-call', 'stop-wa', 'stop-maps']) {
        await show(t, Key(k));
        expect(t.getSize(find.byKey(Key(k))).height, greaterThanOrEqualTo(48), reason: '$k is a thumb-sized target');
      }
      await tapKey(t, const Key('stop-call'));
      expect(links.called, ['+966555000001']);
      await tapKey(t, const Key('stop-maps'));
      expect(links.opened.last.toString(), contains('google.com/maps'));
      await tapKey(t, const Key('stop-wa'));
      expect(api.calls.any((c) => c.startsWith('wa:contact:en:s1')), isTrue);
    });

    testWidgets('call / maps that cannot open say so instead of failing silently', (t) async {
      final links = FakeLinks()..succeed = false;
      await open(t, oneStop(), links: links);
      await tapKey(t, const Key('stop-call'));
      expect(find.text('Couldn\'t start the call on this device.'), findsOneWidget);
      await tapKey(t, const Key('stop-maps'));
      expect(find.text('Couldn\'t open the maps app.'), findsOneWidget);
    });

    testWidgets('wait timer: shown from arrival with a live countdown', (t) async {
      await open(t, oneStop());
      await show(t, const Key('wait-notice'));
      expect(find.text('10:00'), findsOneWidget);
      await t.pump(const Duration(seconds: 5));
      expect(find.text('9:55'), findsOneWidget);
      expect(find.byKey(const Key('wait-over')), findsNothing);
    });

    testWidgets('wait timer at zero: "unreachable" can now be reported', (t) async {
      await open(t, oneStop(extra: {...arrived, 'waitRemainingSec': 0}));
      expect(find.byKey(const Key('wait-over')), findsOneWidget);
      expect(find.byKey(const Key('wait-notice')), findsNothing);
    });

    testWidgets('no wait timer before arrival', (t) async {
      await open(t, mkManifestJob());
      expect(find.byKey(const Key('wait-notice')), findsNothing);
      expect(find.byKey(const Key('arrive')), findsOneWidget);
    });

    testWidgets('a disabled Confirm button always says why', (t) async {
      await open(t, oneStop());
      await show(t, const Key('deliver-hint'));
      expect(find.text('Enter the parcel code to continue.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      await t.pump();
      expect(find.text('Ask the recipient for their 4-digit code.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('otp-code')), '1234');
      await t.pump();
      expect(find.byKey(const Key('deliver-hint')), findsNothing);
    });
  });

  group('delivery code states', () {
    testWidgets('tries left are visible before the next attempt (fewer than 5 left)', (t) async {
      await open(t, oneStop(extra: {...arrived, 'otpAttemptsLeft': 3}));
      await show(t, const Key('otp-code'));
      expect(find.text('Tries left: 3'), findsOneWidget);
    });

    testWidgets('locked by the server: field disabled, one big Resend button, then a 30 s cooldown against double SMS', (t) async {
      final api = await open(t, oneStop(extra: {...arrived, 'otpAttemptsLeft': 0}));
      await show(t, const Key('otp-locked'));
      expect(find.text('Code entry is locked'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).enabled, isFalse);
      expect(t.widget<FilledButton>(find.byKey(const Key('resend-code'))).onPressed, isNotNull);
      await t.tap(find.byKey(const Key('resend-code')));
      await settle(t);
      expect(api.calls, contains('resend:s1'));
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).enabled, isTrue);
      await show(t, const Key('resend-code'));
      expect(find.textContaining('Resend in 0:'), findsOneWidget);
      expect(t.widget<TextButton>(find.byKey(const Key('resend-code'))).onPressed, isNull, reason: 'cooldown');
      await t.pump(const Duration(seconds: 31));
      expect(t.widget<TextButton>(find.byKey(const Key('resend-code'))).onPressed, isNotNull);
    });

    testWidgets('locked and no resends left: tells the driver the way out (Can\'t deliver → no code), no dead end', (t) async {
      await open(t, oneStop(extra: {...arrived, 'otpAttemptsLeft': 0, 'canResend': false}));
      await show(t, const Key('otp-locked'));
      expect(find.byKey(const Key('resend-code')), findsNothing);
      expect(find.textContaining('Can\'t deliver'), findsWidgets);
    });

    testWidgets('wrong code with 0 left locks the field immediately', (t) async {
      final api = await open(t, oneStop());
      await fillCodes(t);
      api.errorOnNext = ApiException('OTP_INVALID', 'bad', status: 422, details: {'attemptsLeft': 0});
      await tapKey(t, const Key('deliver-submit'));
      expect(find.byKey(const Key('otp-locked')), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).enabled, isFalse);
    });

    testWidgets('Arabic-Indic digits typed on an Arabic keyboard become a valid code', (t) async {
      await open(t, oneStop(), lang: 'ar');
      await show(t, const Key('otp-code'));
      await t.enterText(find.byKey(const Key('otp-code')), '١٢٣٤');
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).controller!.text, '1234');
    });
  });

  group('no double submit, safe retry', () {
    testWidgets('double tap on Confirm delivery sends one request, shows a spinner, and no other action can start meanwhile', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await open(t, oneStop(), api: api);
      await fillCodes(t);
      await show(t, const Key('deliver-submit'));
      await t.tap(find.byKey(const Key('deliver-submit')));
      await t.pump();
      await t.tap(find.byKey(const Key('deliver-submit')), warnIfMissed: false);
      await t.pump();
      expect(count(api, 'deliver:'), 1);
      expect(t.widget<FilledButton>(find.byKey(const Key('deliver-submit'))).onPressed, isNull);
      expect(find.descendant(of: find.byKey(const Key('deliver-submit')), matching: find.byType(CircularProgressIndicator)), findsOneWidget);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('cant-deliver'))).onPressed, isNull);
      api.gate!.complete();
      await settle(t);
      expect(count(api, 'deliver:'), 1);
    });

    testWidgets('a second tap while the GPS fix is still being read does not start a second delivery', (t) async {
      final loc = HoldLocation();
      final api = await open(t, oneStop(), loc: loc);
      await fillCodes(t);
      await show(t, const Key('deliver-submit'));
      await t.tap(find.byKey(const Key('deliver-submit')));
      await t.pump();
      expect(count(api, 'deliver:'), 0, reason: 'still waiting for GPS');
      await t.tap(find.byKey(const Key('deliver-submit')), warnIfMissed: false);
      await t.pump();
      loc.hold.complete();
      await settle(t);
      expect(count(api, 'deliver:'), 1);
    });

    testWidgets('dropped connection but the server already recorded the delivery: success, not an error, no resubmit', (t) async {
      final api = await open(t, oneStop());
      await fillCodes(t);
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'delivered'), mkStop(2, current: true)]); // what the server now says
      api.errorOnNext = ApiException('NETWORK', 'reset');
      await tapKey(t, const Key('deliver-submit'));
      expect(count(api, 'deliver:'), 1);
      expect(find.text('Stop 2 of 2'), findsOneWidget);
      expect(find.textContaining('No internet connection'), findsNothing);
    });

    testWidgets('dropped connection and the outcome cannot be checked: honest "unconfirmed" message, typed input kept for the retry', (t) async {
      final api = await open(t, oneStop());
      await fillCodes(t);
      api.errorOnNext = ApiException('TIMEOUT', 'slow');
      api.jobFetchError = ApiException('NETWORK', 'offline');
      await tapKey(t, const Key('deliver-submit'));
      expect(find.textContaining('couldn\'t confirm that it went through'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('parcel-code'))).controller!.text, 'JR-000042-001');
      expect(t.widget<TextField>(find.byKey(const Key('otp-code'))).controller!.text, '1234');
      expect(find.byKey(const Key('current-stop')), findsOneWidget, reason: 'the stop and its form are not replaced by an error page');
      api.jobFetchError = null;
      await tapKey(t, const Key('deliver-submit'));
      expect(count(api, 'deliver:'), 2);
    });

    testWidgets('a Can\'t-deliver that hit a dropped line is also settled by re-reading the job', (t) async {
      final api = await open(t, oneStop(extra: {...arrived, 'waitRemainingSec': 0}));
      await tapKey(t, const Key('cant-deliver'));
      await t.tap(find.byKey(const Key('fail-refused')));
      await t.pump();
      await show(t, const Key('fail-submit'));
      await t.tap(find.byKey(const Key('fail-submit')));
      await settle(t);
      api.jobResult = mkManifestJob(stops: [mkStop(1, status: 'failed', extra: {'failReason': 'refused'}), mkStop(2, current: true)]);
      api.errorOnNext = ApiException('NETWORK', 'reset');
      await t.tap(find.byKey(const Key('fail-confirm')));
      await settle(t);
      expect(find.text('Stop 2 of 2'), findsOneWidget);
      expect(find.textContaining('No internet connection'), findsNothing);
    });
  });

  group('poor network — screens keep their data', () {
    testWidgets('a failed background refresh keeps the stop on screen (with what was typed) and shows a stale strip with Retry', (t) async {
      final api = await open(t, oneStop());
      await show(t, const Key('parcel-code'));
      await t.enterText(find.byKey(const Key('parcel-code')), 'JR-000042-001');
      api.jobFetchError = ApiException('NETWORK', 'offline');
      await t.pump(const Duration(seconds: 10)); // the 10 s poll fires and fails
      await settle(t);
      expect(find.byKey(const Key('stale-strip')), findsOneWidget);
      expect(find.text('No connection. Showing the last loaded data.'), findsOneWidget);
      expect(find.byKey(const Key('current-stop')), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('parcel-code'))).controller!.text, 'JR-000042-001');
      api.jobFetchError = null;
      await t.tap(find.byKey(const Key('stale-retry')));
      await settle(t);
      expect(find.byKey(const Key('stale-strip')), findsNothing);
      expect(t.widget<TextField>(find.byKey(const Key('parcel-code'))).controller!.text, 'JR-000042-001');
    });

    testWidgets('first load failing shows a mapped message (not raw text) and a Retry that works', (t) async {
      final api = FakeApi()..jobResult = mkJob()..jobFetchError = ApiException('TIMEOUT', 'raw dio text');
      await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api);
      await settle(t);
      expect(find.text('The network is too slow right now. Try again.'), findsOneWidget);
      expect(find.textContaining('raw dio text'), findsNothing);
      api.jobFetchError = null;
      await t.tap(find.byKey(const Key('retry')));
      await settle(t);
      expect(find.byKey(const Key('checkin')), findsOneWidget);
    });

    for (final inList in [true, false]) {
      testWidgets('AsyncBody: stale data ${inList ? 'inside a scroll view' : 'on a full page'} keeps the data and adds the strip without layout errors', (t) async {
        var fail = false;
        final p = FutureProvider.autoDispose<int>((ref) async { if (fail) throw ApiException('NETWORK', 'x'); return 7; });
        await pumpScreen(t, Scaffold(body: Consumer(builder: (c, ref, _) {
          final v = ref.watch(p);
          return inList ? ListView(children: [AsyncBody<int>(value: v, onRetry: () {}, builder: (n) => Text('shown $n'))]) : AsyncBody<int>(value: v, onRetry: () {}, builder: (n) => ListView(children: [Text('shown $n')]));
        })), api: FakeApi());
        await settle(t);
        expect(find.text('shown 7'), findsOneWidget);
        expect(find.byKey(const Key('stale-strip')), findsNothing);
        fail = true;
        ProviderScope.containerOf(t.element(find.byType(Scaffold))).invalidate(p);
        await settle(t);
        expect(find.text('shown 7'), findsOneWidget, reason: 'data stays');
        expect(find.byKey(const Key('stale-strip')), findsOneWidget);
      });
    }

    testWidgets('connection banner appears and disappears without rebuilding the page (typed text survives)', (t) async {
      SharedPreferences.setMockInitialValues({'lang': 'en'});
      final prefs = await SharedPreferences.getInstance();
      t.view.physicalSize = const Size(900, 1900);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      final api = FakeApi();
      await t.pumpWidget(ProviderScope(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore())], child: const JrApp()));
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300))); // dictionaries load from the asset bundle
      await settle(t);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      final c = ProviderScope.containerOf(t.element(find.byType(LoginScreen)));
      c.read(onlineProvider.notifier).set(false);
      await t.pump();
      expect(find.byKey(const Key('offline-strip')), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'demo.driver');
      c.read(onlineProvider.notifier).set(true);
      await t.pump();
      expect(find.byKey(const Key('offline-strip')), findsNothing);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'demo.driver');
    });
  });

  group('receipt photo flow', () {
    Future<FakeApi> openReceipt(WidgetTester t, {FakePhotos? photos, FakeLinks? links, FakeApi? api}) async {
      final a = await open(t, oneStop(type: 'business'), photos: photos, links: links, api: api);
      await show(t, const Key('proof-mode'));
      await t.tap(find.byKey(const Key('mode-receipt')));
      await t.pump();
      await t.enterText(find.byKey(const Key('parcel-code')), '1');
      return a;
    }

    testWidgets('failed upload keeps the preview, explains, and Retry re-sends the SAME photo (no re-shoot)', (t) async {
      final photos = FakePhotos();
      final api = await openReceipt(t, photos: photos);
      api.errorOnNext = ApiException('NETWORK', 'reset');
      await tapKey(t, const Key('receipt-pick'));
      expect(find.byKey(const Key('upload-error')), findsOneWidget);
      expect(find.text('No internet connection. Check your signal and try again.'), findsWidgets);
      expect(find.byKey(const Key('photo-ok')), findsNothing);
      expect(find.byKey(const Key('receipt-preview')), findsOneWidget, reason: 'the photo stays on screen');
      await tapKey(t, const Key('receipt-retry'));
      expect(photos.taken, 1);
      expect(count(api, 'proof:'), 2);
      expect(find.byKey(const Key('photo-ok')), findsOneWidget);
      expect(find.byKey(const Key('upload-error')), findsNothing);
    });

    testWidgets('upload progress is shown while the photo is being sent', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await openReceipt(t, api: api);
      await show(t, const Key('receipt-pick'));
      await t.tap(find.byKey(const Key('receipt-pick')));
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      expect(find.byKey(const Key('upload-progress')), findsOneWidget);
      expect(find.text('Uploading photo… 50%'), findsOneWidget);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('receipt-pick'))).onPressed, isNull, reason: 'cannot start a second upload');
      api.gate!.complete();
      await settle(t);
      expect(find.byKey(const Key('upload-progress')), findsNothing);
      expect(find.byKey(const Key('photo-ok')), findsOneWidget);
    });

    testWidgets('an upload that reached the server before the line dropped counts as uploaded', (t) async {
      final api = await openReceipt(t);
      api.jobResult = mkManifestJob(stops: [mkStop(1, current: true, type: 'business', extra: {...arrived, 'hasProof': true}), mkStop(2)]);
      api.errorOnNext = ApiException('TIMEOUT', 'slow');
      await tapKey(t, const Key('receipt-pick'));
      expect(find.byKey(const Key('photo-ok')), findsOneWidget);
      expect(find.byKey(const Key('upload-error')), findsNothing);
    });

    testWidgets('camera permission refused: explains and offers Open Settings', (t) async {
      final photos = FakePhotos()..failWith = PhotoException(denied: true);
      final links = FakeLinks();
      await openReceipt(t, photos: photos, links: links);
      await tapKey(t, const Key('receipt-pick'));
      expect(find.byKey(const Key('camera-denied')), findsOneWidget);
      await t.tap(find.text('Open Settings'));
      expect(links.settingsOpened, 1);
    });

    testWidgets('a camera that fails for another reason gives a retryable message', (t) async {
      final photos = FakePhotos()..failWith = PhotoException(denied: false);
      await openReceipt(t, photos: photos);
      await tapKey(t, const Key('receipt-pick'));
      expect(find.text('Couldn\'t open the camera. Try again.'), findsOneWidget);
      expect(find.byKey(const Key('camera-denied')), findsNothing);
    });
  });

  group('text size and languages', () {
    for (final lang in ['en', 'ar', 'ur']) {
      testWidgets('$lang at 1.4x text on a 320 dp wide phone: current stop, deliver form, receipt mode and fail sheet do not overflow', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final api = FakeApi()..jobResult = oneStop(type: 'business', extra: {...arrived, 'otpAttemptsLeft': 2, 'notes': 'Second floor, blue door, ask for the manager at the front desk'});
        await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: api, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        t.view.devicePixelRatio = 2;
        await settle(t);
        expect(t.takeException(), isNull);
        await t.scrollUntilVisible(find.byKey(const Key('proof-mode')), 300, scrollable: find.byType(Scrollable).first);
        await show(t, const Key('proof-mode'));
        await t.tap(find.byKey(const Key('mode-receipt')));
        await settle(t);
        await show(t, const Key('deliver-submit'));
        await tapKey(t, const Key('cant-deliver'));
        expect(t.takeException(), isNull);
      });
    }
  });

  group('error messages are mapped, never raw', () {
    Future<String> msg(WidgetTester t, Object e) async {
      late BuildContext ctx;
      await pumpScreen(t, Builder(builder: (c) { ctx = c; return const SizedBox(); }), api: FakeApi());
      return errMessage(ctx, e);
    }

    testWidgets('connectivity and gateway failures', (t) async {
      expect(await msg(t, ApiException('NETWORK', 'SocketException: Connection refused')), 'No internet connection. Check your signal and try again.');
      expect(await msg(t, ApiException('TIMEOUT', 'x')), 'The network is too slow right now. Try again.');
      expect(await msg(t, ApiException('UNAVAILABLE', '<html>')), 'The service is temporarily unavailable. Try again in a minute.');
      expect(await msg(t, ApiException('BAD_RESPONSE', 'x')), startsWith('Unexpected reply from the network'));
      expect(await msg(t, ApiException('FILE_TOO_LARGE', 'x')), 'The file is too large. Use a smaller photo.');
    });

    testWidgets('an unknown future error code shows a generic line with the code, not the server\'s English text', (t) async {
      final m = await msg(t, ApiException('SOME_NEW_CODE', 'internal detail: table x'));
      expect(m, 'Something went wrong (code SOME_NEW_CODE). Try again.');
      expect(await msg(t, StateError('oops')), 'Something went wrong on our side. Please try again.');
    });

    testWidgets('delivery validation says exactly what is wrong; 0 attempts left reads as locked', (t) async {
      expect(await msg(t, ApiException('VALIDATION', 'x', details: {'field': 'code'})), startsWith('That parcel code doesn\'t match'));
      expect(await msg(t, ApiException('VALIDATION', 'x', details: {'field': 'proof'})), 'Upload the receipt photo first.');
      expect(await msg(t, ApiException('VALIDATION', 'x', details: {'field': 'receiverName'})), 'Enter the name of the person who received the parcel.');
      expect(await msg(t, ApiException('OTP_INVALID', 'x', details: {'attemptsLeft': 0})), 'Too many wrong codes. Resend the code to the recipient.');
    });

    testWidgets('every message exists in Arabic and Urdu too', (t) async {
      for (final lang in ['ar', 'ur']) {
        late BuildContext ctx;
        await pumpScreen(t, Builder(builder: (c) { ctx = c; return const SizedBox(); }), api: FakeApi(), lang: lang);
        for (final code in ['NETWORK', 'TIMEOUT', 'UNAVAILABLE', 'BAD_RESPONSE', 'FILE_TOO_LARGE', 'SOME_NEW_CODE']) {
          final m = errMessage(ctx, ApiException(code, 'x'));
          expect(RegExp(r'[؀-ۿ]').hasMatch(m), isTrue, reason: '$lang $code -> $m');
        }
      }
    });
  });

  group('login', () {
    testWidgets('Arabic-Indic digits are normalised and Sign in stays disabled until both fields are filled', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const LoginScreen(), api: api, lang: 'ar');
      bool enabled() => t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed != null;
      expect(enabled(), isFalse);
      await t.enterText(find.byKey(const Key('username')), 'u٩٦٦٥٠٠٠٠٠٠١١');
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'u966500000011');
      expect(enabled(), isFalse, reason: 'no password yet');
      await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
      await t.pump();
      expect(enabled(), isTrue);
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(api.calls, contains('login:u966500000011:Demo#Pass2026'));
    });

    testWidgets('a network failure shows the connectivity message and keeps what was typed', (t) async {
      final api = FakeApi()..errorOnNext = ApiException('NETWORK', 'x');
      await pumpScreen(t, const LoginScreen(), api: api);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'demo.driver');
      expect(t.widget<TextField>(find.byKey(const Key('password'))).controller!.text, 'Demo#Pass2026');
      expect(t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed, isNotNull);
    });
  });

  group('wallet & offers', () {
    testWidgets('withdraw is single-flight: the button is disabled with a spinner while the request is pending', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await pumpScreen(t, const WalletScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('withdraw')));
      await settle(t);
      await t.enterText(find.byKey(const Key('amount')), '10');
      await t.pump();
      await t.tap(find.byKey(const Key('withdraw-submit')));
      await t.pump();
      await t.pump(const Duration(milliseconds: 400));
      expect(t.widget<FilledButton>(find.byKey(const Key('withdraw'))).onPressed, isNull);
      expect(find.descendant(of: find.byKey(const Key('withdraw')), matching: find.byType(CircularProgressIndicator)), findsOneWidget);
      api.gate!.complete();
      await settle(t);
      expect(count(api, 'withdraw:'), 1);
      expect(t.widget<FilledButton>(find.byKey(const Key('withdraw'))).onPressed, isNotNull);
    });

    testWidgets('withdraw on a dropped line says it could not be confirmed (and to check the list)', (t) async {
      final api = FakeApi();
      await pumpScreen(t, const WalletScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('withdraw')));
      await settle(t);
      await t.enterText(find.byKey(const Key('amount')), '10');
      await t.pump();
      api.errorOnNext = ApiException('NETWORK', 'x');
      await t.tap(find.byKey(const Key('withdraw-submit')));
      await settle(t);
      expect(find.textContaining('couldn\'t confirm your withdrawal'), findsOneWidget);
    });

    testWidgets('wallet explains available / on hold (an open complaint) / withdrawal in words — no approval step (E18)', (t) async {
      await pumpScreen(t, const WalletScreen(), api: FakeApi());
      await settle(t);
      expect(find.text('Ready to withdraw to your IBAN.'), findsOneWidget);
      expect(find.text('Held while a complaint about a job is open. It is paid to you automatically once it is resolved.'), findsOneWidget);
      expect(find.text('On hold'), findsOneWidget);
      expect(find.text('Pending payment'), findsNothing);
    });

    testWidgets('declining an offer asks first; cancel keeps it, confirm rejects once', (t) async {
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
      await pumpRouted(t, const OffersScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('decline-o1')));
      await settle(t);
      expect(find.text('Decline this offer?'), findsOneWidget);
      await t.tap(find.text('Cancel'));
      await settle(t);
      expect(count(api, 'reject:'), 0);
      await t.tap(find.byKey(const Key('decline-o1')));
      await settle(t);
      await t.tap(find.byKey(const Key('decline-confirm')));
      await settle(t);
      expect(count(api, 'reject:'), 1);
    });

    testWidgets('profile with a blank name does not crash (avatar shows ?)', (t) async {
      await pumpScreen(t, const ProfileScreen(), api: FakeApi(), extra: [authProvider.overrideWith(_BlankNameAuth.new)]);
      await settle(t);
      expect(t.takeException(), isNull);
      expect(find.text('?'), findsOneWidget);
    });
  });

  group('job screen — gaps', () {
    testWidgets('cancelling a job does not leave the screen when the server refuses', (t) async {
      final api = await open(t, mkJob());
      api.cancelError = ApiException('FORBIDDEN', 'no', status: 403);
      await t.scrollUntilVisible(find.text('Cancel job'), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.text('Cancel job').first);
      await settle(t);
      await t.enterText(find.byKey(const Key('reason')), 'Car broke down');
      await t.pump();
      await t.tap(find.byKey(const Key('reason-submit')));
      await settle(t);
      expect(find.byType(JobDetailScreen), findsOneWidget, reason: 'still on the job');
      expect(find.text('You don\'t have permission to do that.'), findsOneWidget);
    });

    testWidgets('pickup navigation is one tap before loading', (t) async {
      final links = FakeLinks();
      await open(t, mkJob(extra: {'pickup': {'address': 'Olaya St', 'lat': 24.7, 'lng': 46.7}}), links: links);
      await tapKey(t, const Key('pickup-maps'));
      expect(links.opened.last.toString(), contains('destination=24.7,46.7'));
    });
  });
}
