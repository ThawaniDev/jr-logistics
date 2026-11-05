import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

final withdrawalsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).withdrawals());

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final w = ref.watch(walletProvider);
    final wd = ref.watch(withdrawalsProvider);
    final ov = ref.watch(overviewProvider).value;
    Future<void> reload() async { ref.invalidate(walletProvider); ref.invalidate(withdrawalsProvider); ref.invalidate(overviewProvider); await ref.read(walletProvider.future); }
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.earnings'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: reload, child: AsyncBody(value: w, onRetry: reload, builder: (d) {
        final linked = ov?.officeLinked == true;
        final entries = (d['entries'] as List).cast<Map>();
        return ListView(padding: const EdgeInsets.all(16), children: [
          if (linked) ...[Banner2(text: t('wallet.linked_note')), const SizedBox(height: 12)],
          SectionCard(border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('wallet.available'), style: const TextStyle(color: JR.muted)),
            const SizedBox(height: 6),
            Text(fmtMoney((d['availableCents'] as num).toInt(), lang), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: JR.accent)),
            const SizedBox(height: 4),
            Text('${t('wallet.held')}: ${fmtMoney((d['heldCents'] as num).toInt(), lang)}   ·   ${t('driver.pending_pay')}: ${fmtMoney(ov?.pendingCents ?? 0, lang)}', textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 12)),
            if (!linked) ...[const SizedBox(height: 16), FilledButton.icon(key: const Key('withdraw'), onPressed: (d['availableCents'] as num) > 0 ? () => _withdraw(context, ref, (d['availableCents'] as num).toInt(), lang) : null, icon: const Icon(Icons.north_east), label: Text(t('wallet.withdraw')))],
          ])),
          const SizedBox(height: 20),
          if (wd.value?.isNotEmpty == true) ...[
            Text(t('wallet.withdrawals'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            for (final x in wd.value!) Padding(padding: const EdgeInsets.only(bottom: 8), child: SectionCard(child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(fmtMoney((x['amountCents'] as num).toInt(), lang), textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), Text(fmtDateTime(x['createdAt'] as String, lang), style: const TextStyle(color: JR.muted, fontSize: 12))])),
              Pill(t('wdstatus.${x['status']}'), tone: switch (x['status']) { 'paid' => Tone.success, 'rejected' => Tone.danger, _ => Tone.warn }),
            ]))),
            const SizedBox(height: 12),
          ],
          Text(t('wallet.history'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (entries.isEmpty) EmptyView(title: t('wallet.no_entries'), icon: Icons.receipt_long_outlined) else for (final e in entries) ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(t('ledger.${e['kind']}')),
            subtitle: Text(fmtDateTime(e['createdAt'] as String, lang), style: const TextStyle(color: JR.muted, fontSize: 12)),
            trailing: Builder(builder: (_) { final a = (e['availableDeltaCents'] as num).toInt() != 0 ? (e['availableDeltaCents'] as num).toInt() : (e['heldDeltaCents'] as num).toInt(); return Text(fmtMoney(a, lang), textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w800, color: a >= 0 ? JR.accent : JR.text)); }),
          ),
        ]);
      })),
    );
  }

  Future<void> _withdraw(BuildContext context, WidgetRef ref, int available, String lang) async {
    final c = TextEditingController();
    final cents = await showModalBottomSheet<int>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (b) => StatefulBuilder(builder: (b, set) {
      final v = sarToCents(c.text);
      final valid = v != null && v > 0 && v <= available;
      return SafeArea(child: Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(b).viewInsets.bottom), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(b.tr('wallet.withdraw'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6), Text(b.tr('wallet.withdraw_hint'), style: const TextStyle(color: JR.muted, fontSize: 13)),
        const SizedBox(height: 14),
        TextField(key: const Key('amount'), controller: c, autofocus: true, onChanged: (_) => set(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: b.tr('m.amount_to_withdraw'), helperText: '≤ ${fmtMoney(available, lang)}')),
        const SizedBox(height: 14),
        FilledButton(key: const Key('withdraw-submit'), onPressed: valid ? () => Navigator.pop(b, v) : null, child: Text(b.tr('common.confirm'))),
      ])));
    }));
    if (cents == null || !context.mounted) return;
    final ok = await guarded(context, () => ref.read(apiProvider).requestWithdrawal(cents), success: 'wallet.withdraw_done');
    if (ok != null) { ref.invalidate(walletProvider); ref.invalidate(withdrawalsProvider); ref.invalidate(overviewProvider); }
  }
}
