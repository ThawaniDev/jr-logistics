import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';

/// The numbers behind every stat card (job page, shipments header, order cards): shipments · to deliver · delivered · not delivered and, when the job has
/// cash on delivery, the cash to collect / collected / handed over. They come from `stopsSummary` once the parcels are on the vehicle; before that (an offer,
/// an accepted job, loading) they come from the offer itself — expected parcels, nothing delivered yet.
class JobStats {
  const JobStats({required this.total, required this.toDeliver, required this.delivered, required this.notDelivered, this.failed = 0, this.returned = 0, this.cod, this.isFinal = false, this.fromOffer = false});
  final int total, toDeliver, delivered, notDelivered, failed, returned;
  /// Null when the job has no cash on delivery.
  final JobCod? cod;
  /// The job is over: the numbers are its final result.
  final bool isFinal;
  /// Planned numbers (the parcels are not on the vehicle yet).
  final bool fromOffer;
  bool get hasCod => cod != null && cod!.any;
  int get handled => delivered + notDelivered;

  static const _finalStatuses = {'completed', 'delivered_reported', 'pending_settlement', 'qty_disputed'};
  static const _deadStatuses = {'cancelled', 'rejected', 'expired', 'no_show', 'replaced'};

  /// The server's `stats` of the job view (J5) when it sends them: it counts for every state, including offers (`estimated`).
  static JobStats? _fromServer(Job j) {
    final m = j.serverStats;
    int n(String k) { final v = m?[k]; return v is num ? v.toInt() : 0; }
    if (m == null || m['total'] is! num) return null;
    final cod = m['cod'] is Map ? JobCod((m['cod'] as Map).cast<String, dynamic>()) : null;
    final fin = j.status == 'completed' || j.status == 'delivered_reported' || j.status == 'pending_settlement';
    return JobStats(total: n('total'), toDeliver: n('toDeliver'), delivered: n('delivered'), notDelivered: n('notDelivered'), failed: n('failed'), returned: n('returned'), cod: cod != null && cod.any ? cod : null, isFinal: fin, fromOffer: m['estimated'] == true);
  }

  factory JobStats.of(Job j) {
    final server = _fromServer(j);
    if (server != null) return server;
    final s = j.stopsSummary;
    final fin = j.status == 'completed' || j.status == 'delivered_reported' || j.status == 'pending_settlement';
    final cod = j.cod != null && j.cod!.any ? j.cod : null;
    if (s.total > 0 && s.pending < s.total) {
      return JobStats(total: s.total, toDeliver: s.loaded, delivered: s.delivered, notDelivered: s.notDelivered, failed: s.failed, returned: s.returned + s.missing, cod: cod, isFinal: fin);
    }
    if (s.total > 0) return JobStats(total: s.total, toDeliver: s.total, delivered: 0, notDelivered: 0, cod: cod, fromOffer: true);
    // No per-parcel numbers: a count-based job or an offer that has no stops yet.
    final total = j.loadedUnits ?? j.expectedUnits;
    final done = j.deliveredUnits ?? j.finalUnits ?? 0;
    final delivered = done > total ? total : done;
    if (fin) return JobStats(total: total, toDeliver: 0, delivered: delivered, notDelivered: total - delivered, cod: cod, isFinal: true);
    return JobStats(total: total, toDeliver: total - delivered, delivered: delivered, notDelivered: 0, cod: cod, fromOffer: delivered == 0);
  }

  /// Does an order card show stat cards? Delivery jobs only (vehicle-days have no parcels); a withdrawn / declined / expired job only if parcels were handled.
  static bool applies(Job j) {
    if (!j.isDelivery) return false;
    if (j.sendsStats && j.serverStats == null) return false; // the server says: no parcels on this job
    if (_deadStatuses.contains(j.status)) return JobStats.of(j).handled > 0;
    return j.status == 'offered' || j.isActive || _finalStatuses.contains(j.status);
  }
}

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
    Widget tile(String k, String label, String value, {Color? color, String? sub}) => StatTile(tileKey: k, label: label, value: value, color: color, sub: sub);
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

/// One number with its label. [dense] = the smaller version used inside order cards.
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.tileKey, required this.label, required this.value, this.color, this.sub, this.dense = false});
  final String tileKey, label, value;
  final Color? color;
  final String? sub;
  final bool dense;
  @override
  Widget build(BuildContext context) => Container(
        key: Key(tileKey), padding: EdgeInsets.symmetric(horizontal: dense ? 8 : 10, vertical: dense ? 6 : 8),
        decoration: BoxDecoration(color: dense ? JR.bg2 : JR.card, borderRadius: BorderRadius.circular(dense ? 10 : JR.radius), border: Border.all(color: (color ?? JR.line).withValues(alpha: color == null ? 1 : 0.5))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, key: Key('$tileKey-value'), textDirection: TextDirection.ltr, style: TextStyle(fontSize: dense ? 18 : 22, fontWeight: FontWeight.w800, height: 1.15, color: color))),
          const SizedBox(height: 2),
          Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: JR.muted, fontSize: dense ? 11.5 : 12.5, height: 1.25)),
          if (sub != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: JR.muted, fontSize: 12, height: 1.25))),
        ]),
      );
}
