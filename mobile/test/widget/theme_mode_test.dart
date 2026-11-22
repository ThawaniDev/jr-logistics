import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jr_driver/app.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/core/theme_mode.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/router.dart';
import 'package:jr_driver/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// The real app (router, auth, i18n) with the driver signed in or out, and the stored appearance [prefs].
Future<ProviderContainer> pumpApp(WidgetTester t, {bool signedIn = true, Map<String, Object> prefs = const {}, Brightness? platform}) async {
  SharedPreferences.setMockInitialValues({'lang': 'en', ...prefs});
  final p = await SharedPreferences.getInstance();
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  t.platformDispatcher.platformBrightnessTestValue = platform ?? Brightness.light;
  addTearDown(t.platformDispatcher.clearPlatformBrightnessTestValue);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [
      prefsProvider.overrideWithValue(p), apiProvider.overrideWithValue(FakeApi()), tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
      if (signedIn) authProvider.overrideWith(SignedInAuth.new),
      stringsProvider.overrideWith((ref) async => strings(ref.watch(localeProvider))), linkOpenerProvider.overrideWithValue(FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation()),
      ...extraOverrides(api: FakeExtraApi(), notifier: FakeNotifier(permission: true)),
    ],
    child: const JrApp(),
  ));
  for (var i = 0; i < 5; i++) { await t.pump(const Duration(milliseconds: 200)); }
  return ProviderScope.containerOf(t.element(find.byType(JrApp)));
}

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

/// Every colour the visible tree paints with (text, icons, box fills and borders, Material fills), keyed by where it came from.
List<(String, Color)> paintedColors(WidgetTester t) {
  final out = <(String, Color)>[];
  void add(String what, Color? c) { if (c != null && c.a > 0.9) out.add((what, c)); }
  void walk(Element e) {
    final w = e.widget;
    if (w is RichText) { add('text', w.text.style?.color); }
    if (w is Icon) { add('icon', w.color); }
    if (w is DecoratedBox) {
      final d = w.decoration;
      if (d is BoxDecoration) { add('box fill', d.color); add('box border', d.border is Border ? (d.border! as Border).top.color : null); }
    }
    if (w is Material) { add('material', w.color); }
    e.visitChildren(walk);
  }
  t.binding.rootElement!.visitChildren(walk);
  return out;
}

/// The dark-only palette values (a colour the light palette never uses): if one is still painted in light mode, some widget kept the old palette.
Set<Color> get _darkOnly {
  const d = JrPalette.dark, l = JrPalette.light;
  // JR.ink (the signature ink / map pin) is the same navy as dark `bg`, so dark `bg` cannot prove anything and is left out on purpose.
  final fixedOrLight = <Color>{l.bg, l.bg2, l.card, l.accent, l.cyan, l.text, l.muted, l.line, l.gold, l.danger, l.fieldBorder, l.warnBg, l.shimmerBase, l.shimmerHi, JR.mediaBg};
  return <Color>{d.bg2, d.card, d.accent, d.cyan, d.text, d.muted, d.line, d.gold, d.danger}.difference(fixedOrLight);
}

void main() {
  group('persisted appearance (system / light / dark)', () {
    test('defaults to system; an unknown stored value also means system', () async {
      SharedPreferences.setMockInitialValues({});
      final c = ProviderContainer(overrides: [prefsProvider.overrideWithValue(await SharedPreferences.getInstance())]);
      addTearDown(c.dispose);
      expect(c.read(themeModeProvider), ThemeMode.system);
      SharedPreferences.setMockInitialValues({'theme': 'purple'});
      final c2 = ProviderContainer(overrides: [prefsProvider.overrideWithValue(await SharedPreferences.getInstance())]);
      addTearDown(c2.dispose);
      expect(c2.read(themeModeProvider), ThemeMode.system);
    });

    test('the choice is written to shared_preferences and read back by a fresh app start', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final c = ProviderContainer(overrides: [prefsProvider.overrideWithValue(prefs)]);
      addTearDown(c.dispose);
      for (final m in [ThemeMode.dark, ThemeMode.light, ThemeMode.system]) {
        await c.read(themeModeProvider.notifier).set(m);
        expect(c.read(themeModeProvider), m);
        expect(prefs.getString(themeModePrefKey), themeModeName(m));
        final fresh = ProviderContainer(overrides: [prefsProvider.overrideWithValue(prefs)]);
        addTearDown(fresh.dispose);
        expect(fresh.read(themeModeProvider), m, reason: 'a new start remembers $m');
      }
    });

    test('resolveBrightness: the choice wins, system follows the phone', () {
      expect(resolveBrightness(ThemeMode.light, Brightness.dark), Brightness.light);
      expect(resolveBrightness(ThemeMode.dark, Brightness.light), Brightness.dark);
      expect(resolveBrightness(ThemeMode.system, Brightness.dark), Brightness.dark);
      expect(resolveBrightness(ThemeMode.system, Brightness.light), Brightness.light);
      expect(parseThemeMode('light'), ThemeMode.light);
      expect(parseThemeMode(null), ThemeMode.system);
    });
  });

  group('Theme row in Profile', () {
    tearDown(() => JR.use(Brightness.dark));

    testWidgets('the row opens a sheet with System / Light / Dark; picking one applies at once, closes the sheet and is remembered', (t) async {
      final c = await pumpApp(t, prefs: {'theme': 'dark'}, platform: Brightness.light);
      c.read(routerProvider).go('/profile');
      await settle(t);
      expect(JR.isLight, isFalse);
      final row = find.byKey(const Key('profile-theme'));
      await t.scrollUntilVisible(row, 200, scrollable: find.byType(Scrollable).first);
      expect(find.descendant(of: row, matching: find.text('Dark')), findsOneWidget, reason: 'the row shows the current choice');
      await t.tap(row);
      await settle(t);
      for (final k in ['system', 'light', 'dark']) { expect(find.byKey(Key('theme-opt-$k')), findsOneWidget, reason: k); }
      expect(find.text('Appearance'), findsWidgets);
      expect(find.text('System default'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle), findsOneWidget, reason: 'exactly the current option is ticked');

      await t.tap(find.byKey(const Key('theme-opt-light')));
      await settle(t);
      expect(find.byKey(const Key('theme-opt-light')), findsNothing, reason: 'the sheet closed');
      expect(c.read(themeModeProvider), ThemeMode.light);
      expect(c.read(prefsProvider).getString('theme'), 'light');
      expect(JR.isLight, isTrue);
      expect(Theme.of(t.element(find.byType(Scaffold).first)).brightness, Brightness.light);
      expect(find.descendant(of: row, matching: find.text('Light')), findsOneWidget);
      expect(GoRouter.of(t.element(find.byType(NavigationBar))).state.matchedLocation, '/profile', reason: 'the router location is kept');

      await t.tap(row);
      await settle(t);
      await t.tap(find.byKey(const Key('theme-opt-system')));
      await settle(t);
      expect(c.read(themeModeProvider), ThemeMode.system);
      expect(c.read(prefsProvider).getString('theme'), 'system');
      expect(JR.isLight, isTrue, reason: 'system + a light phone = light');
    });

    testWidgets('the row and the sheet read in Arabic and Urdu (RTL)', (t) async {
      for (final (lang, title, dark) in [('ar', 'المظهر', 'داكن'), ('ur', 'ظاہری شکل', 'گہرا')]) {
        final c = await pumpApp(t, prefs: {'lang': lang, 'theme': 'dark'});
        c.read(routerProvider).go('/profile');
        await settle(t);
        final row = find.byKey(const Key('profile-theme'));
        await t.scrollUntilVisible(row, 200, scrollable: find.byType(Scrollable).first);
        expect(find.descendant(of: row, matching: find.text(title)), findsOneWidget, reason: lang);
        expect(find.descendant(of: row, matching: find.text(dark)), findsOneWidget, reason: lang);
        await t.tap(row);
        await settle(t);
        expect(t.takeException(), isNull);
        await t.pumpWidget(const SizedBox());
      }
    });
  });

  group('the root re-reads the palette without losing the app', () {
    tearDown(() => JR.use(Brightness.dark));

    testWidgets('light → dark → light: nothing keeps painting with the old palette, typed text and the router location survive', (t) async {
      final c = await pumpApp(t, signedIn: false, prefs: {'theme': 'dark'});
      expect(find.byKey(const Key('username')), findsOneWidget);
      await t.enterText(find.byKey(const Key('username')), 'demo.driver');
      await t.pump();
      expect(paintedColors(t).where((e) => e.$2 == JrPalette.dark.muted), isNotEmpty, reason: 'sanity: the login screen paints with the dark palette');
      expect(paintedColors(t).where((e) => e.$2 == JrPalette.dark.text), isNotEmpty);

      await c.read(themeModeProvider.notifier).set(ThemeMode.light);
      await settle(t);
      expect(JR.isLight, isTrue);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller?.text, 'demo.driver', reason: 'what the driver typed is kept (no re-keying of the tree)');
      expect(c.read(routerProvider).routerDelegate.currentConfiguration.uri.path, '/login');
      final stale = paintedColors(t).where((e) => _darkOnly.contains(e.$2)).toList();
      expect(stale, isEmpty, reason: 'still dark-palette colours after switching to light: $stale');
      expect(t.takeException(), isNull);

      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      await settle(t);
      expect(JR.isLight, isFalse);
      expect(t.widget<TextField>(find.byKey(const Key('username'))).controller?.text, 'demo.driver');
      expect(paintedColors(t).where((e) => e.$2 == JrPalette.light.muted), isEmpty, reason: 'no light-only muted left after going back to dark');
      expect(paintedColors(t).where((e) => e.$2 == JrPalette.dark.muted), isNotEmpty);
    });

    testWidgets('the signed-in app keeps its tab and every screen of the shell after a switch, in both directions', (t) async {
      final c = await pumpApp(t, prefs: {'theme': 'light'});
      expect(JR.isLight, isTrue);
      c.read(routerProvider).go('/wallet');
      await settle(t);
      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      await settle(t);
      expect(t.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 3, reason: 'still on the wallet tab');
      expect(paintedColors(t).where((e) => _darkOnly.contains(e.$2)), isNotEmpty);
      expect(t.takeException(), isNull);
    });

    testWidgets('an open bottom sheet is repainted too (overlay routes are part of the sweep)', (t) async {
      final c = await pumpApp(t, prefs: {'theme': 'dark'});
      c.read(routerProvider).go('/profile');
      await settle(t);
      final row = find.text('English'); // the language row's current value
      await t.scrollUntilVisible(row, 200, scrollable: find.byType(Scrollable).first);
      await t.tap(row);
      await settle(t);
      Color tick() => t.widget<Icon>(find.byIcon(Icons.check_circle)).color!;
      expect(tick(), JrPalette.dark.accent);
      await c.read(themeModeProvider.notifier).set(ThemeMode.light);
      await settle(t);
      expect(find.byIcon(Icons.check_circle), findsOneWidget, reason: 'the sheet is still open');
      expect(tick(), JrPalette.light.accent);
    });
  });

  group('system mode follows the phone while the app is running', () {
    tearDown(() => JR.use(Brightness.dark));

    testWidgets('the phone switches at sunset: the app follows; an explicit choice does not', (t) async {
      await pumpApp(t, signedIn: false, platform: Brightness.light);
      expect(JR.isLight, isTrue);
      expect(Theme.of(t.element(find.byType(Scaffold).first)).scaffoldBackgroundColor, JrPalette.light.bg);

      t.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await settle(t);
      expect(JR.isLight, isFalse);
      expect(Theme.of(t.element(find.byType(Scaffold).first)).scaffoldBackgroundColor, JrPalette.dark.bg);
      expect(paintedColors(t).where((e) => e.$2 == JrPalette.light.muted), isEmpty);
      expect(t.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor ?? Theme.of(t.element(find.byType(Scaffold).first)).scaffoldBackgroundColor, JrPalette.dark.bg);

      t.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await settle(t);
      expect(JR.isLight, isTrue);
      expect(paintedColors(t).where((e) => _darkOnly.contains(e.$2)), isEmpty);
    });

    testWidgets('an explicit Dark ignores the phone (and an explicit Light too)', (t) async {
      final c = await pumpApp(t, signedIn: false, prefs: {'theme': 'dark'}, platform: Brightness.light);
      expect(JR.isLight, isFalse);
      t.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await settle(t);
      expect(JR.isLight, isFalse);
      await c.read(themeModeProvider.notifier).set(ThemeMode.light);
      await settle(t);
      t.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await settle(t);
      expect(JR.isLight, isTrue);
    });

    testWidgets('the status bar icons follow the mode (dark icons on the light UI, light icons on the dark UI)', (t) async {
      final c = await pumpApp(t, signedIn: false, prefs: {'theme': 'light'});
      SystemUiOverlayStyle root() => t.widgetList<AnnotatedRegion<SystemUiOverlayStyle>>(find.byType(AnnotatedRegion<SystemUiOverlayStyle>)).first.value;
      expect(root().statusBarIconBrightness, Brightness.dark);
      expect(root().statusBarBrightness, Brightness.light);
      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      await settle(t);
      expect(root().statusBarIconBrightness, Brightness.light);
      expect(root().statusBarBrightness, Brightness.dark);
    });
  });
}
