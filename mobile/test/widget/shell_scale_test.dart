import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/features/home/shell.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';

void main() {
  for (final lang in ['en', 'ar', 'ur']) {
    testWidgets('bottom navigation: five tabs with $lang labels fit a 320 dp phone at the 1.4x text-scale cap', (t) async {
      SharedPreferences.setMockInitialValues({'lang': lang});
      final prefs = await SharedPreferences.getInstance();
      t.view.physicalSize = const Size(640, 1400);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      t.platformDispatcher.textScaleFactorTestValue = 1.4;
      addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
      final router = GoRouter(routes: [
        StatefulShellRoute.indexedStack(
          builder: (_, _, shell) => HomeShell(shell: shell),
          branches: [for (final p in ['/', '/jobs', '/offers', '/wallet', '/profile']) StatefulShellBranch(routes: [GoRoute(path: p, builder: (_, _) => const SizedBox())])],
        ),
      ]);
      await t.pumpWidget(ProviderScope(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(FakeApi()), tokenStoreProvider.overrideWithValue(MemoryTokenStore())], child: MaterialApp.router(
        theme: buildTheme(), locale: Locale(lang), routerConfig: router,
        builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: MediaQuery.withClampedTextScaling(maxScaleFactor: 1.4, child: w!))),
      )));
      await t.pump();
      await t.pump(const Duration(milliseconds: 100));
      expect(t.takeException(), isNull);
      expect(find.byType(NavigationBar), findsOneWidget);
    });
  }
}
