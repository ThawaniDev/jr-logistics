import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../providers.dart';
import '../../services_notify.dart';

class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final offers = ref.watch(offersProvider).value?.length ?? 0;
    // A new-offer alert that arrived since the driver last looked: a dot on the tab (the count follows once the list has refreshed).
    final fresh = ref.watch(offerAlertsProvider.select((s) => s.unseen));
    if (shell.currentIndex == 2 && fresh > 0) WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(offerAlertsProvider.notifier).clear());
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.today_outlined), selectedIcon: const Icon(Icons.today), label: t('m.tab_today')),
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: t('m.tab_jobs')),
          NavigationDestination(icon: Badge(key: const Key('offers-badge'), isLabelVisible: offers > 0 || fresh > 0, label: offers > 0 ? Text('$offers') : null, child: const Icon(Icons.work_outline)), selectedIcon: const Icon(Icons.work), label: t('m.tab_offers')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), selectedIcon: const Icon(Icons.account_balance_wallet), label: t('m.tab_earnings')),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: t('m.tab_profile')),
        ],
      ),
    );
  }
}

extension GoX on BuildContext {
  void openJob(String offerId) => push('/job/$offerId');
}
