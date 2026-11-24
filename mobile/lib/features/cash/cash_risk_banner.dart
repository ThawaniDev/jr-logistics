import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../widgets/common.dart';

/// The `{placeholders}` of the `cr.banner_*` texts (money as SAR text, like everywhere in the app).
Map<String, Object?> cashRiskVars(CashRisk c, String lang) => {
      'amount': fmtMoney(c.outstandingCents, lang), 'limit': fmtMoney(c.limitCents, lang), 'pct': c.pct ?? (c.limitCents > 0 ? (c.outstandingCents * 100 / c.limitCents).round() : 0),
      'overdue': fmtMoney(c.overdueCents, lang), 'maxDays': c.maxDays, 'days': c.oldestDays, 'lien': fmtMoney(c.lienCents, lang),
    };

/// Title and text of the banner for a state (`cr.banner_*`): over the limit and overdue read differently while offers are paused.
({String title, String text}) cashRiskTexts(Strings t, CashRisk c, String lang) {
  final v = cashRiskVars(c, lang);
  return switch (c.state) {
    CashState.warn => (title: t('cr.banner_warn_title'), text: t('cr.banner_warn', v)),
    CashState.overLimit => c.blocksOffers ? (title: t('cr.banner_over_limit_block_title'), text: t('cr.banner_over_limit_block', v)) : (title: t('cr.banner_over_limit_title'), text: t('cr.banner_over_limit', v)),
    CashState.overdue => c.blocksOffers ? (title: t('cr.banner_overdue_block_title'), text: t('cr.banner_overdue_block', v)) : (title: t('cr.banner_overdue_title'), text: t('cr.banner_overdue', v)),
    CashState.ok => (title: '', text: ''),
  };
}

/// Warns the driver about the cash he holds: close to the limit (amber), over the limit or overdue (red; new offers are paused when the platform says so), with what
/// to do about it — hand the cash to the warehouse; the warehouse's "receive money" lifts everything at once. Nothing at all while the state is `ok`.
/// [compact] (home) is the banner and a button to the cash page; the full version (the cash page itself) adds the share-of-limit bar and the two steps.
class CashRiskBanner extends StatelessWidget {
  const CashRiskBanner({super.key, required this.cash, required this.lang, this.compact = false});
  final CashRisk? cash;
  final String lang;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final c = cash;
    if (c == null || !c.atRisk) return const SizedBox.shrink();
    final t = context.tr;
    final texts = cashRiskTexts(t, c, lang);
    final tone = c.state == CashState.warn ? Tone.warn : Tone.danger;
    final color = tone == Tone.warn ? JR.gold : JR.danger;
    final showBar = !compact && c.limitCents > 0;
    return Banner2(
      key: const Key('cash-risk-banner'), tone: tone, title: texts.title, text: texts.text,
      action: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (showBar) ...[
          ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(key: const Key('cash-risk-bar'), value: ((c.pct ?? 0) / 100).clamp(0.0, 1.0), minHeight: 8, color: color, backgroundColor: JR.line, semanticsLabel: t('cr.banner_bar', cashRiskVars(c, lang)))),
          const SizedBox(height: 4),
          Text(t('cr.banner_bar', cashRiskVars(c, lang)), key: const Key('cash-risk-bar-label'), style: TextStyle(color: JR.muted, fontSize: 12)),
          const SizedBox(height: 10),
        ],
        if (c.lienCents > 0) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(t('cr.banner_lien', cashRiskVars(c, lang)), key: const Key('cash-risk-lien'), style: const TextStyle(height: 1.4, fontSize: 13.5))),
        if (!compact) ...[
          Text(t('cr.todo_title'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('1. ${t('cr.todo_1')}', style: const TextStyle(height: 1.4, fontSize: 13.5)),
          Text('2. ${t('cr.todo_2')}', style: const TextStyle(height: 1.4, fontSize: 13.5)),
        ] else
          OutlinedButton.icon(key: const Key('cash-risk-open'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: () => context.push('/cash'), icon: const Icon(Icons.payments_outlined), label: Text(t('cr.banner_open'), textAlign: TextAlign.center)),
      ]),
    );
  }
}
