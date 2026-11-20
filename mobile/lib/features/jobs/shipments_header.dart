import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../widgets/common.dart';
import 'job_stats.dart';
import 'shipment_logic.dart';

/// Top of the shipments screen, kept small so the first shipment is on screen right away: what the job is (service, cities, status), the four counters in
/// one row (two by two at a large text size), the cash to collect, and the progress bar with one line of guidance.
class ShipmentsHeader extends StatelessWidget {
  const ShipmentsHeader({super.key, required this.job, required this.lang, required this.counts});
  final Job job;
  final String lang;
  final ShipCounts counts;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final st = JobStats.of(job);
    final done = counts.done, total = counts.total;
    final route = '${cityLabel(context, job.pickupCity)} → ${cityLabel(context, job.deliveryCity)}${job.business != null ? ' · ${job.business}' : ''}';
    // One line of guidance, until the driver has done his first shipment.
    final hint = job.can('work_stops') ? (done == 0 ? t(job.routingEnabled ? 'ms.hint_work_stops' : 'drs.hint_work') : null) : job.can('report_delivered') ? t('drs.hint_all_done') : null;
    final cod = st.hasCod ? st.cod! : null;
    Widget tile(String k, String label, int v, {Color? color}) => StatTile(tileKey: k, label: label, value: '$v', color: color, dense: true);
    return Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(t('svc.${job.service}'), key: const Key('drs-service'), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, height: 1.25))),
        const SizedBox(width: 8),
        Flexible(child: StatusPill(job.status)),
      ]),
      Text(route, key: const Key('drs-route-line'), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.3)),
      const SizedBox(height: 10),
      LayoutBuilder(builder: (context, c) {
        const gap = 8.0;
        final cols = c.maxWidth >= 290 && MediaQuery.textScalerOf(context).scale(1) <= 1.15 ? 4 : 2;
        final w = (c.maxWidth - gap * (cols - 1)) / cols;
        return Wrap(key: const Key('job-stats'), spacing: gap, runSpacing: gap, children: [
          for (final x in [
            tile('stat-total', t('fma.stat_total'), counts.total),
            tile('stat-to-deliver', t('fma.stat_to_deliver'), counts.toDeliver, color: JR.cyan),
            tile('stat-delivered', t('fma.stat_delivered'), counts.delivered, color: JR.accent),
            tile('stat-not-delivered', t('fma.stat_not_delivered'), counts.notDelivered, color: counts.notDelivered > 0 ? JR.danger : null),
          ]) SizedBox(width: w, child: x),
        ]);
      }),
      if (cod != null) Padding(padding: const EdgeInsets.only(top: 8), child: Container(
        key: const Key('stat-cash'), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: JR.gold.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10), border: Border.all(color: JR.gold.withValues(alpha: 0.45))),
        child: Row(children: [
          const Icon(Icons.payments_outlined, color: JR.gold, size: 20), const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('fma.stat_cash'), style: const TextStyle(fontSize: 12.5, color: JR.muted, height: 1.2)),
            Text(t('fma.stat_cash_collected', {'amount': fmtMoney(cod.collectedCents, lang), 'n': cod.parcels}), style: const TextStyle(fontSize: 11.5, color: JR.muted, height: 1.25)),
          ])),
          const SizedBox(width: 8),
          Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerEnd, child: Text(fmtMoney(cod.toCollectCents, lang), key: const Key('stat-cash-value'), textDirection: TextDirection.ltr, style: const TextStyle(color: JR.gold, fontSize: 19, fontWeight: FontWeight.w800)))),
        ]),
      )),
      const SizedBox(height: 10),
      Text(t('drs.progress', {'done': done, 'total': total}), key: const Key('progress-text'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
      const SizedBox(height: 6),
      ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(key: const Key('progress-bar'), semanticsLabel: t('drs.progress', {'done': done, 'total': total}), minHeight: 6, value: total == 0 ? 0 : done / total, color: JR.accent, backgroundColor: JR.line)),
      if (hint != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(hint, key: const Key('drs-hint'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.35))),
    ]));
  }
}

/// The pinned bar under the header: the four filter chips (each with its count) and a search that opens under them.
class ShipFilterBar extends StatelessWidget {
  const ShipFilterBar({super.key, required this.counts, required this.filter, required this.onFilter, required this.search, required this.searchOpen, required this.onToggleSearch, required this.onQuery, this.canSearch = true});
  final ShipCounts counts;
  final ShipFilter filter;
  final ValueChanged<ShipFilter> onFilter;
  final TextEditingController search;
  final bool searchOpen, canSearch;
  final VoidCallback onToggleSearch;
  final ValueChanged<String> onQuery;

  String _label(Strings t, ShipFilter f) => switch (f) {
        ShipFilter.all => t('common.all'),
        ShipFilter.toDeliver => t('fma.stat_to_deliver'),
        ShipFilter.delivered => t('fma.stat_delivered'),
        ShipFilter.notDelivered => t('fma.stat_not_delivered'),
      };

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final searching = search.text.trim().isNotEmpty;
    return Material(color: JR.bg, child: Container(
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: JR.line))),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: SingleChildScrollView(key: const Key('ship-filters'), scrollDirection: Axis.horizontal, child: Row(children: [
            for (final f in ShipFilter.values) Padding(padding: const EdgeInsetsDirectional.only(end: 8), child: ChoiceChip(
              key: Key('ship-filter-${f.key}'), selected: filter == f, showCheckmark: false, onSelected: (_) => onFilter(f),
              visualDensity: VisualDensity.compact, selectedColor: JR.accent.withValues(alpha: 0.2), backgroundColor: JR.card, side: BorderSide(color: filter == f ? JR.accent : JR.line),
              labelStyle: TextStyle(color: filter == f ? JR.accent : JR.text, fontWeight: FontWeight.w700, fontSize: 13.5),
              label: Text('${_label(t, f)} ${counts.of(f)}'),
            )),
          ]))),
          if (canSearch) IconButton(key: const Key('ship-search-toggle'), tooltip: t('common.search'), onPressed: onToggleSearch, icon: Icon(searchOpen ? Icons.search_off : Icons.search, color: searching ? JR.accent : null)),
        ]),
        if (searchOpen) Padding(padding: const EdgeInsetsDirectional.only(top: 8, end: 8), child: TextField(
          key: const Key('ship-search'), controller: search, onChanged: onQuery, autofocus: true, textInputAction: TextInputAction.search,
          decoration: InputDecoration(isDense: true, contentPadding: const EdgeInsets.symmetric(vertical: 10), hintText: t('drs.search_hint'), prefixIcon: const Icon(Icons.search, size: 20), suffixIcon: searching ? IconButton(key: const Key('ship-search-clear'), tooltip: t('common.clear'), icon: const Icon(Icons.close, size: 20), onPressed: () { search.clear(); onQuery(''); }) : null),
        )),
      ]),
    ));
  }
}
