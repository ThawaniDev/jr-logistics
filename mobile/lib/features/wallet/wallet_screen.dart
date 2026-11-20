import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers_extra.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import '../cash/cash_screen.dart';
import 'wallet_managed.dart';

final withdrawalsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).withdrawals());

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});
  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  /// A withdrawal request is in flight: the button is disabled and shows a spinner, so a tap on a slow network cannot file it twice.
  bool _withdrawing = false;

  int _cents(Object? v) => v is num ? v.toInt() : 0;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final ov = ref.watch(overviewProvider).value;
    // A driver of an office has no wallet (the overview says so): do not even ask for one — the page is the calm "managed by your office" card + his cash.
    final AsyncValue<Json> w = ov?.walletManagedByOffice == true ? const AsyncData(<String, dynamic>{'managedByOffice': true}) : ref.watch(walletProvider);
    final managed = walletManagedByOffice(w.value, ov);
    final wd = managed ? null : ref.watch(withdrawalsProvider);
    Future<void> reload() async { ref.invalidate(walletProvider); ref.invalidate(withdrawalsProvider); ref.invalidate(cashProvider); ref.invalidate(overviewProvider); await ref.read(overviewProvider.future); if (!managed) await ref.read(walletProvider.future); }
    return Scaffold(
      appBar: AppBar(title: Text(t(managed ? 'drs.wallet_cash_title' : 'nav.earnings'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: reload, child: AsyncBody(value: w, onRetry: reload, builder: (d) {
        if (walletManagedByOffice(d, ov)) {
          return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
            ManagedWalletCard(officeName: walletOfficeName(d, ov)),
            const SizedBox(height: 20),
            const WalletCashSection(),
          ]);
        }
        final linked = ov?.officeLinked == true;
        final entries = ((d['entries'] as List?) ?? const []).whereType<Map>().toList();
        final available = _cents(d['availableCents']);
        return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
          if (linked) ...[Banner2(text: t('wallet.linked_note')), const SizedBox(height: 12)],
          SectionCard(border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('wallet.available'), style: const TextStyle(color: JR.muted)),
            const SizedBox(height: 6),
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(fmtMoney(available, lang), key: const Key('wallet-available'), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: JR.accent))),
            const SizedBox(height: 2),
            Text(t('um.wallet_available_hint'), style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.4)),
            const SizedBox(height: 4),
            Text(t('fmb.wallet_auto_note'), key: const Key('wallet-auto-note'), style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.4)),
            const SizedBox(height: 14),
            // E18: there is no approval step any more — earnings arrive when a job ends. The two other numbers keep their own labels:
            // "on hold" = an open complaint about a job holds its payment; "withdrawal requested" = money on its way to the bank.
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(child: _miniStat(t('fmb.wallet_on_hold'), fmtMoney(ov?.pendingCents ?? 0, lang), JR.gold, t('fmb.wallet_on_hold_hint'), const Key('wallet-on-hold'))),
              const SizedBox(width: 12),
              Expanded(child: _miniStat(t('fmb.wallet_in_withdrawal'), fmtMoney(_cents(d['heldCents']), lang), JR.muted, t('fmb.wallet_in_withdrawal_hint'), const Key('wallet-in-withdrawal'))),
            ]),
            if (!linked) ...[
              const SizedBox(height: 16),
              FilledButton.icon(key: const Key('withdraw'), onPressed: available > 0 && !_withdrawing ? () => _withdraw(context, ref, available, lang) : null, icon: busyIcon(_withdrawing, Icons.north_east), label: Text(t('wallet.withdraw'))),
              if (available <= 0) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('um.wallet_nothing_to_withdraw'), style: const TextStyle(color: JR.muted, fontSize: 12))),
            ],
          ])),
          const SizedBox(height: 20),
          if (wd?.value?.isNotEmpty == true) ...[
            Text(t('wallet.withdrawals'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            for (final x in wd!.value!) Padding(padding: const EdgeInsets.only(bottom: 8), child: SectionCard(child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(fmtMoney(_cents(x['amountCents']), lang), textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)), Text(fmtDateTime('${x['createdAt'] ?? ''}', lang), style: const TextStyle(color: JR.muted, fontSize: 12))])),
              Pill(t.has('wdstatus.${x['status']}') ? t('wdstatus.${x['status']}') : '${x['status'] ?? ''}', tone: switch (x['status']) { 'paid' => Tone.success, 'rejected' => Tone.danger, _ => Tone.warn }),
            ]))),
            const SizedBox(height: 12),
          ],
          Text(t('wallet.history'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (entries.isEmpty) EmptyView(title: t('wallet.no_entries'), icon: Icons.receipt_long_outlined) else for (final e in entries) ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(t.has('ledger.${e['kind']}') ? t('ledger.${e['kind']}') : t('um.ledger_other')),
            subtitle: Text(fmtDateTime('${e['createdAt'] ?? ''}', lang), style: const TextStyle(color: JR.muted, fontSize: 12)),
            trailing: Builder(builder: (_) { final a = _cents(e['availableDeltaCents']) != 0 ? _cents(e['availableDeltaCents']) : _cents(e['heldDeltaCents']); return Text(fmtMoney(a, lang), textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w800, color: a >= 0 ? JR.accent : JR.text)); }),
          ),
        ]);
      })),
    );
  }

  Widget _miniStat(String label, String value, Color color, String hint, Key key) => Column(key: key, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: JR.muted, fontSize: 12)),
        const SizedBox(height: 2),
        FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, textDirection: TextDirection.ltr, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800))),
        const SizedBox(height: 2),
        Text(hint, style: const TextStyle(color: JR.muted, fontSize: 11, height: 1.3)),
      ]);

  Future<void> _withdraw(BuildContext context, WidgetRef ref, int available, String lang) async {
    final c = TextEditingController();
    final cents = await showModalBottomSheet<int>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (b) => StatefulBuilder(builder: (b, set) {
      final v = sarToCents(c.text);
      final valid = v != null && v > 0 && v <= available;
      return SafeArea(child: Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(b).viewInsets.bottom), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(b.tr('wallet.withdraw'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6), Text(b.tr('wallet.withdraw_hint'), style: const TextStyle(color: JR.muted, fontSize: 13)),
        const SizedBox(height: 14),
        TextField(key: const Key('amount'), controller: c, autofocus: true, onChanged: (_) => set(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: const [LatinDigitsFormatter()], textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: b.tr('m.amount_to_withdraw'), helperText: '≤ ${fmtMoney(available, lang)}')),
        const SizedBox(height: 14),
        FilledButton(key: const Key('withdraw-submit'), onPressed: valid ? () => Navigator.pop(b, v) : null, child: Text(b.tr('common.confirm'))),
      ])));
    }));
    if (cents == null || !context.mounted || _withdrawing) return;
    setState(() => _withdrawing = true);
    try {
      await ref.read(apiProvider).requestWithdrawal(cents);
      if (context.mounted) toast(context, context.tr('wallet.withdraw_done'));
      ref.invalidate(walletProvider); ref.invalidate(withdrawalsProvider); ref.invalidate(overviewProvider);
    } catch (e) {
      if (!context.mounted) return;
      // No IBAN on file: withdrawing is impossible until one is added — send the driver straight to the editor.
      if (e is ApiException && e.details['field'] == 'iban') {
        final edit = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
          content: Text(d.tr('m.iban_missing'), key: const Key('iban-missing')),
          actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))), FilledButton(key: const Key('add-iban'), style: FilledButton.styleFrom(minimumSize: const Size(100, 44)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('m.add_iban')))],
        ));
        if (edit == true && context.mounted) context.push('/profile/edit');
      } else {
        toast(context, e is ApiException && e.isNetwork ? context.tr('um.withdraw_unconfirmed') : errMessage(context, e), error: true);
        // The request may have gone through even though the answer never arrived: refresh so the list tells the truth.
        if (e is ApiException && e.isNetwork) { ref.invalidate(withdrawalsProvider); ref.invalidate(walletProvider); }
      }
      return;
    } finally {
      if (mounted) setState(() => _withdrawing = false);
    }
  }
}
