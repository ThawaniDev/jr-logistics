import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../data/models.dart';
import '../features/jobs/job_stats.dart';

/// The stat cards of an order card (My jobs, Today, Offers): shipments · to deliver · delivered · not delivered, and — when the job has cash on delivery —
/// the cash to collect and collected (history: collected and handed over). Every state shows them: an offer shows the expected parcels with nothing
/// delivered yet, a finished job its final result. Keys: `job-card-stats`, `card-stat-total|to-deliver|delivered|not-delivered|cash|collected|handed`.
class JobCardStats extends StatelessWidget {
  const JobCardStats({super.key, required this.job, required this.lang});
  final Job job;
  final String lang;

  @override
  Widget build(BuildContext context) {
    if (!JobStats.applies(job)) return const SizedBox.shrink();
    final t = context.tr;
    final st = JobStats.of(job);
    final cod = st.hasCod ? st.cod! : null;
    Widget tile(String k, String label, String value, {Color? color}) => StatTile(tileKey: 'card-stat-$k', label: label, value: value, color: color, dense: true);
    return LayoutBuilder(builder: (context, c) {
      const gap = 8.0;
      // Four across when there is room; two columns on a narrow card or at a large text size, so a label is never cut.
      final cols = c.maxWidth >= 270 && MediaQuery.textScalerOf(context).scale(1) <= 1.15 ? 4 : 2;
      final w = (c.maxWidth - gap * (cols - 1)) / cols;
      Widget box(Widget child) => SizedBox(width: w, child: child);
      final cash = <Widget>[
        // To collect only while there is something to collect; a finished job shows what happened to the cash instead.
        if (cod != null && (!st.isFinal || cod.toCollectCents > 0)) box(tile('cash', t('fma.stat_cash'), fmtMoney(cod.toCollectCents, lang), color: JR.gold)),
        if (cod != null) box(tile('collected', t('fmb.cash_collected'), fmtMoney(cod.collectedCents, lang), color: JR.cyan)),
        if (cod?.handedOverCents != null) box(tile('handed', t('fmb.cash_handed'), fmtMoney(cod!.handedOverCents, lang), color: JR.accent)),
      ];
      return Wrap(key: const Key('job-card-stats'), spacing: gap, runSpacing: gap, children: [
        box(tile('total', t('fma.stat_total'), '${st.total}')),
        box(tile('to-deliver', t('fma.stat_to_deliver'), '${st.toDeliver}', color: st.toDeliver > 0 ? JR.cyan : null)),
        box(tile('delivered', t('fma.stat_delivered'), '${st.delivered}', color: st.delivered > 0 ? JR.accent : null)),
        box(tile('not-delivered', t('fma.stat_not_delivered'), '${st.notDelivered}', color: st.notDelivered > 0 ? JR.danger : null)),
        ...cash,
      ]);
    });
  }
}
