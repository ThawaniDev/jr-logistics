import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/app_info.dart';
import 'package:jr_driver/core/version_gate.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/features/update/update_screen.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../helpers_lm.dart';

/// Update L / M — the full-screen, non-dismissable update page: from a 426, and from the catalog's minimum on a cold start.
Json _app({String ios = '', String android = '', String iosUrl = 'https://apps.apple.com/app/jr-driver', String androidUrl = 'https://play.google.com/store/apps/details?id=jr'}) =>
    {'minVersion': {'ios': ios, 'android': android}, 'storeUrl': {'ios': iosUrl, 'android': androidUrl}};

const _info = UpgradeInfo(minVersion: '2.0.0', currentVersion: '1.0.0+1', platform: 'ios', storeUrl: 'https://apps.apple.com/app/jr-driver');

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('the update page', () {
        testWidgets('says what is wrong, which versions, and opens the store link of the platform', (t) async {
          final links = FakeLinks();
          await pumpRoutedB(t, const UpdateRequiredScreen(info: _info), api: FakeApi(), links: links);
          expect(find.text('Update required'), findsOneWidget);
          expect(find.textContaining('too old'), findsOneWidget);
          expect(find.text('Your version: 1.0.0+1 · required: 2.0.0'), findsOneWidget);
          expect(find.text('Open the App Store'), findsOneWidget);
          await t.tap(find.byKey(const Key('update-store')));
          await t.pump();
          expect(links.opened.map((u) => u.toString()), ['https://apps.apple.com/app/jr-driver']);
          expect(find.byKey(const Key('update-no-link')), findsNothing);
        });

        testWidgets('Android says Google Play; a platform the app does not know says "Update now"; a bare 426 uses the installed platform', (t) async {
          await pumpRoutedB(t, const UpdateRequiredScreen(info: UpgradeInfo(minVersion: '2.0.0', platform: 'android', storeUrl: 'https://play.google.com/store/apps/details?id=jr')), api: FakeApi());
          expect(find.text('Open Google Play'), findsOneWidget);
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const UpdateRequiredScreen(info: UpgradeInfo(platform: 'web', storeUrl: 'https://example.com/x')), api: FakeApi());
          expect(find.text('Update now'), findsOneWidget);
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const UpdateRequiredScreen(info: UpgradeInfo(storeUrl: 'https://example.com/x')), api: FakeApi(), overrides: [appInfoProvider.overrideWithValue(const AppInfo(version: '1.0.0', build: '1', platform: 'ios'))]);
          expect(find.text('Open the App Store'), findsOneWidget);
        });

        testWidgets('without a store link (not set yet, or not https) there is no button: the page says to open the store by hand', (t) async {
          for (final url in ['', 'javascript:alert(1)']) {
            await pumpRoutedB(t, UpdateRequiredScreen(info: UpgradeInfo(minVersion: '2.0.0', platform: 'ios', storeUrl: url)), api: FakeApi());
            expect(find.byKey(const Key('update-store')), findsNothing, reason: url);
            expect(find.byKey(const Key('update-no-link')), findsOneWidget, reason: url);
            expect(find.textContaining('Open the App Store or Google Play yourself'), findsOneWidget);
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('a store that cannot be opened says so (no silent tap)', (t) async {
          final links = FakeLinks()..succeed = false;
          await pumpRoutedB(t, const UpdateRequiredScreen(info: _info), api: FakeApi(), links: links);
          await t.tap(find.byKey(const Key('update-store')));
          await t.pump();
          await t.pump(const Duration(milliseconds: 300));
          expect(find.text('The store could not be opened. Open it yourself and update JR Driver.'), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: right-to-left, in the driver\'s language, nothing overflows at 1.4x on a small phone', (t) async {
            t.platformDispatcher.textScaleFactorTestValue = 1.4;
            addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
            await pumpRoutedB(t, const UpdateRequiredScreen(info: _info), api: FakeApi(), lang: lang, size: const Size(640, 1000));
            expect(Directionality.of(t.element(find.byKey(const Key('update-title')))), TextDirection.rtl);
            expect(find.text(lang == 'ar' ? 'التحديث مطلوب' : 'اپ ڈیٹ ضروری ہے'), findsOneWidget);
            expect(find.text(lang == 'ar' ? 'افتح App Store' : 'App Store کھولیں'), findsOneWidget);
            expect(t.takeException(), isNull);
          });
        }
      });

      group('inside the app', () {
        testWidgets('a 426 anywhere replaces the whole app by the update page; Android back does not leave it', (t) async {
          final c = await pumpFullApp(t, api: FakeApi());
          expect(find.byKey(const Key('toggle')), findsOneWidget, reason: 'the home page');
          c.read(upgradeProvider.notifier).require(_info);
          await t.pump();
          await t.pump(const Duration(milliseconds: 300));
          expect(find.byKey(const Key('update-required')), findsOneWidget);
          expect(find.byKey(const Key('toggle')), findsNothing, reason: 'nothing of the app is reachable');
          expect(find.byType(NavigationBar), findsNothing);
          await t.binding.handlePopRoute();
          await t.pump();
          expect(find.byKey(const Key('update-required')), findsOneWidget);
          expect(t.takeException(), isNull);
        });

        testWidgets('cold start: the catalog\'s minimum above the installed version shows the page, with that platform\'s store link', (t) async {
          final api = FakeApi()..catalogApp = _app(ios: '99.0.0', android: '99.0.0', iosUrl: 'https://apps.apple.com/app/jr-driver', androidUrl: 'https://play.google.com/store/apps/details?id=jr');
          final links = FakeLinks();
          await pumpFullApp(t, api: api, links: links);
          expect(find.byKey(const Key('update-required')), findsOneWidget);
          expect(find.text('Your version: 1.0.0+1 · required: 99.0.0'), findsOneWidget);
          await t.tap(find.byKey(const Key('update-store')));
          await t.pump();
          expect(links.opened.single.toString(), contains('play.google.com'), reason: 'the test host reports android');
        });

        testWidgets('cold start with a minimum that is met (or no minimum, or the catalog unreachable): the app opens normally', (t) async {
          for (final api in [FakeApi()..catalogApp = _app(ios: '1.0.0', android: '1.0.0+1'), FakeApi()..catalogApp = _app(), FakeApi()..catalogError = apiErr('NETWORK', 0), FakeApi()]) {
            await pumpFullApp(t, api: api);
            expect(find.byKey(const Key('update-required')), findsNothing);
            expect(find.byKey(const Key('toggle')), findsOneWidget);
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('"I have updated — check again" reads the catalog again: a lowered minimum brings the app back, an unchanged one says so', (t) async {
          final api = FakeApi()..catalogApp = _app(ios: '99.0.0', android: '99.0.0');
          await pumpFullApp(t, api: api);
          expect(find.byKey(const Key('update-required')), findsOneWidget);
          await t.tap(find.byKey(const Key('update-recheck')));
          await t.pump();
          await t.pump(const Duration(milliseconds: 300));
          expect(find.text('This version is still not supported. Please update the app.'), findsOneWidget);
          expect(find.byKey(const Key('update-required')), findsOneWidget);
          api.catalogApp = _app(ios: '1.0.0', android: '1.0.0');
          await t.pump(const Duration(seconds: 7)); // the toast goes
          await t.tap(find.byKey(const Key('update-recheck')));
          await t.pump();
          await t.pump(const Duration(milliseconds: 300));
          await t.pump(const Duration(milliseconds: 300));
          expect(find.byKey(const Key('update-required')), findsNothing);
          expect(find.byKey(const Key('toggle')), findsOneWidget);
        });

        testWidgets('Arabic app: the page is Arabic and right-to-left', (t) async {
          final api = FakeApi()..catalogApp = _app(ios: '99.0.0', android: '99.0.0');
          await pumpFullApp(t, api: api, lang: 'ar');
          expect(find.text('التحديث مطلوب'), findsOneWidget);
          expect(Directionality.of(t.element(find.byKey(const Key('update-title')))), TextDirection.rtl);
        });
      });
    });
  }

  test('UpdateGate exists for the app builder', () {
    expect(const UpdateGate(child: SizedBox()), isA<Widget>());
  });
}
