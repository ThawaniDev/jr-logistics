import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../data/models.dart';
import 'common.dart';

class JobCard extends StatelessWidget {
  const JobCard({super.key, required this.job, required this.lang, this.onTap, this.footer, this.highlight = false});
  final Job job;
  final String lang;
  final VoidCallback? onTap;
  final Widget? footer;
  final bool highlight;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(
      onTap: onTap, border: highlight ? JR.accent : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('svc.${job.service}'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text('${job.ref}${job.business != null ? ' · ${job.business}' : ''}', textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 12)),
          ])),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            StatusPill(job.status),
            if (job.isReplacement) Padding(padding: const EdgeInsets.only(top: 4), child: Pill(t('req.replacement'), tone: Tone.warn)),
          ]),
        ]),
        const SizedBox(height: 12),
        _row(Icons.schedule, fmtDateTime(job.startsAt, lang)),
        const SizedBox(height: 6),
        _row(Icons.route_outlined, '${t('city.${job.pickupCity}')} → ${t('city.${job.deliveryCity}')}'),
        if (job.vehicleType != null) ...[const SizedBox(height: 6), _row(Icons.local_shipping_outlined, '${t('vehicle.${job.vehicleType}')}${job.temperature != null ? ' · ${t('temp.${job.temperature}')}' : ''}')],
        const SizedBox(height: 6),
        _row(Icons.inventory_2_outlined, '${job.expectedUnits} ${t(job.isDelivery ? 'unit.shipment' : 'unit.vehicle_day')}'),
        if (job.earningHidden) ...[const SizedBox(height: 10), Text(t('job.paid_by_office'), style: const TextStyle(color: JR.muted, fontSize: 12))]
        else if (job.expectedEarningCents != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(color: JR.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Flexible(child: Text(t('job.expected_earning'), overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 13))),
              const SizedBox(width: 8),
              Text(fmtMoney(job.expectedEarningCents, lang), textDirection: TextDirection.ltr, style: const TextStyle(color: JR.accent, fontWeight: FontWeight.w800, fontSize: 16)),
            ]),
          ),
        ],
        if (footer != null) ...[const SizedBox(height: 14), footer!],
      ]),
    );
  }

  Widget _row(IconData i, String text) => Row(children: [Icon(i, size: 18, color: JR.cyan), const SizedBox(width: 8), Expanded(child: Text(text, style: const TextStyle(color: JR.muted)))]);
}
