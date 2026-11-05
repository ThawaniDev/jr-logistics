import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

final notificationsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).notifications());

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(seconds: 2), () async { if (mounted) { try { await ref.read(apiProvider).markNotificationsRead(); } catch (_) {} } });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final n = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.notifications'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(notificationsProvider); await ref.read(notificationsProvider.future); }, child: AsyncBody(value: n, onRetry: () => ref.invalidate(notificationsProvider), builder: (d) {
        final items = (d['items'] as List).cast<Map>();
        if (items.isEmpty) return ListView(children: [SizedBox(height: 320, child: EmptyView(title: t('m.notifications_empty'), icon: Icons.notifications_off_outlined))]);
        return ListView.separated(padding: const EdgeInsets.all(16), itemCount: items.length, separatorBuilder: (_, _) => const SizedBox(height: 8), itemBuilder: (_, i) {
          final x = items[i];
          final vars = {for (final e in ((x['data'] as Map?) ?? const {}).entries) '${e.key}': e.value is Map || e.value is List ? '' : '${e.value}'};
          return SectionCard(border: x['readAt'] == null ? JR.accent : null, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('notif.${x['type']}', vars), style: const TextStyle(fontWeight: FontWeight.w600, height: 1.35)),
            const SizedBox(height: 4), Text(fmtDateTime(x['createdAt'] as String, lang), style: const TextStyle(color: JR.muted, fontSize: 12)),
          ]));
        });
      })),
    );
  }
}
