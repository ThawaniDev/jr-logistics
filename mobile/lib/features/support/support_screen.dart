import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';

Tone ticketStatusTone(String status) => switch (status) { 'resolved' => Tone.success, 'in_review' => Tone.warn, _ => Tone.info };
String ticketStatusLabel(Strings t, String status) => t.has('status.$status') ? t('status.$status') : status;
String ticketCategoryLabel(Strings t, String category) => t.has('ticket_cat.$category') ? t('ticket_cat.$category') : t('ticket_cat.other');

/// The driver's support tickets (E15): status badge (open / in review / resolved), urgent flag, a dot on the ones with news.
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final tickets = ref.watch(ticketsProvider);
    final unread = ref.watch(unreadTicketRefsProvider);
    Future<void> reload() async { ref.invalidate(ticketsProvider); ref.invalidate(unreadNotificationsProvider); await ref.read(ticketsProvider.future); }
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.support'))),
      floatingActionButton: FloatingActionButton.extended(key: const Key('new-ticket'), onPressed: () => context.push('/support/new').then((_) => ref.invalidate(ticketsProvider)), icon: const Icon(Icons.add), label: Text(t('support.new_ticket')), backgroundColor: JR.accent, foregroundColor: JR.accentInk),
      body: RefreshIndicator(color: JR.accent, onRefresh: reload, child: AsyncBody<List<Ticket>>(value: tickets, onRetry: () => ref.invalidate(ticketsProvider), builder: (list) {
        if (list.isEmpty) {
          return ListView(physics: const AlwaysScrollableScrollPhysics(), children: [ConstrainedBox(constraints: const BoxConstraints(minHeight: 360), child: EmptyView(key: const Key('tickets-empty'), title: t('fmb.support_empty'), hint: t('fmb.support_empty_hint'), icon: Icons.support_agent))]);
        }
        return ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), itemCount: list.length + 1, separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, i) {
            if (i == 0) return Text(t('fmb.support_sub'), style: const TextStyle(color: JR.muted, height: 1.4));
            final x = list[i - 1];
            return _TicketCard(ticket: x, lang: lang, unread: unread.contains(x.ref), onTap: () => context.push('/support/${x.id}').then((_) { ref.invalidate(ticketsProvider); ref.invalidate(unreadNotificationsProvider); }));
          },
        );
      })),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket, required this.lang, required this.unread, required this.onTap});
  final Ticket ticket;
  final String lang;
  final bool unread;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final x = ticket;
    return SectionCard(key: Key('ticket-${x.id}'), border: unread ? JR.accent : null, onTap: onTap, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        if (unread) Padding(padding: const EdgeInsetsDirectional.only(end: 8), child: Semantics(label: t('fmb.unread'), child: Container(key: Key('ticket-unread-${x.id}'), width: 10, height: 10, decoration: const BoxDecoration(color: JR.accent, shape: BoxShape.circle)))),
        Expanded(child: Text(x.ref, textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 12.5, fontWeight: FontWeight.w700))),
        const SizedBox(width: 8),
        Flexible(child: Pill(ticketStatusLabel(t, x.status), key: Key('ticket-status-${x.id}'), tone: ticketStatusTone(x.status))),
      ]),
      const SizedBox(height: 8),
      Text(x.subject, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w700, fontSize: 16, height: 1.3)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        if (x.urgent) Pill(t('support.urgent'), key: Key('ticket-urgent-${x.id}'), tone: Tone.danger),
        Text(ticketCategoryLabel(t, x.category), style: const TextStyle(color: JR.muted, fontSize: 12.5)),
        Text('·', style: const TextStyle(color: JR.muted, fontSize: 12.5)),
        Text(fmtDateTime(x.updatedAt ?? x.createdAt, lang), style: const TextStyle(color: JR.muted, fontSize: 12.5)),
      ]),
    ]));
  }
}
