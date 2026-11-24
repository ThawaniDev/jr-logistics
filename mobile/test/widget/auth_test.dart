import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/app.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/auth/change_password_screen.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/providers_extra.dart';
import 'package:jr_driver/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }
Future<void> pause(WidgetTester t, [int ms = 500]) async { await t.pump(Duration(milliseconds: ms)); await t.pump(); }
ApiException apiErr(String code, int status, [Map<String, dynamic> details = const {}]) => ApiException(code, 'x', status: status, details: details);

/// A server that revokes (or keeps) the session after a password change, like `POST /auth/change-password` may do.
class _AuthApi extends FakeApi {
  bool revokeSessions = false, loginWorks = true;
  @override
  Future<Json> changePassword(String currentPassword, String newPassword) async {
    final r = await super.changePassword(currentPassword, newPassword);
    meResult = {'user': {...(meResult['user'] as Map).cast<String, dynamic>(), 'mustChangePassword': false}};
    if (revokeSessions) meError = apiErr('UNAUTHENTICATED', 401);
    return r;
  }
  @override
  Future<Json> login(String username, String password) async {
    if (!loginWorks) { calls.add('login:$username:$password'); throw apiErr('NETWORK', 0); }
    return super.login(username, password);
  }
}

/// A username check that answers only when the test says so (to prove a late answer for an old value is ignored).
class _SlowAvailability extends FakeApi {
  final pending = <String, Completer<Json>>{};
  @override
  Future<Json> usernameAvailable(String username) { calls.add('available:$username'); return (pending[username] = Completer<Json>()).future; }
}

const _mustChange = {'id': 'u1', 'role': 'driver', 'name': 'Omar Test', 'username': 'demo.driver', 'language': 'en', 'mustChangePassword': true};

/// The whole app (real router + real auth notifier) with the session [token] already stored or not.
Future<ProviderContainer> pumpApp(WidgetTester t, {required FakeApi api, bool token = false, String lang = 'en', Map<String, Object> prefs = const {}}) async {
  SharedPreferences.setMockInitialValues({'lang': lang, 'theme': testBrightness.name, installMarkerKey: '1', ...prefs}); // the marker: not a first launch of the install
  final p = await SharedPreferences.getInstance();
  final store = MemoryTokenStore();
  if (token) await store.write('tok');
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [
      prefsProvider.overrideWithValue(p), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(store),
      stringsProvider.overrideWith((ref) async => strings(ref.watch(localeProvider))), linkOpenerProvider.overrideWithValue(FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation()),
      legalApiProvider.overrideWithValue(FakeLegalApi()), privacyRepoProvider.overrideWithValue(FakePrivacyRepo()), fileSharerProvider.overrideWithValue(FakeSharer()),
      ...extraOverrides(api: FakeExtraApi(), notifier: FakeNotifier(permission: true)),
    ],
    child: const JrApp(),
  ));
  for (var i = 0; i < 5; i++) { await t.pump(const Duration(milliseconds: 200)); }
  return ProviderScope.containerOf(t.element(find.byType(JrApp)));
}

Future<void> openRegister(WidgetTester t, FakeApi api, {String lang = 'en'}) async {
  api..catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}]..catalogVehicles = ['sedan', 'van']..catalogServices = [{'key': 'delivery_driver'}];
  await pumpScreen(t, const RegisterScreen(), api: api, lang: lang, extra: [catalogProvider.overrideWith((ref) => api.catalog())]);
  await settle(t);
}

/// Brings the field into the tree (the form is a lazy list) and onto the screen.
Future<void> reveal(WidgetTester t, String key) async {
  final f = find.byKey(Key(key));
  final list = find.byType(Scrollable).first;
  if (f.evaluate().isEmpty) {
    try { await t.scrollUntilVisible(f, -300, scrollable: list, maxScrolls: 30); } catch (_) {/* it is below, not above */}
    if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: list, maxScrolls: 30);
  }
  await t.ensureVisible(f);
  await t.pump();
}

/// Scrolls the widget to the middle of the viewport (clear of the app bar) and taps it.
Future<void> tapKey(WidgetTester t, String key) async {
  await reveal(t, key);
  await Scrollable.ensureVisible(t.element(find.byKey(Key(key))), alignment: 0.5);
  await t.pump();
  await t.tap(find.byKey(Key(key)));
  await t.pump();
}

Future<void> type(WidgetTester t, String key, String text) async {
  await reveal(t, key);
  await t.enterText(find.byKey(Key(key)), text);
  await t.pump();
}

Future<void> pick(WidgetTester t, int dropdown, String label) async {
  await t.ensureVisible(find.byType(DropdownButtonFormField<String>).at(dropdown));
  await t.tap(find.byType(DropdownButtonFormField<String>).at(dropdown));
  await settle(t);
  await t.tap(find.text(label).last);
  await settle(t);
}

/// Fills every field of the sign-up form with valid values (username availability is awaited).
Future<void> fillRegister(WidgetTester t, {String username = 'omar.test', String phone = '0500000011'}) async {
  await type(t, 'username', username);
  await pause(t);
  await type(t, 'password', 'Secret#Pass2026');
  await type(t, 'confirm', 'Secret#Pass2026');
  await type(t, 'phone', phone);
  await type(t, 'name', 'Omar Test');
  await pick(t, 0, 'Riyadh');
  await pick(t, 1, 'Sedan');
  await tapKey(t, 'terms');
}

Future<bool> registerEnabled(WidgetTester t) async { await reveal(t, 'register'); return t.widget<FilledButton>(find.byKey(const Key('register'))).onPressed != null; }

Future<void> expectNoOverflow(WidgetTester t) async {
  expect(t.takeException(), isNull);
  final list = find.byType(Scrollable);
  if (list.evaluate().isEmpty) return;
  for (var i = 0; i < 10; i++) { await t.drag(list.first, const Offset(0, -450)); await t.pump(); expect(t.takeException(), isNull, reason: 'after scroll $i'); }
}

/// Every case runs once per mode: the layout must hold in light and in dark (the palette changes colours only, but a colour can hide or reveal text).
void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));
      _suite();
    });
  }
}

void _suite() {
  group('Login screen', () {
    testWidgets('the last username is remembered; the password never is; Sign in needs both', (t) async {
      await pumpApp(t, api: FakeApi(), prefs: {'last_username': 'demo.driver'});
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'demo.driver');
      expect(t.widget<TextField>(find.byKey(const Key('password'))).controller!.text, isEmpty);
      expect(t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed, isNull);
      await t.enterText(find.byKey(const Key('password')), 'x');
      await t.pump();
      expect(t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed, isNotNull);
    });

    testWidgets('keyboard and autofill hints, show/hide password, forgot-password hint, language switcher, no OTP UI', (t) async {
      await pumpScreen(t, const LoginScreen(), api: FakeApi());
      expect(t.widget<TextField>(find.byKey(const Key('username'))).autofillHints, [AutofillHints.username]);
      expect(t.widget<TextField>(find.byKey(const Key('password'))).autofillHints, [AutofillHints.password]);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).textCapitalization, TextCapitalization.none);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).autocorrect, isFalse);
      expect(t.widget<TextField>(find.byKey(const Key('password'))).obscureText, isTrue);
      await t.tap(find.byKey(const Key('password-toggle')));
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('password'))).obscureText, isFalse);
      await t.tap(find.byKey(const Key('password-toggle')));
      await t.pump();
      expect(t.widget<TextField>(find.byKey(const Key('password'))).obscureText, isTrue);
      expect(find.text('Forgot your password? Ask your account manager or support to reset it for you.'), findsOneWidget);
      expect(find.byKey(const Key('create-account')), findsOneWidget);
      expect(find.byKey(const Key('language')), findsOneWidget);
      for (final gone in ['phone', 'code', 'resend-otp']) { expect(find.byKey(Key(gone)), findsNothing, reason: gone); }
      expect(find.text('Send code'), findsNothing);
    });

    final cases = {
      'UNAUTHENTICATED': (401, 'Wrong username or password. Check them and try again.'),
      'RATE_LIMITED': (429, 'Too many attempts, or the account is temporarily locked. Wait about 15 minutes and try again.'),
      'FORBIDDEN': (403, 'This account is suspended. Contact support to get it back.'),
      'NETWORK': (0, 'No internet connection. Check your signal and try again.'),
      'TIMEOUT': (0, 'The network is too slow right now. Try again.'),
      'UNAVAILABLE': (503, 'The service is temporarily unavailable. Try again in a minute.'),
    };
    for (final e in cases.entries) {
      testWidgets('${e.key} shows its own localized message, keeps the typed values and lets the driver retry', (t) async {
        final api = FakeApi()..errorOnNext = apiErr(e.key, e.value.$1);
        await pumpScreen(t, const LoginScreen(), api: api);
        await t.enterText(find.byKey(const Key('username')), 'demo.driver');
        await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
        await t.pump();
        await t.tap(find.byKey(const Key('submit')));
        await settle(t);
        expect(find.text(e.value.$2), findsOneWidget);
        expect(t.widget<TextField>(find.byKey(const Key('password'))).controller!.text, 'Demo#Pass2026');
        expect(t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed, isNotNull);
        await t.tap(find.byKey(const Key('submit')));
        await settle(t);
        expect(find.byKey(const Key('login-error')), findsNothing, reason: 'the retry succeeded');
        expect(api.calls.where((c) => c.startsWith('login:')).length, 2);
      });
    }

    testWidgets('loading state: fields and button are locked while the request is in flight and a second tap cannot double-submit', (t) async {
      final api = FakeApi()..gate = Completer<void>();
      await pumpScreen(t, const LoginScreen(), api: api);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await t.pump();
      expect(t.widget<FilledButton>(find.byKey(const Key('submit'))).onPressed, isNull);
      expect(find.descendant(of: find.byKey(const Key('submit')), matching: find.byType(CircularProgressIndicator)), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).readOnly, isTrue);
      expect(t.widget<TextField>(find.byKey(const Key('password'))).readOnly, isTrue);
      api.gate!.complete();
      await settle(t);
      expect(api.calls.where((c) => c.startsWith('login:')).length, 1);
    });

    testWidgets('accounts that are not drivers (and staff that need a second step) are pointed to the web portal and never signed in', (t) async {
      for (final answer in [
        {'token': 'tok', 'user': {'id': 'b1', 'role': 'business', 'name': 'Sara'}},
        {'mfaRequired': true, 'mfaToken': 'm'},
      ]) {
        final api = FakeApi()..loginResult = answer;
        await pumpScreen(t, const LoginScreen(), api: api);
        await t.enterText(find.byKey(const Key('username')), 'demo.business');
        await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
        await t.pump();
        await t.tap(find.byKey(const Key('submit')));
        await settle(t);
        expect(find.text('This app is for drivers. Other accounts should use the JR web portal.'), findsOneWidget);
        final c = ProviderScope.containerOf(t.element(find.byType(LoginScreen)));
        expect(c.read(authProvider).value?.signedIn, isFalse);
        expect(c.read(prefsProvider).getString('last_username'), isNull);
        await t.pumpWidget(const SizedBox());
      }
    });

    testWidgets('a driver whose password is temporary is signed in with mustChangePassword on the user', (t) async {
      final api = FakeApi()..loginResult = {'token': 'tok', 'user': _mustChange};
      await pumpScreen(t, const LoginScreen(), api: api);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      await t.enterText(find.byKey(const Key('password')), 'Temp#Pass2026');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      final c = ProviderScope.containerOf(t.element(find.byType(LoginScreen)));
      expect(c.read(authProvider).value?.user?['mustChangePassword'], isTrue);
    });
  });

  group('Register screen — no OTP, username + password + phone', () {
    testWidgets('username check is debounced: typing "omar.test" in steps asks the server once, then shows Available', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      for (final s in ['o', 'om', 'oma', 'omar', 'omar.', 'omar.t', 'omar.te', 'omar.tes', 'omar.test']) { await t.enterText(find.byKey(const Key('username')), s); await t.pump(const Duration(milliseconds: 100)); }
      expect(api.calls.where((c) => c.startsWith('available:')), isEmpty, reason: 'still typing');
      expect(find.text('Checking availability…'), findsOneWidget);
      await pause(t);
      expect(api.calls.where((c) => c.startsWith('available:')).toList(), ['available:omar.test']);
      expect(find.text('Available'), findsOneWidget);
    });

    testWidgets('the field canonicalises (lower-case, allowed characters) and does not call the server for names that are too short', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      await t.enterText(find.byKey(const Key('username')), 'Om ');
      await pause(t, 800);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller!.text, 'om');
      expect(api.calls.where((c) => c.startsWith('available:')), isEmpty);
      expect(find.textContaining('3–30 characters'), findsOneWidget);
      await t.enterText(find.byKey(const Key('username')), 'Omar.Test');
      await pause(t);
      expect(api.calls, contains('available:omar.test'));
    });

    testWidgets('a taken username is reported at once and blocks sign-up', (t) async {
      final api = FakeApi()..takenUsernames.add('demo.driver');
      await openRegister(t, api);
      await fillRegister(t, username: 'demo.driver');
      await reveal(t, 'username');
      expect(find.text('That username is already taken.'), findsOneWidget);
      expect(await registerEnabled(t), isFalse);
      await type(t, 'username', 'demo.driver2');
      await pause(t);
      expect(find.text('Available'), findsOneWidget);
      expect(await registerEnabled(t), isTrue);
    });

    testWidgets('a slow answer for an older value never overwrites the answer for the current one', (t) async {
      final api = _SlowAvailability();
      await openRegister(t, api);
      await type(t, 'username', 'abc');
      await pause(t);
      await type(t, 'username', 'abcd');
      await pause(t);
      api.pending['abcd']!.complete({'available': true});
      await t.pump();
      expect(find.text('Available'), findsOneWidget);
      api.pending['abc']!.complete({'available': false, 'reason': 'taken'}); // the old answer arrives last
      await t.pump();
      expect(find.text('Available'), findsOneWidget);
      expect(find.text('That username is already taken.'), findsNothing);
    });

    testWidgets('a "reserved" answer and a failed check are both handled (offline: sign-up stays possible, the server decides)', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      api.availabilityError = apiErr('NETWORK', 0);
      await fillRegister(t);
      await reveal(t, 'username');
      expect(find.text("Couldn't check availability right now. We'll check again when you sign up."), findsOneWidget);
      expect(await registerEnabled(t), isTrue);
    });

    testWidgets('live password checklist, mismatch message and the same rules as the server', (t) async {
      await openRegister(t, FakeApi());
      Icon icon(String row) => t.widget<Icon>(find.descendant(of: find.byKey(Key(row)), matching: find.byType(Icon)));
      await type(t, 'password', 'abc');
      expect([icon('pw-rule-len').icon, icon('pw-rule-letter').icon, icon('pw-rule-digit').icon], [Icons.radio_button_unchecked, Icons.check_circle, Icons.radio_button_unchecked]);
      await type(t, 'password', 'abcdefghij');
      expect([icon('pw-rule-len').icon, icon('pw-rule-digit').icon], [Icons.check_circle, Icons.radio_button_unchecked]);
      await type(t, 'password', 'abcdefghi1');
      expect([icon('pw-rule-len').icon, icon('pw-rule-letter').icon, icon('pw-rule-digit').icon], everyElement(Icons.check_circle));
      expect(icon('pw-rule-match').icon, Icons.radio_button_unchecked);
      await type(t, 'confirm', 'abcdefghi2');
      expect(find.text("The two passwords don't match."), findsOneWidget);
      await type(t, 'confirm', 'abcdefghi1');
      expect(find.text("The two passwords don't match."), findsNothing);
      expect(icon('pw-rule-match').icon, Icons.check_circle);
      // passwords are hidden by default and each field has its own show/hide
      expect(t.widget<TextField>(find.byKey(const Key('password'))).obscureText, isTrue);
      await tapKey(t, 'confirm-toggle');
      expect(t.widget<TextField>(find.byKey(const Key('confirm'))).obscureText, isFalse);
      expect(t.widget<TextField>(find.byKey(const Key('password'))).obscureText, isTrue);
    });

    testWidgets('Create account needs a valid username, password, confirmation, phone, name, city, vehicle and the terms — and sends no registration token', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      await fillRegister(t);
      expect(await registerEnabled(t), isTrue);
      await type(t, 'phone', '05');
      expect(find.text('Enter a valid mobile number (9 to 15 digits).'), findsOneWidget);
      expect(await registerEnabled(t), isFalse);
      await type(t, 'phone', '+966 50 000 0011');
      expect(await registerEnabled(t), isTrue);
      await type(t, 'confirm', 'Secret#Pass2027');
      expect(await registerEnabled(t), isFalse, reason: 'passwords differ');
      await type(t, 'confirm', 'Secret#Pass2026');
      await tapKey(t, 'terms');
      expect(await registerEnabled(t), isFalse, reason: 'terms unticked');
      await tapKey(t, 'terms');
      await tapKey(t, 'register');
      await settle(t);
      final b = api.registered!;
      expect(b, containsPair('role', 'driver'));
      expect(b, containsPair('username', 'omar.test'));
      expect(b, containsPair('password', 'Secret#Pass2026'));
      expect(b, containsPair('phone', '+966500000011'));
      expect(b, containsPair('name', 'Omar Test'));
      expect(b, containsPair('city', 'riyadh'));
      expect(b, containsPair('vehicleType', 'sedan'));
      expect(b, containsPair('termsAccepted', true));
      expect(b.containsKey('registrationToken'), isFalse);
      final c = ProviderScope.containerOf(t.element(find.byType(RegisterScreen)));
      expect(c.read(authProvider).value?.signedIn, isTrue);
      expect(c.read(prefsProvider).getString('last_username'), 'omar.test');
    });

    testWidgets('409 CONFLICT on username / phone is shown inline on that field (and username is then blocked until edited)', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      await fillRegister(t);
      api.errorOnNext = apiErr('CONFLICT', 409, {'field': 'username'});
      await tapKey(t, 'register');
      await settle(t);
      await reveal(t, 'username');
      expect(find.text('That username is already taken.'), findsWidgets);
      expect(await registerEnabled(t), isFalse);
      await type(t, 'username', 'omar.test2');
      await pause(t);
      expect(find.text('Available'), findsOneWidget);
      expect(await registerEnabled(t), isTrue);
      api.errorOnNext = apiErr('CONFLICT', 409, {'field': 'phone'});
      await tapKey(t, 'register');
      await settle(t);
      await reveal(t, 'phone');
      expect(find.text('An account with this mobile number already exists.'), findsWidgets);
      expect(t.widget<TextField>(find.byKey(const Key('phone'))).controller!.text, '0500000011', reason: 'nothing typed is lost');
    });

    testWidgets('a lost answer to Create account says the account may exist — sign in — instead of inviting a second try', (t) async {
      final api = FakeApi();
      await openRegister(t, api);
      await fillRegister(t);
      api.errorOnNext = apiErr('NETWORK', 0);
      await tapKey(t, 'register');
      await settle(t);
      expect(find.text('No connection. Your account may already have been created — try signing in before registering again.'), findsOneWidget);
      expect(find.text('That username is already taken.'), findsNothing);
    });

    testWidgets('the sign-in link goes back to the login screen', (t) async {
      await pumpApp(t, api: FakeApi());
      await t.tap(find.byKey(const Key('create-account')));
      await settle(t);
      expect(find.byKey(const Key('username')), findsOneWidget);
      expect(find.text('Create your account'), findsOneWidget);
      await tapKey(t, 'back-to-login');
      await settle(t);
      expect(find.byKey(const Key('submit')), findsOneWidget);
    });
  });

  group('Choose a new password (forced) and Change password (profile)', () {
    Future<void> fillChange(WidgetTester t, {String current = 'Temp#Pass2026', String next = 'Brand#New2027', String? confirm}) async {
      await type(t, 'cp-current', current);
      await type(t, 'cp-new', next);
      await type(t, 'cp-confirm', confirm ?? next);
    }
    bool saveEnabled(WidgetTester t) => t.widget<FilledButton>(find.byKey(const Key('cp-submit'))).onPressed != null;

    testWidgets('mustChangePassword: the router locks the app on this screen — no tabs, no way back, only Sign out', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      await pumpApp(t, api: api, token: true);
      expect(find.byKey(const Key('cp-forced')), findsOneWidget);
      expect(find.text('Choose a new password'), findsWidgets);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byType(BackButton), findsNothing);
      expect(find.byKey(const Key('cp-signout')), findsOneWidget);
      expect(find.byKey(const Key('toggle')), findsNothing, reason: 'the home screen is not reachable');
    });

    testWidgets('save is enabled only for current + a rule-abiding, confirmed, different new password', (t) async {
      await pumpScreen(t, const ChangePasswordScreen(), api: FakeApi());
      expect(saveEnabled(t), isFalse);
      await fillChange(t, next: 'short1');
      expect(saveEnabled(t), isFalse);
      await fillChange(t, next: 'Brand#New2027', confirm: 'Brand#New2028');
      expect(saveEnabled(t), isFalse);
      await fillChange(t, current: 'Same#Pass2026', next: 'Same#Pass2026');
      expect(find.text('Choose a password different from the current one.'), findsOneWidget);
      expect(saveEnabled(t), isFalse);
      await fillChange(t);
      expect(saveEnabled(t), isTrue);
    });

    testWidgets('forced change → the app continues to the home screen (session kept by the server)', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      await pumpApp(t, api: api, token: true);
      await fillChange(t);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(api.calls, contains('changePassword:Temp#Pass2026>Brand#New2027'));
      expect(find.byKey(const Key('toggle')), findsOneWidget, reason: 'home screen');
      expect(find.byKey(const Key('cp-forced')), findsNothing);
    });

    testWidgets('the server revoked every session → the app signs in again with the new password and continues', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange}..revokeSessions = true;
      final c = await pumpApp(t, api: api, token: true);
      await fillChange(t);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(api.calls, contains('login:demo.driver:Brand#New2027'));
      expect(c.read(authProvider).value?.signedIn, isTrue);
      expect(find.byKey(const Key('toggle')), findsOneWidget);
    });

    testWidgets('sessions revoked and no way to sign in again → back to the login screen with a "sign in with your new password" notice', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange}..revokeSessions = true..loginWorks = false;
      final c = await pumpApp(t, api: api, token: true);
      await fillChange(t);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(c.read(authProvider).value?.signedIn, isFalse);
      expect(find.byKey(const Key('password-changed')), findsOneWidget);
      expect(find.text('Your password was changed. Sign in with your new password.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      await t.enterText(find.byKey(const Key('password')), 'Brand#New2027');
      await t.pump();
      api.loginWorks = true;
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
      expect(find.byKey(const Key('password-changed')), findsNothing);
    });

    testWidgets('a fresh {token, user} in the answer replaces the session', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange}..changePasswordResult = {'ok': true, 'token': 'fresh', 'user': {..._mustChange, 'mustChangePassword': false}};
      final c = await pumpApp(t, api: api, token: true);
      await fillChange(t);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(await c.read(tokenStoreProvider).read(), 'fresh');
      expect(find.byKey(const Key('toggle')), findsOneWidget);
    });

    testWidgets('a wrong current password (401) is shown on that field; the session is still fine so the user stays', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      await pumpApp(t, api: api, token: true);
      await fillChange(t, current: 'nope-nope-1');
      api.errorOnNext = apiErr('UNAUTHENTICATED', 401);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(find.text('Your current password is incorrect.'), findsOneWidget);
      expect(find.byKey(const Key('cp-forced')), findsOneWidget);
      expect(saveEnabled(t), isTrue, reason: 'the driver can retype and retry');
    });

    testWidgets('a 401 because the session itself expired signs the driver out instead of blaming the password', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      final c = await pumpApp(t, api: api, token: true);
      await fillChange(t);
      api..errorOnNext = apiErr('UNAUTHENTICATED', 401)..meError = apiErr('UNAUTHENTICATED', 401);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(c.read(authProvider).value?.signedIn, isFalse);
      expect(c.read(authProvider).value?.expired, isTrue);
      expect(find.text('Your current password is incorrect.'), findsNothing);
    });

    testWidgets('offline and rule errors are reported without losing what was typed', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      await pumpApp(t, api: api, token: true);
      await fillChange(t);
      api.errorOnNext = apiErr('NETWORK', 0);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('cp-new'))).controller!.text, 'Brand#New2027');
      await t.pump(const Duration(seconds: 7));
      api.errorOnNext = apiErr('VALIDATION', 422, {'field': 'newPassword'});
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(find.text('Please check this field.'), findsOneWidget);
    });

    testWidgets('forced screen: Sign out leaves the temporary session', (t) async {
      final api = _AuthApi()..meResult = {'user': _mustChange};
      final c = await pumpApp(t, api: api, token: true);
      await t.tap(find.byKey(const Key('cp-signout')));
      await settle(t);
      expect(c.read(authProvider).value?.signedIn, isFalse);
      expect(find.byKey(const Key('submit')), findsOneWidget, reason: 'login screen');
    });

    testWidgets('Profile → Change password opens the voluntary version (with back), shows the username, and returns to the profile after saving', (t) async {
      final api = _AuthApi()..meResult = {'user': {..._mustChange, 'mustChangePassword': false}};
      await pumpApp(t, api: api, token: true);
      await t.tap(find.byIcon(Icons.person_outline));
      await settle(t);
      expect(find.byKey(const Key('profile-username')), findsOneWidget);
      expect(find.text('Username: demo.driver'), findsOneWidget);
      await t.ensureVisible(find.text('Change password'));
      await t.tap(find.text('Change password'));
      await settle(t);
      expect(find.byKey(const Key('cp-forced')), findsNothing);
      expect(find.byType(BackButton), findsOneWidget);
      await fillChange(t);
      await t.tap(find.byKey(const Key('cp-submit')));
      await settle(t);
      expect(find.text('Password changed.'), findsOneWidget);
      await t.pump();
      await t.pump(const Duration(milliseconds: 700)); // the page transition back
      expect(find.byKey(const Key('cp-submit')), findsNothing, reason: 'back on the profile');
      await t.drag(find.byKey(const Key('profile-list')), const Offset(0, 3000)); // the profile is longer now (legal links, contact, privacy): back to its top
      await t.pump();
      expect(find.byKey(const Key('profile-username')), findsOneWidget);
    });
  });

  group('RTL / large text: nothing overflows', () {
    for (final lang in ['en', 'ar', 'ur']) {
      testWidgets('$lang @ 1.4x text on a 320 dp phone: login with an error, sign-up with every message, forced change password', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final rtl = lang != 'en';
        // login + the longest error
        final api = FakeApi()..errorOnNext = apiErr('RATE_LIMITED', 429);
        await pumpScreen(t, const LoginScreen(), api: api, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        await t.enterText(find.byKey(const Key('username')), 'demo.driver');
        await t.enterText(find.byKey(const Key('password')), 'Demo#Pass2026');
        await t.pump();
        await t.tap(find.byKey(const Key('submit')));
        await settle(t);
        expect(find.byKey(const Key('login-error')), findsOneWidget);
        expect(Directionality.of(t.element(find.byType(LoginScreen))), rtl ? TextDirection.rtl : TextDirection.ltr);
        expect(t.widget<TextField>(find.byKey(const Key('username'))).textDirection, TextDirection.ltr, reason: 'usernames are Latin text in every language');
        await expectNoOverflow(t);
        await t.pumpWidget(const SizedBox());
        // sign-up with a taken username, a weak password, a mismatch and a bad phone
        final reg = FakeApi()..takenUsernames.add('taken.one');
        await openRegister(t, reg, lang: lang);
        t.view.physicalSize = const Size(640, 1400);
        await type(t, 'username', 'taken.one');
        await pause(t);
        await type(t, 'password', 'abc');
        await type(t, 'confirm', 'abd');
        await type(t, 'phone', '05');
        await expectNoOverflow(t);
        await t.pumpWidget(const SizedBox());
        // forced change password with a field error
        await pumpScreen(t, const ChangePasswordScreen(), api: FakeApi(), lang: lang, extra: [authProvider.overrideWith(() => _TempAuth())]);
        t.view.physicalSize = const Size(640, 1400);
        await settle(t);
        expect(find.byKey(const Key('cp-forced')), findsOneWidget);
        await type(t, 'cp-new', 'same-same-1');
        await type(t, 'cp-current', 'same-same-1');
        await type(t, 'cp-confirm', 'other');
        await expectNoOverflow(t);
      });
    }
  });
}

class _TempAuth extends AuthNotifier {
  @override
  Future<AuthState> build() async => const AuthState(user: _mustChange);
}
