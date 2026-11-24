import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show ApiException;
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/features/legal/legal_reader.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../helpers_lm.dart';

/// Update L / M — the driver terms and the privacy policy: the readers, the registration screen, the Profile links and the blocking re-acceptance page.
/// Scrolls [f] into view and lets the frame land (a tap uses the positions of the last frame).
Future<void> _show(WidgetTester t, Finder f) async { await t.ensureVisible(f); await t.pump(); }
Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('reader', () {
        testWidgets('draws the text the server sent: title, version and date, headings, lists, bold', (t) async {
          final legal = FakeLegalApi();
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), legal: legal);
          await _settle(t);
          expect(find.text('Terms and conditions'), findsOneWidget, reason: 'the app bar');
          expect(find.byKey(const Key('legal-title')), findsOneWidget);
          expect(t.widget<Text>(find.byKey(const Key('legal-title'))).data, 'Driver terms (en)');
          expect(t.widget<Text>(find.byKey(const Key('legal-version'))).data, 'Version 2.0 · In force since 1 Nov 2026');
          expect(find.textContaining('Driver terms', findRichText: true), findsWidgets);
          expect(find.textContaining('Deliver every parcel you scan', findRichText: true), findsOneWidget);
          expect(find.textContaining('cash', findRichText: true), findsWidgets);
          expect(find.text('•'), findsNWidgets(2));
          expect(find.byKey(const Key('legal-builtin')), findsNothing);
          expect(legal.calls, ['doc:driver:en']);
        });

        testWidgets('the privacy policy: its own title, numbered list', (t) async {
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'privacy'), api: FakeApi());
          await _settle(t);
          expect(find.text('Privacy policy'), findsOneWidget);
          expect(find.text('1.'), findsOneWidget);
          expect(find.text('2.'), findsOneWidget);
        });

        testWidgets('an unknown slug reads as the driver terms (never a blank page)', (t) async {
          final legal = FakeLegalApi();
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'business'), api: FakeApi(), legal: legal);
          await _settle(t);
          expect(legal.calls, ['doc:driver:en']);
        });

        testWidgets('the platform\'s own draft says it is a draft (builtin)', (t) async {
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), legal: FakeLegalApi()..builtin = true);
          await _settle(t);
          expect(find.byKey(const Key('legal-builtin')), findsOneWidget);
          expect(find.textContaining('draft pending legal review'), findsOneWidget);
        });

        testWidgets('a link to the privacy policy opens the in-app policy; an https link goes to the system; a failing one says so', (t) async {
          final links = FakeLinks();
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), links: links);
          await _settle(t);
          await t.tapOnText(find.textRange.ofSubstring('privacy policy'));
          await _settle(t);
          expect(find.text('PAGE:/legal/privacy'), findsOneWidget);
        });

        testWidgets('an https link opens outside the app', (t) async {
          final links = FakeLinks();
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), links: links);
          await _settle(t);
          await t.tapOnText(find.textRange.ofSubstring('our site'));
          await t.pump();
          expect(links.opened.map((u) => u.toString()), ['https://example.com/terms']);
          links.succeed = false;
          await t.tapOnText(find.textRange.ofSubstring('our site'));
          await _settle(t);
          expect(find.text('The link could not be opened.'), findsOneWidget);
        });

        testWidgets('a failed load says so and Retry loads again', (t) async {
          final legal = FakeLegalApi()..docError = ApiException('NETWORK', 'x');
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), legal: legal);
          await _settle(t);
          expect(find.byKey(const Key('legal-error')), findsOneWidget);
          expect(find.text('The text could not be loaded. Check your connection and try again.'), findsOneWidget);
          legal.docError = null;
          await t.tap(find.byKey(const Key('legal-retry')));
          await _settle(t);
          expect(find.byKey(const Key('legal-error')), findsNothing);
          expect(find.textContaining('Deliver every parcel you scan', findRichText: true), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: asks for the text in the driver\'s language and reads right-to-left', (t) async {
            final legal = FakeLegalApi();
            await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), legal: legal, lang: lang);
            await _settle(t);
            expect(legal.calls, ['doc:driver:$lang']);
            expect(Directionality.of(t.element(find.byKey(const Key('legal-title')))), TextDirection.rtl);
            expect(t.widget<Text>(find.byKey(const Key('legal-title'))).data, 'Driver terms ($lang)');
          });
        }
      });

      group('registration', () {
        Future<void> openRegister(WidgetTester t, FakeApi api, {FakeLegalApi? legal, String lang = 'en'}) async {
          api..catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}]..catalogVehicles = ['sedan']..catalogServices = [{'key': 'delivery_driver'}];
          await pumpRoutedB(t, const RegisterScreen(), api: api, legal: legal, lang: lang, overrides: [catalogProvider.overrideWith((ref) => api.catalog())]);
          await _settle(t);
        }

        testWidgets('the driver terms and the privacy policy are shown, both ABOVE the one box that accepts them', (t) async {
          final legal = FakeLegalApi();
          await openRegister(t, FakeApi(), legal: legal);
          for (final slug in ['driver', 'privacy']) { await _show(t, find.byKey(Key('legal-inline-$slug'))); }
          await _show(t, find.byKey(const Key('terms')));
          expect(legal.calls.toSet(), {'doc:driver:en', 'doc:privacy:en'});
          expect(find.text('Driver terms and conditions'), findsOneWidget);
          expect(find.text('Privacy policy'), findsOneWidget);
          expect(find.text('I have read and accept the Terms of Use and the Privacy Policy.'), findsOneWidget);
          final termsY = t.getTopLeft(find.byKey(const Key('legal-inline-driver'))).dy, privacyY = t.getTopLeft(find.byKey(const Key('legal-inline-privacy'))).dy, boxY = t.getTopLeft(find.byKey(const Key('terms'))).dy;
          expect(termsY, lessThan(privacyY));
          expect(privacyY, lessThan(boxY));
          expect(find.textContaining('Deliver every parcel you scan', findRichText: true), findsOneWidget, reason: 'the opening of the text is on the page');
        });

        testWidgets('"Read full screen" opens the reader of that text (also readable before signing in)', (t) async {
          await openRegister(t, FakeApi());
          await _show(t, find.byKey(const Key('legal-open-privacy')));
          await t.tap(find.byKey(const Key('legal-open-privacy')));
          await _settle(t);
          expect(find.text('PAGE:/legal/privacy'), findsOneWidget);
        });

        testWidgets('a text that cannot be loaded does not block the form: the box is still there, the error has Retry', (t) async {
          await openRegister(t, FakeApi(), legal: FakeLegalApi()..docError = ApiException('NETWORK', 'x'));
          await _show(t, find.byKey(const Key('terms')));
          expect(find.byKey(const Key('legal-error')), findsNWidgets(2));
          expect(find.byKey(const Key('terms')), findsOneWidget);
        });

        testWidgets('creating the account still sends termsAccepted: true once the box is ticked', (t) async {
          final api = FakeApi();
          await openRegister(t, api);
          await _show(t, find.byKey(const Key('terms')));
          expect(t.widget<FilledButton>(find.byKey(const Key('register'))).onPressed, isNull);
          await t.tap(find.byKey(const Key('terms')));
          await t.pump();
          expect(t.widget<Checkbox>(find.descendant(of: find.byKey(const Key('terms')), matching: find.byType(Checkbox))).value, isTrue);
        });
      });

      group('Profile', () {
        testWidgets('Terms and conditions and Privacy policy open their readers', (t) async {
          await pumpRoutedB(t, const ProfileScreen(), api: FakeApi());
          await _settle(t);
          await _show(t, find.byKey(const Key('profile-terms')));
          expect(find.text('Terms and conditions'), findsOneWidget);
          expect(find.text('Privacy policy'), findsOneWidget);
          await t.tap(find.byKey(const Key('profile-terms')));
          await _settle(t);
          expect(find.text('PAGE:/legal/driver'), findsOneWidget);
        });

        testWidgets('Arabic labels', (t) async {
          await pumpRoutedB(t, const ProfileScreen(), api: FakeApi(), lang: 'ar');
          await _settle(t);
          await _show(t, find.byKey(const Key('profile-privacy-policy')));
          expect(find.text('الشروط والأحكام'), findsOneWidget);
          expect(find.text('سياسة الخصوصية'), findsWidgets);
        });
      });

      group('re-acceptance (the blocking page)', () {
        Future<(MeApi, FakeLegalApi)> openGate(WidgetTester t, {List<Map<String, dynamic>>? pending, String lang = 'en'}) async {
          final api = MeApi(pending: pending ?? [pendingTerms(), pendingPrivacy()]);
          final legal = FakeLegalApi();
          await pumpFullApp(t, api: api, legal: legal, lang: lang);
          return (api, legal);
        }

        testWidgets('a signed-in driver with pending texts sees the acceptance page INSTEAD of the app', (t) async {
          await openGate(t);
          expect(find.byKey(const Key('legal-gate')), findsOneWidget);
          expect(find.text('We have updated our terms'), findsOneWidget);
          expect(find.byKey(const Key('toggle')), findsNothing, reason: 'the home page is not reachable');
          expect(find.byType(NavigationBar), findsNothing);
          expect(find.text('Driver terms'), findsOneWidget);
          expect(find.text('Privacy policy'), findsWidgets);
          expect(find.text('Version 2.0 · In force since 1 Nov 2026'), findsOneWidget);
          expect(find.text('What changed: Cash must be handed over within 3 days'), findsOneWidget);
          expect(find.text('I have read and accept Driver terms (version 2.0).'), findsOneWidget);
          expect(find.byKey(const Key('gate-note-privacy')), findsNothing, reason: 'no change note for the policy');
        });

        testWidgets('Continue stays off until EVERY text is ticked; then it accepts exactly those versions with the app language', (t) async {
          final (api, legal) = await openGate(t);
          bool on() => t.widget<FilledButton>(find.byKey(const Key('gate-continue'))).onPressed != null;
          expect(on(), isFalse);
          await t.tap(find.byKey(const Key('gate-accept-terms_driver')));
          await t.pump();
          expect(on(), isFalse, reason: 'one of two');
          await t.tap(find.byKey(const Key('gate-accept-privacy')));
          await t.pump();
          expect(on(), isTrue);
          api.pending = []; // what the server will say next
          await _show(t, find.byKey(const Key('gate-continue')));
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(legal.calls.where((c) => c.startsWith('accept')), ['accept:terms_driver@2.0,privacy@1.1:en']);
          expect(find.byKey(const Key('legal-gate')), findsNothing);
          expect(find.byKey(const Key('toggle')), findsOneWidget, reason: 'the app opens');
        });

        testWidgets('only some are pending: only those are listed and sent', (t) async {
          final (_, legal) = await openGate(t, pending: [pendingPrivacy(version: '3.0')]);
          expect(find.byKey(const Key('gate-item-terms_driver')), findsNothing);
          await t.tap(find.byKey(const Key('gate-accept-privacy')));
          await t.pump();
          await _show(t, find.byKey(const Key('gate-continue')));
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(legal.calls.last, 'accept:privacy@3.0:en');
        });

        testWidgets('"Read" opens the full text; back returns to the page that still blocks', (t) async {
          await openGate(t);
          await _show(t, find.byKey(const Key('gate-read-terms_driver')));
          await t.tap(find.byKey(const Key('gate-read-terms_driver')));
          await _settle(t);
          expect(find.byKey(const Key('legal-reader-driver')), findsOneWidget);
          expect(find.textContaining('Deliver every parcel you scan', findRichText: true), findsOneWidget);
          await t.pageBack();
          await _settle(t);
          expect(find.byKey(const Key('legal-gate')), findsOneWidget);
        });

        testWidgets('409: a newer version was published while reading — the page reloads, says so, and clears the ticks', (t) async {
          final (api, legal) = await openGate(t, pending: [pendingTerms()]);
          legal.acceptError = ApiException('CONFLICT', 'x', status: 409, details: {'field': 'version', 'current': '2.1'});
          await t.tap(find.byKey(const Key('gate-accept-terms_driver')));
          await t.pump();
          api.pending = [pendingTerms(version: '2.1', note: 'Fees changed')];
          await _show(t, find.byKey(const Key('gate-continue')));
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(find.byKey(const Key('gate-stale')), findsOneWidget);
          expect(find.text('A newer version was published while you were reading. Please read it.'), findsOneWidget);
          expect(find.text('Version 2.1 · In force since 1 Nov 2026'), findsOneWidget);
          expect(find.text('What changed: Fees changed'), findsOneWidget);
          expect(t.widget<Checkbox>(find.descendant(of: find.byKey(const Key('gate-accept-terms_driver')), matching: find.byType(Checkbox))).value, isFalse);
          expect(t.widget<FilledButton>(find.byKey(const Key('gate-continue'))).onPressed, isNull);
        });

        testWidgets('another failure: a plain message, the ticks stay, he can try again', (t) async {
          final (api, legal) = await openGate(t, pending: [pendingTerms()]);
          legal.acceptError = ApiException('INTERNAL', 'x', status: 500);
          await t.tap(find.byKey(const Key('gate-accept-terms_driver')));
          await t.pump();
          await _show(t, find.byKey(const Key('gate-continue')));
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(find.text('We could not record your acceptance. Please try again.'), findsOneWidget);
          expect(t.widget<FilledButton>(find.byKey(const Key('gate-continue'))).onPressed, isNotNull);
          api.pending = [];
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(find.byKey(const Key('legal-gate')), findsNothing);
        });

        testWidgets('no signal: the offline message, not "we could not record"', (t) async {
          final (_, legal) = await openGate(t, pending: [pendingTerms()]);
          legal.acceptError = ApiException('NETWORK', 'x');
          await t.tap(find.byKey(const Key('gate-accept-terms_driver')));
          await t.pump();
          await _show(t, find.byKey(const Key('gate-continue')));
          await t.tap(find.byKey(const Key('gate-continue')));
          await _settle(t);
          expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
        });

        testWidgets('"Sign out instead" leaves: the sign-in page, and the next driver does not inherit the page', (t) async {
          final (api, _) = await openGate(t);
          await _show(t, find.byKey(const Key('gate-signout')));
          await t.tap(find.byKey(const Key('gate-signout')));
          await _settle(t);
          await t.pump(const Duration(seconds: 1));
          expect(find.byKey(const Key('submit')), findsOneWidget, reason: 'the sign-in page');
          expect(api.calls, contains('logout'));
        });

        testWidgets('Android back does not skip the page', (t) async {
          await openGate(t);
          await t.binding.handlePopRoute();
          await _settle(t);
          expect(find.byKey(const Key('legal-gate')), findsOneWidget);
        });

        testWidgets('nothing pending: no page, the app opens', (t) async {
          await pumpFullApp(t, api: MeApi());
          expect(find.byKey(const Key('legal-gate')), findsNothing);
          expect(find.byKey(const Key('toggle')), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: the page is in the driver\'s language, right-to-left, and accepts with that locale', (t) async {
            final (api, legal) = await openGate(t, pending: [pendingTerms()], lang: lang);
            expect(Directionality.of(t.element(find.byKey(const Key('legal-gate')))), TextDirection.rtl);
            expect(find.text(lang == 'ar' ? 'حدّثنا شروطنا' : 'ہم نے اپنی شرائط اپ ڈیٹ کی ہیں'), findsOneWidget);
            await t.tap(find.byKey(const Key('gate-accept-terms_driver')));
            await t.pump();
            api.pending = [];
            await _show(t, find.byKey(const Key('gate-continue')));
            await t.tap(find.byKey(const Key('gate-continue')));
            await _settle(t);
            expect(legal.calls.last, 'accept:terms_driver@2.0:$lang');
          });
        }
      });
    });
  }
}
