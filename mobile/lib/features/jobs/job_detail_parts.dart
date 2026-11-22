import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

// The cards and sheets of the job page that do not depend on its state: completion, quantity entry, reasons, custody, rating.

/// The job is over: the delivery was confirmed automatically and the earnings are already in the wallet.
class CompletedCard extends StatelessWidget {
  const CompletedCard({super.key, required this.job, required this.lang});
  final Job job;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final router = GoRouter.maybeOf(context);
    return SectionCard(key: const Key('job-completed'), border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Icon(Icons.check_circle, color: JR.accent, size: 28), const SizedBox(width: 10), Expanded(child: Text(t('fma.job_completed_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)))]),
      const SizedBox(height: 6),
      // A driver of an office is not paid into a wallet: the office is. No earnings wording for him.
      Text(t(job.earningHidden ? 'drs.completed_body_office' : 'fma.job_completed_body'), key: const Key('job-completed-body'), style: TextStyle(color: JR.muted, height: 1.4)),
      if (job.manifest && job.stopsSummary.notDelivered > 0) ...[const SizedBox(height: 10), Banner2(tone: Tone.warn, text: t('fma.finish_return_warning', {'n': job.stopsSummary.notDelivered}))],
      if (router != null) ...[const SizedBox(height: 12), OutlinedButton.icon(key: const Key('view-wallet'), onPressed: () => context.go('/wallet'), icon: const Icon(Icons.account_balance_wallet_outlined), label: Text(t(job.earningHidden ? 'nav.cash_with_me' : 'fma.view_wallet')))],
    ]));
  }
}

/// Big-target quantity entry (works with gloves): − / + steppers plus direct typing.
class QtySheet extends StatefulWidget {
  const QtySheet({super.key, required this.initial, required this.max, required this.title, required this.cta, this.hint});
  final int initial, max;
  final String title, cta;
  final String? hint;
  @override
  State<QtySheet> createState() => QtySheetState();
}

class QtySheetState extends State<QtySheet> {
  late final _c = TextEditingController(text: '${widget.initial}');
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  int get _v => int.tryParse(_c.text) ?? 0;
  void _set(int v) => setState(() => _c.text = '${v.clamp(0, widget.max)}');
  @override
  Widget build(BuildContext context) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          Row(children: [
            IconButton.filledTonal(key: const Key('qty-minus'), tooltip: context.tr('um.decrease'), iconSize: 32, onPressed: _v > 0 ? () => _set(_v - 1) : null, icon: const Icon(Icons.remove)),
            Expanded(child: TextField(key: const Key('qty'), controller: _c, onChanged: (_) => setState(() {}), textAlign: TextAlign.center, keyboardType: TextInputType.number, inputFormatters: digitsOnly(max: 6), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800), decoration: const InputDecoration(border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, fillColor: Colors.transparent))),
            IconButton.filledTonal(key: const Key('qty-plus'), tooltip: context.tr('um.increase'), iconSize: 32, onPressed: _v < widget.max ? () => _set(_v + 1) : null, icon: const Icon(Icons.add)),
          ]),
          if (widget.hint != null) Center(child: Text(widget.hint!, style: TextStyle(color: JR.muted))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('qty-submit'), onPressed: _c.text.isNotEmpty && _v <= widget.max ? () => Navigator.pop(context, _v) : null, child: Text(widget.cta)),
        ]),
      ));
}

class ReasonSheet extends StatefulWidget {
  const ReasonSheet({super.key, required this.title, required this.cta, this.danger = false, this.warning, this.info, this.label, this.allowEmpty = false});
  final String title, cta;
  final bool danger, allowEmpty;
  final String? warning, info, label;
  @override
  State<ReasonSheet> createState() => ReasonSheetState();
}

class ReasonSheetState extends State<ReasonSheet> {
  final _c = TextEditingController();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          if (widget.warning != null) ...[const SizedBox(height: 12), Banner2(text: widget.warning!, tone: Tone.warn)],
          if (widget.info != null) ...[const SizedBox(height: 12), Banner2(text: widget.info!)],
          const SizedBox(height: 12),
          TextField(key: const Key('reason'), controller: _c, onChanged: (_) => setState(() {}), maxLines: 3, decoration: InputDecoration(labelText: widget.label ?? context.tr('req.reason'))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('reason-submit'), style: widget.danger ? FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.dangerInk) : null, onPressed: (widget.allowEmpty || _c.text.trim().length >= 3) ? () => Navigator.pop(context, _c.text.trim()) : null, child: Text(widget.cta)),
        ]),
      ));
}

/// Custody: items the business handed to the driver. Hidden when there are none (or the list cannot load).
class CustodyCard extends ConsumerStatefulWidget {
  const CustodyCard({super.key, required this.offerId});
  final String offerId;
  @override
  ConsumerState<CustodyCard> createState() => CustodyCardState();
}

class CustodyCardState extends ConsumerState<CustodyCard> {
  String? _busyId;
  Future<void> _ack(String id) async {
    setState(() => _busyId = id);
    final ok = await guarded(context, () async { await ref.read(apiProvider).acknowledgeCustody(id); return true; }, success: 'custody.acked_ok');
    if (ok == true) ref.invalidate(custodyProvider(widget.offerId));
    if (mounted) setState(() => _busyId = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final items = ref.watch(custodyProvider(widget.offerId)).value ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: SectionCard(key: const Key('custody'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t('custody.title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      const SizedBox(height: 8),
      // One item per block: title (+ status) on top, the acknowledge button full width below — a long label never fights the text for room.
      for (final i in items) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${t.val('custody', i['itemType'])} × ${i['qty']}', style: const TextStyle(fontWeight: FontWeight.w700))),
          if (i['status'] != 'handed_over') ...[const SizedBox(width: 8), Flexible(child: Pill(t.val('status', i['status']), tone: i['status'] == 'acknowledged' ? Tone.info : i['status'] == 'returned' ? Tone.success : Tone.danger))],
        ]),
        if (i['description'] != null) Text('${i['description']}', style: TextStyle(color: JR.muted, fontSize: 12)),
        if (i['status'] == 'handed_over') Padding(padding: const EdgeInsets.only(top: 8), child: FilledButton(key: Key('ack-custody-${i['id']}'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: _busyId != null ? null : () => _ack('${i['id']}'), child: Text(t('custody.ack')))),
      ])),
      const SizedBox(height: 4),
      Text(t('custody.return_note'), style: TextStyle(color: JR.muted, fontSize: 12, height: 1.4)),
    ])));
  }
}

/// The custody card on the run sheet, only while something still waits for the driver's acknowledgement (the rest lives on the job details page).
class PendingCustody extends ConsumerWidget {
  const PendingCustody({super.key, required this.offerId});
  final String offerId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(custodyProvider(offerId)).value ?? const [];
    return items.any((i) => i['status'] == 'handed_over') ? CustodyCard(offerId: offerId) : const SizedBox.shrink();
  }
}

/// 1–5 star rating of the business after a completed job.
class RatingCard extends StatefulWidget {
  const RatingCard({super.key, required this.done, required this.busy, required this.onSubmit});
  final bool done, busy;
  final Future<void> Function(int stars, String comment) onSubmit;
  @override
  State<RatingCard> createState() => RatingCardState();
}

class RatingCardState extends State<RatingCard> {
  int _stars = 5;
  final _c = TextEditingController();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(key: const Key('rating'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t('job.rate_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      const SizedBox(height: 8),
      if (widget.done) Text(t('job.rated_ok'), key: const Key('rated-ok'), style: TextStyle(color: JR.accent, fontWeight: FontWeight.w600)) else ...[
        Text(t('job.rate_hint'), style: TextStyle(color: JR.muted)),
        const SizedBox(height: 8),
        Row(children: [for (var n = 1; n <= 5; n++) Expanded(child: IconButton(key: Key('star-$n'), tooltip: t('rate.star', {'n': n}), iconSize: 36, onPressed: () => setState(() => _stars = n), icon: Icon(n <= _stars ? Icons.star_rounded : Icons.star_outline_rounded, color: n <= _stars ? JR.gold : JR.line)))]), // share the card width: five fixed 52 dp buttons overflow a 320 dp phone
        TextField(key: const Key('rate-comment'), controller: _c, maxLines: 2, maxLength: 500, decoration: InputDecoration(labelText: t('rate.comment'))),
        const SizedBox(height: 8),
        FilledButton(key: const Key('rate-submit'), onPressed: widget.busy ? null : () => widget.onSubmit(_stars, _c.text.trim()), child: Text(t('common.submit'))),
      ],
    ]));
  }
}
