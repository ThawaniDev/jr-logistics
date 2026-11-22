import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../router.dart';
import '../../services_notify.dart';

/// Keeps the new-offer alerts alive for the whole signed-in session. It sits ABOVE the navigator (in `MaterialApp.router.builder`) and does four things:
/// starts/stops the [OfferPoller] with the session, tells it when the app goes to / comes back from the background (and polls on resume), shows the
/// in-app banner when an alert arrives, and opens the Offers tab when the driver taps a notification (also the one that started the app).
class NotifyHost extends ConsumerStatefulWidget {
  const NotifyHost({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<NotifyHost> createState() => _NotifyHostState();
}

class _NotifyHostState extends ConsumerState<NotifyHost> {
  late final AppLifecycleListener _life;
  StreamSubscription<String?>? _taps;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(onStateChange: (s) {
      final p = ref.read(offerPollerProvider);
      if (p == null) return;
      p.setForeground(s == AppLifecycleState.resumed);
      if (s == AppLifecycleState.resumed) unawaited(p.pollOnce()); // single-flight: a poll already started by setForeground is not doubled
    });
    final notifier = ref.read(localNotifierProvider);
    _taps = notifier.taps.listen((_) => _openOffers());
    // The notification that started the app (cold start): the router redirects to the sign-in first when the session is gone.
    WidgetsBinding.instance.addPostFrameCallback((_) async { if (await notifier.takeLaunchPayload() != null && mounted) _openOffers(); });
  }

  void _openOffers() { if (mounted) ref.read(routerProvider).go('/offers'); }

  @override
  void dispose() { _taps?.cancel(); _life.dispose(); super.dispose(); }

  void _banner(OfferAlertsState s) {
    final text = s.banner;
    final m = ref.read(rootMessengerKeyProvider).currentState;
    final life = WidgetsBinding.instance.lifecycleState;
    final foreground = life == null || life == AppLifecycleState.resumed;
    if (text == null || m == null || !foreground) return; // in the background the system notification is the alert
    final strings = ref.read(stringsProvider).value;
    m..hideCurrentSnackBar()..showSnackBar(SnackBar(
      key: const Key('offer-banner'), duration: const Duration(seconds: 8),
      content: Semantics(liveRegion: true, child: Row(children: [Icon(Icons.work, color: JR.cyan, size: 20), const SizedBox(width: 10), Expanded(child: Text(text, maxLines: 3, overflow: TextOverflow.ellipsis))])),
      action: SnackBarAction(label: strings?.call('fmb.notify_view') ?? 'View', onPressed: _openOffers),
    ));
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(offerPollerProvider); // keeps the poller alive for the session; rebuilt (and the old one stopped) when the account changes
    ref.listen(offerAlertsProvider, (prev, next) { if (next.seq != prev?.seq && next.banner != null) _banner(next); });
    return widget.child;
  }
}
