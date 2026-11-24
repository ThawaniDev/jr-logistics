import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/privacy_repo.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';
import 'privacy_widgets.dart';

/// `/privacy` — "Privacy & data": download a copy of the driver's data, ask for the account to be erased (what blocks it is listed up-front), withdraw
/// that request, and the privacy policy. Apple requires account deletion to be possible inside the app; the team approves each request, because money,
/// cash and open jobs have to be settled first.
class PrivacyScreen extends ConsumerStatefulWidget {
  const PrivacyScreen({super.key});
  @override
  ConsumerState<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends ConsumerState<PrivacyScreen> {
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void dispose() { _reason.dispose(); super.dispose(); }

  Future<void> _requestDeletion() async {
    if (_busy) return;
    final sure = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
      title: Text(d.tr('pv.confirm_title')), content: Text(d.tr('pv.confirm_body')),
      actions: [
        TextButton(style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))),
        FilledButton(key: const Key('privacy-confirm'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48), backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('pv.confirm_btn'))),
      ],
    ));
    if (sure != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(privacyRepoProvider).requestDeletion(_reason.text);
      await markDeletionRequest(ref.read(prefsProvider), true);
      if (!mounted) return;
      toast(context, context.tr('pv.req_sent'));
      _reason.clear();
    } catch (e) {
      // 409 ERASURE_BLOCKED / CONFLICT: the picture changed since the page was read — show it again (the blockers are listed) instead of a bare error.
      if (mounted) toast(context, errMessage(context, e), error: true);
    } finally {
      ref.invalidate(privacyStatusProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withdraw() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref.read(privacyRepoProvider).cancelDeletion();
      await markDeletionRequest(ref.read(prefsProvider), false);
      if (mounted) toast(context, context.tr('pv.req_withdrawn'));
    } catch (e) {
      if (mounted) toast(context, errMessage(context, e), error: true);
    } finally {
      ref.invalidate(privacyStatusProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  String _blockerText(Strings t, PrivacyBlocker b, String lang) {
    final key = 'pv.blocker_${b.code}';
    return t.has(key) ? t(key, {'n': b.count, 'amount': fmtMoney(b.amountCents, lang)}) : t('lm.blocker_unknown');
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final st = ref.watch(privacyStatusProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t('pv.card_title'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(privacyStatusProvider); await ref.read(privacyStatusProvider.future).catchError((_) => PrivacyStatus(const {})); },
        child: AsyncBody<PrivacyStatus>(value: st, onRetry: () => ref.invalidate(privacyStatusProvider), builder: (s) => ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
          Text(t('pv.card_sub'), style: TextStyle(color: JR.muted, height: 1.45)),
          const SizedBox(height: 16),
          // ── download ──
          SectionCard(key: const Key('privacy-export-card'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(t('pv.export_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5)),
            const SizedBox(height: 6),
            Text(t('pv.export_body'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.45)),
            if (s.lastExportAt != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('pv.export_last', {'time': fmtDateTime(s.lastExportAt, lang)}), key: const Key('privacy-export-last'), style: TextStyle(color: JR.muted, fontSize: 12.5))),
            const SizedBox(height: 12),
            const ExportDataButton(filled: true),
          ])),
          const SizedBox(height: 16),
          // ── delete ──
          SectionCard(key: const Key('privacy-delete-card'), border: s.request?.open == true ? JR.gold : null, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: _deleteSection(t, s, lang))),
          const SizedBox(height: 16),
          if (s.hasRetention) Text(t('pv.retention_body', {'days': s.notificationDays, 'months': s.recipientPiiMonths, 'years': s.closedAccountYears}), key: const Key('privacy-retention'), style: TextStyle(color: JR.muted, fontSize: 12.5, height: 1.45)),
          if (s.privacyEmail != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('pv.contact', {'email': s.privacyEmail}), key: const Key('privacy-contact'), textDirection: TextDirection.ltr, textAlign: TextAlign.start, style: TextStyle(color: JR.muted, fontSize: 12.5))),
          const SizedBox(height: 8),
          TextButton.icon(key: const Key('privacy-policy-link'), style: TextButton.styleFrom(minimumSize: const Size(48, 48)), onPressed: () => context.push('/legal/privacy'), icon: const Icon(Icons.menu_book_outlined), label: Text(t('pv.policy_link'))),
        ]))),
    );
  }

  List<Widget> _deleteSection(Strings t, PrivacyStatus s, String lang) {
    final r = s.request;
    final head = <Widget>[
      Text(t('pv.delete_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5)),
      const SizedBox(height: 6),
    ];
    if (!s.deletionSupported) {
      return [...head, Banner2(key: const Key('privacy-unsupported'), text: t('pv.blocker_role_not_supported'))];
    }
    if (r != null && r.open) {
      return [
        ...head,
        Banner2(key: const Key('privacy-request-open'), tone: Tone.warn, title: t('pv.req_open_title'), text: t('pv.req_open_body', {'time': fmtDateTime(r.requestedAt, lang)})),
        const SizedBox(height: 12),
        OutlinedButton.icon(key: const Key('privacy-cancel-request'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : _withdraw, icon: busyIcon(_busy, Icons.undo, color: JR.accent), label: Text(t('pv.req_withdraw'), textAlign: TextAlign.center)),
      ];
    }
    final blocked = s.blockers.isNotEmpty;
    return [
      ...head,
      Text(t('pv.delete_body'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.45)),
      if (r != null && r.rejected) ...[
        const SizedBox(height: 12),
        Banner2(key: const Key('privacy-request-rejected'), tone: Tone.danger, title: t('pv.req_rejected_title'), text: (r.decisionNote ?? '').trim().isEmpty ? t('pv.req_rejected_title') : r.decisionNote!.trim()),
      ],
      if (blocked) ...[
        const SizedBox(height: 12),
        Banner2(key: const Key('privacy-blockers'), tone: Tone.warn, title: t('pv.delete_blocked_title'), text: '${t('pv.delete_blocked_body')}\n${[for (final b in s.blockers) '• ${_blockerText(t, b, lang)}'].join('\n')}\n\n${t('lm.delete_blocked_hint')}'),
      ],
      const SizedBox(height: 12),
      TextField(key: const Key('privacy-reason'), controller: _reason, enabled: !_busy, maxLength: 500, minLines: 2, maxLines: 4, textInputAction: TextInputAction.done, decoration: InputDecoration(labelText: t('pv.reason_label'))),
      const SizedBox(height: 8),
      FilledButton.icon(key: const Key('privacy-delete'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: blocked || !s.canRequest || _busy ? null : _requestDeletion, icon: busyIcon(_busy, Icons.person_remove_outlined, color: JR.dangerInk), label: Text(t('pv.delete_btn'), textAlign: TextAlign.center)),
    ];
  }
}
