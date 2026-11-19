import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';

/// The stat cards at the top of the driver's order page (E13), outside the stops panels: shipments · to deliver · delivered · not delivered, and — when
/// any parcel is cash on delivery — the cash to collect / already collected. Numbers come from `stopsSummary` and `cod` of the job view.
/// "To deliver" = parcels still on the vehicle (`loaded`); "not delivered" = failed + returned + missing.
class JobStatCards extends StatelessWidget {
  const JobStatCards({super.key, required this.job, this.lang = 'en'});
  final Job job;
  final String lang;

  /// Worth showing: a per-parcel job whose parcels are on the way (not before hand-over / during scan loading, where the scan panel has its own progress).
  static bool visible(Job j) {
    if (!j.manifest || j.status == 'offered') return false;
    final s = j.stopsSummary;
    if (s.total <= 0 || s.pending >= s.total) return false;
    return !j.inScanLoading;
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final s = job.stopsSummary;
    final cod = job.cod;
    Widget tile(String k, String label, String value, {Color? color, String? sub}) => _StatTile(tileKey: k, label: label, value: value, color: color, sub: sub);
    return Column(key: const Key('job-stats'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      LayoutBuilder(builder: (context, c) {
        const gap = 8.0;
        // One compact row when there is room; two columns on a narrow phone or at a large text size (labels must never be cut).
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final cols = c.maxWidth >= 330 && scale <= 1.15 ? 4 : 2;
        final w = (c.maxWidth - gap * (cols - 1)) / cols;
        Widget box(Widget child) => SizedBox(width: w, child: child);
        return Wrap(spacing: gap, runSpacing: gap, children: [
          box(tile('stat-total', t('fma.stat_total'), '${s.total}')),
          box(tile('stat-to-deliver', t('fma.stat_to_deliver'), '${s.loaded}', color: JR.cyan)),
          box(tile('stat-delivered', t('fma.stat_delivered'), '${s.delivered}', color: JR.accent)),
          box(tile('stat-not-delivered', t('fma.stat_not_delivered'), '${s.notDelivered}', color: s.notDelivered > 0 ? JR.danger : null)),
        ]);
      }),
      if (cod != null && cod.any) ...[
        const SizedBox(height: 8),
        tile('stat-cash', t('fma.stat_cash'), fmtMoney(cod.toCollectCents, lang), color: JR.gold, sub: t('fma.stat_cash_collected', {'amount': fmtMoney(cod.collectedCents, lang), 'n': cod.parcels})),
      ],
    ]);
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.tileKey, required this.label, required this.value, this.color, this.sub});
  final String tileKey, label, value;
  final Color? color;
  final String? sub;
  @override
  Widget build(BuildContext context) => Container(
        key: Key(tileKey), padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: JR.card, borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: (color ?? JR.line).withValues(alpha: color == null ? 1 : 0.5))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, key: Key('$tileKey-value'), textDirection: TextDirection.ltr, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, height: 1.15, color: color))),
          const SizedBox(height: 2),
          Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.25)),
          if (sub != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.25))),
        ]),
      );
}
