import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../widgets/common.dart';
import 'shipment_logic.dart';

/// Colour, icon and dictionary key of a shipment status (key = `drs.st_<name>`).
({Color color, IconData icon, String key}) shipStatusStyle(ShipStatus s) => switch (s) {
      ShipStatus.outForDelivery => (color: JR.accent, icon: Icons.local_shipping_outlined, key: 'drs.st_out'),
      ShipStatus.delivered => (color: JR.accent, icon: Icons.check_circle, key: 'drs.st_delivered'),
      ShipStatus.failed => (color: JR.danger, icon: Icons.cancel_outlined, key: 'drs.st_failed'),
      ShipStatus.returned => (color: JR.gold, icon: Icons.undo, key: 'drs.st_returned'),
      ShipStatus.missing => (color: JR.danger, icon: Icons.help_outline, key: 'drs.st_missing'),
      ShipStatus.postponed => (color: JR.gold, icon: Icons.schedule, key: 'drs.st_postponed'),
      ShipStatus.pending => (color: JR.muted, icon: Icons.hourglass_empty, key: 'drs.st_pending'),
      ShipStatus.cancelled => (color: JR.muted, icon: Icons.block, key: 'drs.st_cancelled'),
    };

/// The status chip of a shipment card. Delivered is filled (the good end state), everything else is an outlined tint.
class ShipStatusChip extends StatelessWidget {
  const ShipStatusChip(this.status, {super.key});
  final ShipStatus status;
  @override
  Widget build(BuildContext context) {
    final st = shipStatusStyle(status);
    final filled = status == ShipStatus.delivered;
    final fg = filled ? JR.accentInk : st.color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: filled ? st.color : st.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99), border: Border.all(color: st.color.withValues(alpha: filled ? 1 : 0.45))),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(st.icon, size: 14, color: fg), const SizedBox(width: 5),
        Flexible(child: Text(context.tr(st.key), maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700, height: 1.2))),
      ]),
    );
  }
}

/// One shipment of the run sheet: package · Call · WhatsApp on the start side; code (accent underline) + status chip, name, address, COD amount,
/// payment mode, pieces, contents and the date on the other. Finished cards are dimmed (still readable). The card never overflows: long names and
/// addresses are cut after two lines, and every "label: value" flows like a sentence at any text size.
class ShipmentCard extends StatelessWidget {
  const ShipmentCard({super.key, required this.stop, required this.lang, this.isNext = false, this.onTap, this.onCall, this.onWhatsapp});
  final Stop stop;
  final String lang;
  /// The first shipment still to do (a green frame and a "Next" tag).
  final bool isNext;
  final VoidCallback? onTap, onCall, onWhatsapp;

  String get _id => stop.code.isEmpty ? stop.id : stop.code;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final s = stop;
    final status = shipStatusOf(s);
    final dim = s.resolved;
    final date = shipDate(s.createdAt, lang);
    final cod = s.codCents;
    final labelStyle = TextStyle(color: JR.muted, fontSize: 13.5, height: 1.3);
    const val = TextStyle(fontSize: 14, fontWeight: FontWeight.w600, height: 1.3);
    // "Label: value" as ONE text: it flows and wraps like a sentence (long names and addresses never overflow, any language, any text size).
    Widget line(String label, String value, {Key? key, int maxLines = 1}) => Padding(padding: const EdgeInsets.only(top: 4), child: Text.rich(
          TextSpan(children: [TextSpan(text: '$label: ', style: labelStyle), TextSpan(text: value, style: val)]),
          key: key, maxLines: maxLines, overflow: TextOverflow.ellipsis));
    final pills = [
      if (isNext) Pill(t('drs.next'), key: Key('ship-next-$_id'), tone: Tone.success),
      if (s.isBusiness) Pill(t('rtype.business'), tone: Tone.info),
      if (s.status == 'loaded' && s.arrived) Pill(t('fmb.map_arrived'), tone: Tone.info),
    ];
    // Tags on the start side, the date with its clock on the end side (alone, it still sits at the end); at a large text size they stack and the date is cut, never the card.
    final dateRow = date.isEmpty ? null : Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.schedule, size: 15, color: JR.muted), const SizedBox(width: 4), Flexible(child: Text(date, key: Key('ship-date-$_id'), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: JR.muted, fontSize: 12.5)))]);
    final Widget footer = pills.isEmpty
        ? (dateRow == null ? const SizedBox.shrink() : Align(alignment: AlignmentDirectional.centerEnd, child: dateRow))
        : Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 4, children: [Wrap(spacing: 6, runSpacing: 4, children: pills), ?dateRow]);
    final body = Container(
      key: Key('ship-card-$_id'), width: double.infinity, padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: JR.card, borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: isNext ? JR.accent : JR.line, width: isNext ? 1.5 : 1)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Column(children: [
          Container(width: 44, height: 44, decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(12), border: Border.all(color: JR.line)), child: Icon(Icons.inventory_2_outlined, color: JR.cyan, size: 24)),
          const SizedBox(height: 10),
          RoundAction(key: Key('ship-call-$_id'), icon: Icons.call, tooltip: '${t('m.call')} ${s.recipientName ?? ''}'.trim(), color: JR.cyan, onTap: onCall),
          const SizedBox(height: 8),
          RoundAction(key: Key('ship-whatsapp-$_id'), icon: Icons.chat, tooltip: t('ms.whatsapp'), color: JR.accent, filled: true, onTap: onWhatsapp),
        ]),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.start, spacing: 8, runSpacing: 6, children: [
            Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              ConstrainedBox(constraints: const BoxConstraints(maxWidth: 190), child: Text(s.code.isEmpty ? t('um.parcel_n', {'n': s.seq}) : s.code, key: Key('ship-code-$_id'), maxLines: 1, overflow: TextOverflow.ellipsis, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, height: 1.2))),
              const SizedBox(height: 3),
              Container(width: 28, height: 3, decoration: BoxDecoration(color: JR.accent, borderRadius: BorderRadius.circular(2))),
            ]),
            ShipStatusChip(status, key: Key('ship-status-$_id')),
          ]),
          line(t('drs.l_name'), s.recipientName ?? '—', key: Key('ship-name-$_id'), maxLines: 2),
          line(t('drs.l_address'), [s.address, if (s.city != null && s.city!.isNotEmpty) cityLabel(context, s.city)].where((e) => e.isNotEmpty).join(' · '), key: Key('ship-address-$_id'), maxLines: 2),
          Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 6, children: [
            Text('${t('drs.l_cod')}:', style: labelStyle),
            // The cash to collect, highlighted; scales down instead of overflowing when the amount is long.
            Container(key: Key('ship-cod-$_id'), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: cod > 0 ? BoxDecoration(color: JR.gold.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(8), border: Border.all(color: JR.gold.withValues(alpha: 0.5))) : null,
                child: FittedBox(fit: BoxFit.scaleDown, child: Text(fmtMoney(cod, lang), textDirection: TextDirection.ltr, style: cod > 0 ? TextStyle(color: JR.gold, fontSize: 14.5, fontWeight: FontWeight.w800, height: 1.25) : TextStyle(color: JR.muted, fontSize: 14, height: 1.3)))),
          ])),
          Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(spacing: 16, runSpacing: 2, children: [
            Text.rich(TextSpan(children: [TextSpan(text: '${t('drs.l_payment')}: ', style: labelStyle), TextSpan(text: t(s.paymentMode == 'cod' ? 'drs.pay_cod' : 'drs.pay_prepaid'), style: val)]), key: Key('ship-payment-$_id')),
            Text.rich(TextSpan(children: [TextSpan(text: '${t('drs.l_pieces')}: ', style: labelStyle), TextSpan(text: '${s.pieces}', style: val)]), key: Key('ship-pieces-$_id')),
          ])),
          if (s.contents != null && s.contents!.isNotEmpty) line(t('drs.l_contents'), s.contents!, key: Key('ship-contents-$_id')),
          const SizedBox(height: 8),
          footer,
        ])),
      ]),
    );
    final card = onTap == null ? body : Material(color: Colors.transparent, child: InkWell(borderRadius: BorderRadius.circular(JR.radius), onTap: onTap, child: body));
    return dim ? Opacity(opacity: 0.62, child: card) : card;
  }
}

/// A round action next to a shipment: Call (outlined) or WhatsApp (filled green). Greyed — never hidden — when it cannot be used, so the card keeps its shape.
class RoundAction extends StatelessWidget {
  const RoundAction({super.key, required this.icon, required this.tooltip, required this.color, this.filled = false, this.onTap});
  final IconData icon;
  final String tooltip;
  final Color color;
  final bool filled;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final on = onTap != null;
    return Tooltip(message: tooltip, child: Material(
      color: on ? (filled ? color : color.withValues(alpha: 0.14)) : JR.bg2,
      shape: CircleBorder(side: BorderSide(color: on ? color.withValues(alpha: filled ? 1 : 0.5) : JR.line)),
      child: InkResponse(onTap: onTap, customBorder: const CircleBorder(), containedInkWell: true, highlightShape: BoxShape.circle, child: SizedBox(width: 44, height: 44, child: Icon(icon, size: 22, color: on ? (filled ? JR.accentInk : color) : JR.muted))),
    ));
  }
}
