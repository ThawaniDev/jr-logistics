import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/i18n.dart';
import 'core/theme.dart';
import 'core/theme_mode.dart';
import 'features/home/notify_host.dart';
import 'features/update/update_screen.dart';
import 'providers.dart';
import 'router.dart';
import 'services_notify.dart';
import 'widgets/common.dart';

class JrApp extends ConsumerWidget {
  const JrApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = ref.watch(localeProvider);
    final strings = ref.watch(stringsProvider);
    final auth = ref.watch(authProvider);
    final mode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'JR Logistics',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light), darkTheme: buildTheme(Brightness.dark), themeMode: mode, themeAnimationDuration: Duration.zero, // JR.* colours switch instantly, so the Material theme must too
      locale: Locale(code),
      supportedLocales: [for (final c in supportedCodes) Locale(c)],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: ref.watch(routerProvider),
      scaffoldMessengerKey: ref.watch(rootMessengerKeyProvider), // lets a new-offer alert show its banner on whichever screen is open
      builder: (context, child) => PaletteHost(
        brightness: Theme.of(context).brightness, // already resolved by MaterialApp: the choice, or the phone's setting in `system` mode
        child: Directionality(
          textDirection: isRtl(code) ? TextDirection.rtl : TextDirection.ltr,
          // Large system fonts are honoured up to 1.4x: beyond that Arabic/Urdu labels (tabs, buttons) start to clip on small phones.
          child: MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.4,
            // NotifyHost sits at a constant place in the tree (new-offer alerts for the whole session); it never changes the shape of what is below it.
            child: NotifyHost(child: strings.when(
              // UpdateGate replaces everything (even a failed start) with the full-screen update page once the server or the catalog says the app is too old.
              data: (s) => StringsScope(strings: s, child: UpdateGate(child: auth.isLoading ? const _Splash() : (auth.hasError && auth.value == null ? _BootError(error: auth.error ?? 'network', onRetry: () => ref.invalidate(authProvider)) : _withBanner(context, ref, child ?? const SizedBox())))),
              loading: () => const _Splash(),
              error: (e, _) => Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$e', textAlign: TextAlign.center)))),
            )),
          ),
        ),
      ),
    );
  }
}

/// Slim "no connection" strip above everything while requests are failing for lack of signal.
/// The tree shape is identical online and offline (keyed body, constant wrappers) so the Navigator is never rebuilt from scratch
/// when the strip appears or disappears — that would throw away whatever the driver was typing.
Widget _withBanner(BuildContext context, WidgetRef ref, Widget child) {
  final online = ref.watch(onlineProvider);
  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    if (!online) SafeArea(bottom: false, child: ConnectionBanner(onRetry: () {
      ref.read(onlineProvider.notifier).set(true); // optimistic; the reloads below flip it back if still offline
      ref.invalidate(overviewProvider); ref.invalidate(offersProvider); ref.invalidate(activeJobsProvider);
    })),
    // While the strip is shown it already covers the status bar: the page below must not add that inset a second time.
    Expanded(key: const ValueKey('app-body'), child: MediaQuery.removePadding(context: context, removeTop: !online, child: child)),
  ]);
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.asset('assets/logo.png', width: 84, height: 84)),
        const SizedBox(height: 24), SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3, color: JR.accent)),
      ])));
}

class _BootError extends StatelessWidget {
  const _BootError({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Scaffold(body: SafeArea(child: ErrorView(error: error, onRetry: onRetry)));
}
