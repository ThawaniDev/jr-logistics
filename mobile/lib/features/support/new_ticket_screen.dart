import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';
import 'attachments.dart';
import 'support_screen.dart';

/// Opens a support ticket: category (from the platform catalog), subject, message, optionally one of the driver's jobs, and up to 3 photos.
class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.offerId});
  /// Pre-selects a job (e.g. when the ticket is opened from the job screen).
  final String? offerId;
  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _subject = TextEditingController(), _body = TextEditingController();
  final _att = AttachmentsController();
  String? _category, _offerId;
  bool _sending = false;

  @override
  void initState() { super.initState(); _offerId = widget.offerId; }

  @override
  void dispose() { _subject.dispose(); _body.dispose(); _att.dispose(); super.dispose(); }

  bool get _valid => _category != null && _subject.text.trim().length >= 3 && _body.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (_sending || !_valid || _att.uploading || _att.hasFailed) return;
    setState(() => _sending = true);
    final created = await guarded(context, () => ref.read(extraApiProvider).createTicket(category: _category!, subject: _subject.text.trim(), body: _body.text.trim(), offerId: _offerId, attachmentIds: _att.ids));
    if (!mounted) return;
    setState(() => _sending = false);
    if (created == null) return;
    ref.invalidate(ticketsProvider);
    toast(context, context.tr('fmb.ticket_created'));
    // Replace this form by the new ticket, so "back" returns to the list.
    if (created.id.isNotEmpty) { context.pushReplacement('/support/${created.id}'); } else { context.pop(); }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final cat = ref.watch(catalogProvider);
    final categories = cat.hasValue ? driverTicketCategories(cat.requireValue) : defaultDriverTicketCategories; // a failed catalog must not block asking for help
    final jobs = <String, Job>{
      for (final j in [...?ref.watch(activeJobsProvider).value, ...?ref.watch(historyJobsProvider).value]) if (j.offerId.isNotEmpty) j.offerId: j,
    };
    final sel = _offerId != null && jobs.containsKey(_offerId) ? _offerId : null;
    return Scaffold(
      appBar: AppBar(title: Text(t('support.new_ticket'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(t('fmb.ticket_new_hint'), style: const TextStyle(color: JR.muted, height: 1.4)),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          key: const Key('ticket-category'), initialValue: _category, isExpanded: true, decoration: InputDecoration(labelText: t('support.category')),
          items: [for (final c in categories) DropdownMenuItem(value: c, child: Text(ticketCategoryLabel(t, c), overflow: TextOverflow.ellipsis))],
          onChanged: _sending ? null : (v) => setState(() => _category = v),
        ),
        const SizedBox(height: 14),
        TextField(key: const Key('ticket-subject'), controller: _subject, enabled: !_sending, maxLength: 150, textInputAction: TextInputAction.next, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: t('support.subject'), counterText: '')),
        const SizedBox(height: 14),
        TextField(key: const Key('ticket-body'), controller: _body, enabled: !_sending, minLines: 4, maxLines: 8, maxLength: 2000, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: t('fmb.ticket_message'), alignLabelWithHint: true)),
        const SizedBox(height: 14),
        if (jobs.isNotEmpty) ...[
          DropdownButtonFormField<String?>(
            key: const Key('ticket-job'), initialValue: sel, isExpanded: true, decoration: InputDecoration(labelText: t('fmb.ticket_job'), helperText: t('fmb.ticket_job_hint'), helperMaxLines: 2),
            items: [
              DropdownMenuItem<String?>(value: null, child: Text(t('fmb.ticket_no_job'), overflow: TextOverflow.ellipsis)),
              for (final j in jobs.values) DropdownMenuItem<String?>(value: j.offerId, child: Text('${j.ref}${j.business != null ? ' · ${j.business}' : ''}', textDirection: TextDirection.ltr, overflow: TextOverflow.ellipsis)),
            ],
            onChanged: _sending ? null : (v) => setState(() => _offerId = v),
          ),
          const SizedBox(height: 14),
        ],
        Text(t('fmb.ticket_photos'), style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        AttachmentsEditor(controller: _att),
        const SizedBox(height: 20),
        ListenableBuilder(listenable: _att, builder: (_, _) {
          final busy = _att.uploading;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            FilledButton.icon(key: const Key('ticket-submit'), onPressed: _valid && !busy && !_att.hasFailed && !_sending ? _submit : null, icon: busyIcon(_sending, Icons.send), label: Text(t('common.submit'))),
            if (busy) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('um.uploading'), textAlign: TextAlign.center, style: const TextStyle(color: JR.muted, fontSize: 13))),
            if (_att.hasFailed && !busy) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('fmb.att_failed'), key: const Key('att-failed-note'), textAlign: TextAlign.center, style: const TextStyle(color: JR.danger, fontSize: 13, height: 1.3))),
          ]);
        }),
      ]),
    );
  }
}
