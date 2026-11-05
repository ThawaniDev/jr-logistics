import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/i18n.dart';
import 'core/theme.dart';
import 'providers.dart';
import 'router.dart';
import 'widgets/common.dart';

class JrApp extends ConsumerWidget {
  const JrApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = ref.watch(localeProvider);
    final strings = ref.watch(stringsProvider);
    final auth = ref.watch(authProvider);
    return MaterialApp.router(
      title: 'JR Logistics',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: Locale(code),
      supportedLocales: [for (final c in supportedCodes) Locale(c)],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => Directionality(
        textDirection: isRtl(code) ? TextDirection.rtl : TextDirection.ltr,
        child: strings.when(
          data: (s) => StringsScope(strings: s, child: auth.isLoading ? const _Splash() : (auth.hasError && auth.value == null ? _BootError(onRetry: () => ref.invalidate(authProvider)) : (child ?? const SizedBox()))),
          loading: () => const _Splash(),
          error: (e, _) => Scaffold(body: Center(child: Text('$e'))),
        ),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.asset('assets/logo.png', width: 84, height: 84)),
        const SizedBox(height: 24), const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3, color: JR.accent)),
      ])));
}

class _BootError extends StatelessWidget {
  const _BootError({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Scaffold(body: ErrorView(error: 'network', onRetry: onRetry));
}
