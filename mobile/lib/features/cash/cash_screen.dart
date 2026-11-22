import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';

/// "Cash with me" (E17): the cash the driver collected on delivery and has not yet handed to the warehouse. It is the warehouse's money — it never
/// touches the earnings wallet. The warehouse (or operations) records each hand-over, and it shows up here.
class CashScreen extends ConsumerWidget {
  const CashScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final cash = ref.watch(cashProvider);
    Future<void> reload() async { ref.invalidate(cashProvider); ref.invalidate(overviewProvider); await ref.read(cashProvider.future); }
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.cash_with_me'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: reload, child: AsyncBody<CashSummary>(value: cash, onRetry: () { ref.invalidate(cashProvider); }, builder: (c) => ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [CashSection(cash: c, lang: lang)]))),
    );
  }
}

/// The cash section as it appears under the wallet card of an office driver: a heading, then the same cards as the cash screen (it loads its own data).
class WalletCashSection extends ConsumerWidget {
  const WalletCashSection({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final cash = ref.watch(cashProvider);
    return Column(key: const Key('wallet-cash-section'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('drs.cash_section'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
      const SizedBox(height: 10),
      cash.when(
        data: (c) => CashSection(cash: c, lang: lang),
        loading: () => Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator(color: JR.accent))),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(cashProvider)),
      ),
    ]);
  }
}

/// Cash with me · collected · handed over · by order · recent hand-overs. Not scrollable itself: the screen that hosts it scrolls.
class CashSection extends StatelessWidget {
  const CashSection({super.key, required this.cash, required this.lang});
  final CashSummary cash;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final withMe = cash.outstandingCents;
    final orders = cash.orders, recent = cash.recent;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Banner2(key: const Key('cash-explain'), text: t('fmb.cash_explain')),
      const SizedBox(height: 12),
      SectionCard(key: const Key('cash-with-me'), border: withMe > 0 ? JR.gold : JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(t('fmb.cash_with_me'), style: TextStyle(color: JR.muted)),
        const SizedBox(height: 6),
        FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(fmtMoney(withMe, lang), key: const Key('cash-with-me-amount'), textDirection: TextDirection.ltr, style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: withMe > 0 ? JR.gold : JR.accent))),
        const SizedBox(height: 4),
        Text(withMe > 0 ? t('fmb.cash_with_me_hint') : t('fmb.cash_nothing_with_me'), style: TextStyle(color: JR.muted, fontSize: 12.5, height: 1.4)),
      ])),
      const SizedBox(height: 12),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: _Stat(key: const Key('cash-collected'), label: t('fmb.cash_collected'), cents: cash.collectedCents, lang: lang, color: JR.cyan)),
        const SizedBox(width: 12),
        Expanded(child: _Stat(key: const Key('cash-received'), label: t('fmb.cash_handed'), cents: cash.receivedCents, lang: lang, color: JR.accent)),
      ]),
      const SizedBox(height: 20),
      if (cash.isEmpty) EmptyView(key: const Key('cash-empty'), title: t('fmb.cash_empty'), hint: t('fmb.cash_empty_hint'), icon: Icons.payments_outlined)
      else ...[
        if (orders.isNotEmpty) ...[
          Text(t('fmb.cash_orders'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final o in orders) Padding(padding: const EdgeInsets.only(bottom: 10), child: _OrderCard(order: o, lang: lang)),
        ],
        if (recent.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(t('fmb.cash_recent'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final h in recent) Padding(padding: const EdgeInsets.only(bottom: 8), child: _HandoverRow(h: h, lang: lang)),
        ],
      ],
    ]);
  }
}

class _Stat extends StatelessWidget {
  const _Stat({super.key, required this.label, required this.cents, required this.lang, required this.color});
  final String label, lang;
  final int cents;
  final Color color;
  @override
  Widget build(BuildContext context) => SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(color: JR.muted, fontSize: 12, height: 1.3)),
        const SizedBox(height: 6),
        FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(fmtMoney(cents, lang), textDirection: TextDirection.ltr, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800))),
      ]));
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order, required this.lang});
  final CashOrder order;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final o = order;
    Widget line(String label, int cents, {Color? color, bool bold = false}) => Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(color: JR.muted, fontSize: 13))),
          const SizedBox(width: 8),
          Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerEnd, child: Text(fmtMoney(cents, lang), textDirection: TextDirection.ltr, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: color)))),
        ]));
    return SectionCard(key: Key('cash-order-${o.offerId}'), border: o.outstandingCents > 0 ? JR.gold : null, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(o.ref, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        const SizedBox(width: 8),
        Flexible(child: o.outstandingCents <= 0 ? Pill(t('fmb.cash_settled'), tone: Tone.success) : Pill(t('fmb.cash_to_hand'), tone: Tone.warn)),
      ]),
      if (o.businessName.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text('${t('fmb.cash_warehouse')}: ${o.businessName}', style: TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
      if (o.parcels > 0) Padding(padding: const EdgeInsets.only(top: 2), child: Text(t('fmb.cash_parcels', {'n': o.parcels}), style: TextStyle(color: JR.muted, fontSize: 13))),
      const SizedBox(height: 8),
      line(t('fmb.cash_collected'), o.collectedCents),
      line(t('fmb.cash_handed'), o.receivedCents, color: JR.accent),
      line(t('fmb.cash_with_me_short'), o.outstandingCents, color: o.outstandingCents > 0 ? JR.gold : JR.muted, bold: true),
      if (o.lastCollectedAt != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('fmb.cash_last', {'d': fmtDateTime(o.lastCollectedAt, lang)}), style: TextStyle(color: JR.muted, fontSize: 12))),
    ]));
  }
}

class _HandoverRow extends StatelessWidget {
  const _HandoverRow({required this.h, required this.lang});
  final CashHandover h;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final who = [if ((h.receivedByName ?? '').isNotEmpty) h.receivedByName!, h.receivedByRole == 'business' ? t('fmb.cash_by_warehouse') : t('fmb.cash_by_ops')].join(' · ');
    return SectionCard(key: Key('cash-handover-${h.id}'), padding: const EdgeInsets.all(12), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: EdgeInsets.only(top: 2), child: Icon(Icons.call_received, color: JR.accent, size: 20)),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(h.ref, textDirection: TextDirection.ltr, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
          const SizedBox(width: 8),
          Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerEnd, child: Text(fmtMoney(h.amountCents, lang), textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w800, color: JR.accent)))),
        ]),
        Padding(padding: const EdgeInsets.only(top: 2), child: Text(t('fmb.cash_received_by', {'who': who}), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
        if ((h.note ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(h.note!, style: const TextStyle(fontSize: 13, height: 1.3))),
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(fmtDateTime(h.createdAt, lang), style: TextStyle(color: JR.muted, fontSize: 12))),
      ])),
    ]));
  }
}
