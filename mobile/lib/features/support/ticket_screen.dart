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
import 'attachments.dart';
import 'support_screen.dart';

/// One ticket as a conversation: the driver's messages and the support team's, with role badges and photos; a reply box while it is open;
/// "Mark as resolved"; and "Reopen" on a resolved ticket within the allowed window (14 days).
class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.ticketId});
  final String ticketId;
  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();
  final _att = AttachmentsController();
  final _scroll = ScrollController();
  bool _sending = false, _acting = false, _markedRead = false;

  @override
  void dispose() { _reply.dispose(); _att.dispose(); _scroll.dispose(); super.dispose(); }

  void _reload() { ref.invalidate(ticketProvider(widget.ticketId)); ref.invalidate(ticketsProvider); ref.invalidate(unreadNotificationsProvider); }

  /// Opening the ticket reads its "new reply / resolved / reopened" notifications, so the dot in the list and on the profile row goes away.
  Future<void> _markNotificationsRead(Ticket ticket) async {
    if (_markedRead) return;
    _markedRead = true;
    try {
      final list = await ref.read(unreadNotificationsProvider.future);
      final ids = [for (final n in list) if (n.type.startsWith('ticket_') && n.ref == ticket.ref) n.id];
      if (ids.isEmpty) return;
      await ref.read(extraApiProvider).markRead(ids: ids);
      ref.invalidate(unreadNotificationsProvider);
    } catch (_) {/* the cue just stays a little longer */}
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (_sending || text.isEmpty || _att.uploading || _att.hasFailed) return;
    setState(() => _sending = true);
    final ok = await guarded(context, () async { await ref.read(extraApiProvider).replyTicket(widget.ticketId, text, attachmentIds: _att.ids); return true; });
    if (!mounted) return;
    setState(() => _sending = false);
    if (ok != true) return;
    _reply.clear();
    _att.clear();
    _reload();
    WidgetsBinding.instance.addPostFrameCallback((_) { if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut); });
  }

  Future<void> _resolve() async {
    if (_acting) return;
    final sure = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
      title: Text(d.tr('bz.resolve_ticket')), content: Text(d.tr('fmb.ticket_resolve_body')),
      actions: [
        TextButton(style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))),
        FilledButton(key: const Key('resolve-confirm'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('common.confirm'))),
      ],
    ));
    if (sure != true || !mounted) return;
    setState(() => _acting = true);
    final r = await guarded(context, () => ref.read(extraApiProvider).resolveTicket(widget.ticketId), success: 'bz.ticket_resolved_ok');
    if (r != null) _reload();
    if (mounted) setState(() => _acting = false);
  }

  Future<void> _reopen() async {
    if (_acting) return;
    final text = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (b) => const _ReopenSheet());
    if (text == null || !mounted) return;
    setState(() => _acting = true);
    final r = await guarded(context, () => ref.read(extraApiProvider).reopenTicket(widget.ticketId, body: text), success: 'fmb.ticket_reopened_ok');
    if (r != null) _reload();
    if (mounted) setState(() => _acting = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final thread = ref.watch(ticketProvider(widget.ticketId));
    final ticket = thread.value?.ticket;
    if (ticket != null) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _markNotificationsRead(ticket); });
    return Scaffold(
      appBar: AppBar(title: Text(ticket?.ref ?? t('nav.support'), textDirection: TextDirection.ltr)),
      body: AsyncBody<TicketThread>(value: thread, onRetry: _reload, builder: (th) {
        final tk = th.ticket;
        final replies = th.replies;
        return Column(children: [
          Expanded(child: RefreshIndicator(color: JR.accent, onRefresh: () async { _reload(); await ref.read(ticketProvider(widget.ticketId).future); }, child: ListView(
            key: const Key('ticket-thread'), controller: _scroll, physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
              _Header(ticket: tk, lang: lang, busy: _acting, onResolve: _resolve),
              const SizedBox(height: 16),
              if (replies.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Text(t('fmb.ticket_no_messages'), textAlign: TextAlign.center, style: const TextStyle(color: JR.muted)))
              else for (final m in replies) Padding(padding: const EdgeInsets.only(bottom: 12), child: _Bubble(message: m, lang: lang)),
            ],
          ))),
          if (tk.resolved) _ResolvedBar(ticket: tk, busy: _acting, onReopen: _reopen, onNew: () => context.pushReplacement('/support/new'))
          else _Composer(controller: _reply, attachments: _att, sending: _sending, onSend: _send),
        ]);
      }),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.ticket, required this.lang, required this.busy, required this.onResolve});
  final Ticket ticket;
  final String lang;
  final bool busy;
  final VoidCallback onResolve;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final x = ticket;
    return SectionCard(key: const Key('ticket-header'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Pill(ticketStatusLabel(t, x.status), key: const Key('ticket-status'), tone: ticketStatusTone(x.status)),
        if (x.urgent) Pill(t('support.urgent'), key: const Key('ticket-urgent'), tone: Tone.danger),
      ]),
      const SizedBox(height: 10),
      Text(x.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, height: 1.3)),
      const SizedBox(height: 6),
      Text('${ticketCategoryLabel(t, x.category)} · ${fmtDateTime(x.createdAt, lang)}', style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.3)),
      if (!x.resolved) ...[
        const SizedBox(height: 12),
        OutlinedButton.icon(key: const Key('ticket-resolve'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : onResolve, icon: busyIcon(busy, Icons.check_circle_outline, color: JR.cyan), label: Text(t('bz.resolve_ticket'), textAlign: TextAlign.center)),
      ],
    ]));
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.lang});
  final TicketMessage message;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final m = message;
    final mine = m.mine;
    final atts = m.attachments;
    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: ConstrainedBox(constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.88), child: Container(
        key: Key('msg-${m.id}'), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: mine ? JR.accent.withValues(alpha: 0.12) : JR.card, borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: mine ? JR.accent.withValues(alpha: 0.5) : JR.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Pill(mine ? t('fmb.role_you') : t('fmb.role_support'), key: Key('role-${m.id}'), tone: mine ? Tone.success : Tone.info)),
            const SizedBox(width: 8),
            Flexible(child: Text(fmtDateTime(m.createdAt, lang), style: const TextStyle(color: JR.muted, fontSize: 12), overflow: TextOverflow.ellipsis)),
          ]),
          if (m.body.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: SelectableText(m.body, style: const TextStyle(height: 1.4))),
          if (atts.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Wrap(spacing: 8, runSpacing: 8, children: [for (final a in atts) AttachmentThumb(attachment: a)])),
        ]),
      )),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.attachments, required this.sending, required this.onSend});
  final TextEditingController controller;
  final AttachmentsController attachments;
  final bool sending;
  final VoidCallback onSend;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return Material(color: JR.bg2, child: SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 10), child: ListenableBuilder(
      listenable: Listenable.merge([controller, attachments]),
      builder: (_, _) {
        final can = controller.text.trim().isNotEmpty && !attachments.uploading && !attachments.hasFailed && !sending;
        return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(key: const Key('reply-body'), controller: controller, enabled: !sending, minLines: 1, maxLines: 4, maxLength: 2000, decoration: InputDecoration(hintText: t('fmb.ticket_reply_hint'), counterText: '')),
          const SizedBox(height: 8),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Align(alignment: AlignmentDirectional.centerStart, child: AttachmentsEditor(controller: attachments, compact: true))),
            const SizedBox(width: 8),
            FilledButton.icon(key: const Key('reply-send'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48)), onPressed: can ? onSend : null, icon: busyIcon(sending, Icons.send), label: Text(t('common.send'))),
          ]),
        ]);
      },
    ))));
  }
}

class _ResolvedBar extends StatelessWidget {
  const _ResolvedBar({required this.ticket, required this.busy, required this.onReopen, required this.onNew});
  final Ticket ticket;
  final bool busy;
  final VoidCallback onReopen, onNew;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final can = ticket.canReopen();
    return Material(color: JR.bg2, child: SafeArea(top: false, child: Padding(padding: const EdgeInsets.all(14), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(can ? t('fmb.ticket_resolved_can_reopen') : t('fmb.ticket_resolved_closed'), key: const Key('ticket-resolved-note'), style: const TextStyle(color: JR.muted, height: 1.4)),
      const SizedBox(height: 10),
      if (can) FilledButton.icon(key: const Key('ticket-reopen'), onPressed: busy ? null : onReopen, icon: busyIcon(busy, Icons.replay), label: Text(t('fmb.ticket_reopen')))
      else OutlinedButton.icon(key: const Key('ticket-new-instead'), onPressed: onNew, icon: const Icon(Icons.add), label: Text(t('support.new_ticket'))),
    ]))));
  }
}

/// The "why is it not solved?" sheet of Reopen. It owns its text controller, so the controller outlives the sheet's closing animation.
class _ReopenSheet extends StatefulWidget {
  const _ReopenSheet();
  @override
  State<_ReopenSheet> createState() => _ReopenSheetState();
}

class _ReopenSheetState extends State<_ReopenSheet> {
  final _c = TextEditingController();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final b = context;
    return SafeArea(child: Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(b).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(b.tr('fmb.ticket_reopen'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(b.tr('fmb.ticket_reopen_hint'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.4)),
        const SizedBox(height: 14),
        TextField(key: const Key('reopen-body'), controller: _c, minLines: 2, maxLines: 5, maxLength: 2000, decoration: InputDecoration(labelText: b.tr('fmb.ticket_reopen_note'))),
        const SizedBox(height: 10),
        FilledButton(key: const Key('reopen-confirm'), onPressed: () => Navigator.pop(b, _c.text.trim()), child: Text(b.tr('fmb.ticket_reopen'))),
      ]),
    ));
  }
}
