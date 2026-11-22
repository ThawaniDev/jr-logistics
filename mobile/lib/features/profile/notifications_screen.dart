import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/notif_text.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart' show Json;
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';
import '../home/notify_prompt.dart';

final notificationsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).notifications());

IconData notificationIcon(String type) {
  if (type.startsWith('offer') || type == 'office_opportunity') return Icons.work_outline;
  if (type.startsWith('cod_')) return Icons.payments_outlined;
  if (type.startsWith('ticket_')) return Icons.support_agent;
  if (type == 'chat_message') return Icons.chat_bubble_outline;
  if (const ['payout_paid', 'withdrawal_paid', 'withdrawal_rejected', 'wallet_adjusted'].contains(type)) return Icons.account_balance_wallet_outlined;
  if (type.startsWith('document_') || type.startsWith('verification_')) return Icons.description_outlined;
  if (type.startsWith('cancel') || type.startsWith('suspension') || type == 'no_show_recorded') return Icons.warning_amber_rounded;
  return Icons.notifications_none;
}

/// The Offers and Earnings tabs are shell branches (`go` switches the tab); everything else is a page on top (`push`).
void openAppRoute(BuildContext context, String route) {
  if (route == '/offers' || route == '/wallet' || route == '/jobs') { context.go(route); } else { context.push(route); }
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _marking = false;
  /// Older notifications loaded with "Load more" (the server pages at 30). Dropped when the list is refreshed; rows the first page now shows are skipped.
  final _more = <Json>[];
  int _morePages = 0;

  void _refreshLists() { _more.clear(); _morePages = 0; ref.invalidate(notificationsProvider); ref.invalidate(unreadNotificationsProvider); }

  Future<void> _loadMore() async {
    final r = await ref.read(apiProvider).notifications(page: _morePages + 2);
    final rows = [for (final e in (r['items'] is List ? r['items'] as List : const []) ) if (e is Map) e.cast<String, dynamic>()];
    if (!mounted) return;
    setState(() { _more.addAll(rows); _morePages += 1; });
  }

  Future<void> _markAll() async {
    if (_marking) return;
    setState(() => _marking = true);
    final ok = await guarded(context, () async { await ref.read(extraApiProvider).markRead(); return true; });
    if (ok == true) _refreshLists();
    if (mounted) setState(() => _marking = false);
  }

  Future<void> _open(AppNotification n) async {
    final route = notificationRoute(n);
    if (n.unread) {
      // Fire and forget: the page must open even if marking fails (it is retried by "Mark all as read").
      ref.read(extraApiProvider).markRead(ids: [n.id]).then((_) => _refreshLists()).catchError((_) {});
    }
    if (route != null && mounted) openAppRoute(context, route);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final n = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.notifications'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { _refreshLists(); await ref.read(notificationsProvider.future); }, child: AsyncBody(value: n, onRetry: () => ref.invalidate(notificationsProvider), builder: (d) {
        final first = parseNotifications(d);
        final shown = {for (final n in first) n.id};
        final items = [...first, for (final n in parseNotifications({'items': _more})) if (!shown.contains(n.id)) n];
        final total = d['total'] is num ? (d['total'] as num).toInt() : 0;
        final hasMore = total > 0 && items.length < total;
        if (items.isEmpty) return ListView(physics: const AlwaysScrollableScrollPhysics(), children: [const NotifyOffBanner(padding: EdgeInsets.fromLTRB(16, 16, 16, 0)), ConstrainedBox(constraints: const BoxConstraints(minHeight: 320), child: EmptyView(title: t('m.notifications_empty'), icon: Icons.notifications_off_outlined))]);
        return ListView.separated(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), itemCount: items.length + 1 + (hasMore ? 1 : 0), separatorBuilder: (_, _) => const SizedBox(height: 8), itemBuilder: (_, i) {
          if (i == 0) {
            // The system-permission banner renders nothing unless the driver turned it down; "mark all" only while something is unread.
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const NotifyOffBanner(),
              if (items.any((x) => x.unread)) Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(key: const Key('notif-mark-all'), style: TextButton.styleFrom(minimumSize: const Size(48, 48)), onPressed: _marking ? null : _markAll, icon: busyIcon(_marking, Icons.done_all, color: JR.cyan), label: Text(t('notif.mark_all'), textAlign: TextAlign.center))),
            ]);
          }
          if (i == items.length + 1) return LoadMoreButton(onLoad: _loadMore);
          final x = items[i - 1];
          final text = notificationText(t, x); // never a raw {placeholder}
          final route = notificationRoute(x);
          return SectionCard(
            key: Key('notif-${x.id}'), border: x.unread ? JR.accent : null, onTap: route == null && !x.unread ? null : () => _open(x),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 1), child: Icon(notificationIcon(x.type), size: 22, color: x.unread ? JR.accent : JR.muted)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(text, style: TextStyle(fontWeight: x.unread ? FontWeight.w700 : FontWeight.w400, color: x.unread ? JR.text : JR.muted, height: 1.35)),
                const SizedBox(height: 4),
                Text(fmtDateTime(x.createdAt, lang), style: TextStyle(color: JR.muted, fontSize: 12)),
              ])),
              if (x.unread) Padding(padding: const EdgeInsetsDirectional.only(start: 8, top: 6), child: Semantics(label: t('fmb.unread'), child: Container(key: Key('notif-dot-${x.id}'), width: 10, height: 10, decoration: BoxDecoration(color: JR.accent, shape: BoxShape.circle)))),
              if (route != null) Padding(padding: EdgeInsetsDirectional.only(start: 4), child: Icon(Icons.chevron_right, color: JR.muted, size: 20)),
            ]),
          );
        });
      })),
    );
  }
}
