import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/legal_api.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

/// The blocking re-acceptance page: a newer version of the driver terms or the privacy policy asked for it (`GET /auth/me` → `legal.pending`). The router
/// keeps a signed-in driver here until every listed text is accepted (`POST /legal/accept`); signing out is the only other way out.
/// A `409` (a newer version was published while the driver read) reloads the list and says so.
class LegalGateScreen extends ConsumerStatefulWidget {
  const LegalGateScreen({super.key});
  @override
  ConsumerState<LegalGateScreen> createState() => _LegalGateScreenState();
}

class _LegalGateScreenState extends ConsumerState<LegalGateScreen> {
  final _ticked = <String>{};
  bool _busy = false;
  String? _error;
  bool _stale = false;

  String _id(PendingLegal p) => '${p.kind}@${p.version}';

  Future<void> _accept(List<PendingLegal> pending) async {
    if (_busy) return;
    setState(() { _busy = true; _error = null; _stale = false; });
    final auth = ref.read(authProvider.notifier);
    try {
      final r = await ref.read(legalApiProvider).accept(pending, ref.read(localeProvider));
      final left = r['pending'];
      if (left is List) { auth.setLegalPending(PendingLegal.parseList(left)); } else { await auth.refreshLegal(); }
    } on ApiException catch (e) {
      if (e.code == 'CONFLICT' && (e.details['field'] == 'version' || e.status == 409)) {
        await auth.refreshLegal(); // a newer version is in force: the list below changes, the driver reads it
        if (mounted) setState(() { _stale = true; _ticked.clear(); });
      } else if (mounted) {
        setState(() => _error = e.isNetwork ? errMessage(context, e) : context.tr('lg.gate_failed'));
      }
    } catch (_) {
      if (mounted) setState(() => _error = context.tr('lg.gate_failed'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final pending = ref.watch(authProvider.select((a) => a.value?.legalPending)) ?? const <PendingLegal>[];
    final all = pending.isNotEmpty && pending.every((p) => _ticked.contains(_id(p)));
    return PopScope(
      canPop: false,
      child: Scaffold(
        key: const Key('legal-gate'),
        appBar: AppBar(automaticallyImplyLeading: false, title: Text(t('lg.gate_title'))),
        body: SafeArea(child: ListView(padding: const EdgeInsets.all(20), children: [
          Text(t('lg.gate_sub'), style: TextStyle(color: JR.muted, height: 1.45)),
          const SizedBox(height: 4),
          Text(t('lm.gate_read_hint'), style: TextStyle(color: JR.muted, height: 1.45, fontSize: 13)),
          if (_stale) ...[const SizedBox(height: 12), Banner2(key: const Key('gate-stale'), tone: Tone.warn, text: t('lg.gate_stale'))],
          const SizedBox(height: 16),
          for (final p in pending) Padding(padding: const EdgeInsets.only(bottom: 12), child: SectionCard(key: Key('gate-item-${p.kind}'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(p.title.isNotEmpty ? p.title : t(p.slug == legalPrivacySlug ? 'lm.privacy_policy_title' : 'lm.terms_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5, height: 1.3)),
            const SizedBox(height: 2),
            Text([t('lg.version', {'v': p.version}), if (p.effectiveAt != null) t('lg.effective', {'date': fmtDateTime(p.effectiveAt, lang).split(' · ').first})].join(' · '), style: TextStyle(color: JR.muted, fontSize: 13)),
            if ((p.changeNote ?? '').trim().isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('lg.what_changed', {'note': p.changeNote!.trim()}), key: Key('gate-note-${p.kind}'), style: const TextStyle(height: 1.4, fontSize: 14))),
            const SizedBox(height: 8),
            Align(alignment: AlignmentDirectional.centerStart, child: OutlinedButton.icon(key: Key('gate-read-${p.kind}'), onPressed: () => context.push('/legal/${p.slug}'), icon: const Icon(Icons.menu_book_outlined), label: Text(t('lg.read')))),
            CheckboxListTile(
              key: Key('gate-accept-${p.kind}'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: JR.accent, checkColor: JR.accentInk,
              value: _ticked.contains(_id(p)), onChanged: _busy ? null : (v) => setState(() { if (v == true) { _ticked.add(_id(p)); } else { _ticked.remove(_id(p)); } }),
              title: Text(t('lg.gate_accept', {'title': p.title.isNotEmpty ? p.title : t(p.slug == legalPrivacySlug ? 'lm.privacy_policy_title' : 'lm.terms_title'), 'v': p.version}), style: const TextStyle(fontSize: 14, height: 1.35)),
            ),
          ]))),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Banner2(key: const Key('gate-error'), tone: Tone.danger, text: _error!)),
          FilledButton(key: const Key('gate-continue'), onPressed: all && !_busy ? () => _accept(pending) : null, child: _busy ? SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('lg.gate_continue'), textAlign: TextAlign.center)),
          const SizedBox(height: 8),
          TextButton(key: const Key('gate-signout'), style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: _busy ? null : () => ref.read(authProvider.notifier).signOut(), child: Text(t('lg.gate_signout'), textAlign: TextAlign.center)),
        ])),
      ),
    );
  }
}
