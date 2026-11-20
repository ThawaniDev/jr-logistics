import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'shipment_card.dart';
import 'shipment_logic.dart';
import 'stop_actions.dart';

/// Opens the sheet of one shipment (tap on a card). It reads the job live, so after "I've arrived" it turns into the delivery actions without being
/// reopened, and it closes itself once the shipment is done or postponed.
Future<void> showShipmentSheet(BuildContext context, {required String offerId, required String stopId}) => showModalBottomSheet<void>(
      context: context, useRootNavigator: true, isScrollControlled: true, showDragHandle: true,
      builder: (_) => ShipmentSheet(offerId: offerId, stopId: stopId),
    );

class ShipmentSheet extends ConsumerStatefulWidget {
  const ShipmentSheet({super.key, required this.offerId, required this.stopId});
  final String offerId, stopId;
  @override
  ConsumerState<ShipmentSheet> createState() => _ShipmentSheetState();
}

class _ShipmentSheetState extends ConsumerState<ShipmentSheet> {
  bool _busy = false;

  Stop? _find(Job? j) { if (j == null) return null; for (final s in j.stops) { if (s.id == widget.stopId) return s; } return null; }

  /// Runs one stop action; on success the job is re-read and the sheet closes when nothing is left to do here.
  Future<void> _run(Future<bool> Function(Job j, Stop s) f) async {
    if (_busy) return;
    final job = ref.read(jobProvider(widget.offerId)).value;
    final stop = _find(job);
    if (job == null || stop == null) return;
    final defers = stop.deferCount;
    setState(() => _busy = true);
    try {
      final applied = await f(job, stop);
      if (!applied || !mounted) return;
      ref.invalidate(jobProvider(widget.offerId));
      final after = _find(await ref.read(jobProvider(widget.offerId).future));
      if (mounted && (after == null || after.status != 'loaded' || after.deferCount > defers)) Navigator.of(context).pop();
    } catch (_) {
      // the action already told the driver what went wrong
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) toast(context, context.tr('common.copied'), quiet: true);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final job = ref.watch(jobProvider(widget.offerId)).value;
    final s = _find(job);
    if (job == null || s == null) return Padding(padding: const EdgeInsets.all(24), child: EmptyView(title: t('fmb.map_stop_done'), icon: Icons.task_alt));
    final a = shipActionsFor(job, s);
    final status = shipStatusOf(s);
    final address = [s.address, if (s.city != null && s.city!.isNotEmpty) cityLabel(context, s.city)].where((e) => e.isNotEmpty).join(' · ');
    final name = s.recipientName, phone = s.recipientPhone;
    final date = shipDate(s.createdAt, lang);
    Widget tile(Key k, IconData i, String label, VoidCallback? f, {Color? color}) => Expanded(child: Material(key: k, color: JR.bg2, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: JR.line)), child: InkWell(
          customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), onTap: _busy ? null : f,
          child: Padding(padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4), child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(i, color: f == null ? JR.muted : (color ?? JR.cyan)), const SizedBox(height: 4), Text(label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, height: 1.2, color: f == null ? JR.muted : null))])),
        )));
    Widget info(IconData i, String text, {Key? key, Color? color, bool ltr = false, bool strong = false}) => Padding(key: key, padding: const EdgeInsets.only(top: 8), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(top: 1), child: Icon(i, size: 18, color: color ?? JR.muted)), const SizedBox(width: 8),
          Expanded(child: Text(text, textDirection: ltr ? TextDirection.ltr : null, style: TextStyle(color: color ?? JR.text, fontWeight: strong ? FontWeight.w600 : FontWeight.w400, height: 1.35))),
        ]));
    final tiles = <Widget>[
      tile(const Key('sheet-call'), Icons.call, t('m.call'), a.call ? () => StopActions.call(context, s) : null),
      tile(const Key('sheet-whatsapp'), Icons.chat, t('ms.whatsapp'), a.whatsapp ? () => StopActions.whatsapp(context, ref, job, s) : null, color: JR.accent),
      tile(const Key('sheet-navigate'), Icons.navigation_outlined, t('um.navigate'), () => StopActions.navigate(context, s)),
      tile(const Key('sheet-copy'), Icons.copy_outlined, t('drs.copy_address'), address.isEmpty ? null : () => _copy(address)),
    ];
    return SafeArea(child: SingleChildScrollView(key: const Key('shipment-sheet'), padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 6, children: [
        Text(s.code.isEmpty ? t('um.parcel_n', {'n': s.seq}) : s.code, key: const Key('sheet-code'), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        ShipStatusChip(status, key: const Key('sheet-status')),
      ]),
      if (name != null && name.isNotEmpty || phone != null && phone.isNotEmpty) info(Icons.person_outline, [if (name != null && name.isNotEmpty) name, if (phone != null && phone.isNotEmpty) phone].join(' · '), key: const Key('sheet-recipient'), ltr: true, strong: true),
      if (address.isNotEmpty) info(Icons.place_outlined, address, key: const Key('sheet-address')),
      if (s.hasCod) Padding(padding: const EdgeInsets.only(top: 10), child: Container(
        key: const Key('sheet-cod'), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: JR.gold.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10), border: Border.all(color: JR.gold.withValues(alpha: 0.4))),
        child: Row(children: [
          const Icon(Icons.payments_outlined, color: JR.gold, size: 20), const SizedBox(width: 8),
          Expanded(child: Text(t('fmb.map_cash_due'), style: const TextStyle(fontWeight: FontWeight.w600))), const SizedBox(width: 8),
          Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerEnd, child: Text(fmtMoney(s.codCents, lang), textDirection: TextDirection.ltr, style: const TextStyle(color: JR.gold, fontWeight: FontWeight.w800, fontSize: 17)))),
        ]),
      )),
      info(Icons.account_balance_wallet_outlined, '${t('drs.l_payment')}: ${t(s.paymentMode == 'cod' ? 'drs.pay_cod' : 'drs.pay_prepaid')} · ${t('drs.l_pieces')}: ${s.pieces}', key: const Key('sheet-payment')),
      if (s.contents != null && s.contents!.isNotEmpty) info(Icons.inventory_2_outlined, '${t('wizard.contents')}: ${s.contents}', key: const Key('sheet-contents')),
      if (s.notes != null && s.notes!.isNotEmpty) info(Icons.sticky_note_2_outlined, s.notes!, key: const Key('sheet-notes'), color: JR.gold, strong: true),
      if (date.isNotEmpty) info(Icons.schedule, date, key: const Key('sheet-date')),
      if (s.status != 'loaded' && s.failReason != null) info(Icons.report_gmailerrorred, t.has('stopfail.${s.failReason}') ? t('stopfail.${s.failReason}') : '${s.failReason}', key: const Key('sheet-fail'), color: JR.danger),
      const SizedBox(height: 14),
      IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final (i, w) in tiles.indexed) ...[if (i > 0) const SizedBox(width: 8), w]])),
      if (a.locked) Padding(padding: const EdgeInsets.only(top: 14), child: Banner2(key: const Key('sheet-locked'), text: t('drs.locked'))),
      if (a.arrive) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('sheet-arrive'), onPressed: _busy ? null : () => _run((j, x) => StopActions.arrive(context, ref, j, x)), icon: busyIcon(_busy, Icons.my_location), label: Text(t('act.checkin')))],
      if (a.deliver) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('sheet-deliver'), onPressed: _busy ? null : () => _run((j, x) => StopActions.deliver(context, ref, j, x)), icon: busyIcon(_busy, Icons.check), label: Text(t('fmb.map_deliver')))],
      if (a.cantDeliver) ...[const SizedBox(height: 10), OutlinedButton.icon(key: const Key('sheet-cant'), style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger), minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : () => _run((j, x) => StopActions.cantDeliver(context, ref, j, x)), icon: const Icon(Icons.report_gmailerrorred), label: Text(t('ms.cant_deliver')))],
      if (a.postpone) ...[const SizedBox(height: 8), OutlinedButton.icon(key: const Key('sheet-postpone'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : () => _run((j, x) => StopActions.postpone(context, ref, j, x)), icon: const Icon(Icons.schedule), label: Text(t('ms.postpone')))],
    ])));
  }
}
