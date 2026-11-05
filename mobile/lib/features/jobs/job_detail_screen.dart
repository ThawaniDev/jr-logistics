import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

const _flow = ['accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'pending_settlement', 'completed'];

class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.offerId});
  final String offerId;
  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen> {
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // The business confirms attendance / loading / delivery on its side: keep the driver's next step current.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) { if (mounted && !_busy) ref.invalidate(jobProvider(widget.offerId)); });
  }

  @override
  void dispose() { _poll?.cancel(); super.dispose(); }

  Future<void> _run(Future<void> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    await guarded(context, () async { await fn(); return true; }, success: success);
    refreshAll(ref);
    ref.invalidate(jobProvider(widget.offerId));
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _checkIn() async {
    final p = await ref.read(locationServiceProvider).current();
    await _run(() => ref.read(apiProvider).checkIn(widget.offerId, lat: p?.lat, lng: p?.lng), success: 'job.arrived_ok');
  }

  Future<void> _whatsapp(String kind) async {
    final lang = ref.read(localeProvider);
    try {
      final r = await ref.read(apiProvider).whatsapp(widget.offerId, kind, lang);
      final ok = await ref.read(linkOpenerProvider).open(Uri.parse(r['url'] as String));
      if (!ok && mounted) toast(context, context.tr('m.wa_open_failed'), error: true);
    } catch (e) {
      if (mounted) toast(context, context.tr('m.wa_open_failed'), error: true);
    }
  }

  Future<void> _deliveredSheet(Job j) async {
    final units = await showModalBottomSheet<int>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _QtySheet(initial: j.loadedUnits ?? j.expectedUnits, max: j.isDelivery ? (j.loadedUnits ?? 100000) : 100000, title: c.tr(j.isDelivery ? 'job.how_many_delivered' : 'job.days_worked'), hint: j.isDelivery ? c.tr('job.delivered_hint', {'n': j.loadedUnits ?? j.expectedUnits}) : null, cta: c.tr('common.submit')));
    if (units != null) await _run(() => ref.read(apiProvider).delivered(widget.offerId, units), success: 'job.delivered_ok');
  }

  Future<void> _cancelSheet() async {
    // Await the catalog so the policy warning is always shown (it may not have been loaded yet).
    final cat = await ref.read(catalogProvider.future).catchError((_) => <String, dynamic>{});
    if (!mounted) return;
    final p = (cat['policy'] as Map?) ?? const {};
    final reason = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _ReasonSheet(title: c.tr('act.cancel_job'), cta: c.tr('act.cancel_job'), danger: true, warning: p['cancelPolicyEnabled'] == true ? '${c.tr('job.cancel_policy_title')}: ${c.tr('job.cancel_policy', {'warn': p['cancelWarnAt'], 'days': p['cancelWindowDays'], 'suspend': p['cancelSuspendAt'], 'sd': p['cancelSuspendDays']})}' : null));
    if (reason != null) {
      await _run(() async { await ref.read(apiProvider).cancel(widget.offerId, reason); }, success: 'job.cancelled_ok');
      if (mounted) Navigator.of(context).maybePop();
    }
  }

  Future<void> _cantReach() async {
    String? reason;
    await showModalBottomSheet<void>(context: context, useRootNavigator: true, builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(child: Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(c.tr('job.cant_reach'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [for (final k in ['no_answer', 'wrong_number', 'refused', 'other']) ChoiceChip(label: Text(c.tr('contact_ex.$k')), selected: reason == k, selectedColor: JR.accent.withValues(alpha: 0.2), onSelected: (_) => set(() => reason = k))]),
      const SizedBox(height: 16),
      FilledButton(onPressed: reason == null ? null : () { Navigator.pop(c); _run(() => ref.read(apiProvider).contactException(widget.offerId, reason!), success: 'job.reported_ok'); }, child: Text(c.tr('common.submit'))),
    ]))))); 
  }

  Future<void> _problem() async {
    final note = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _ReasonSheet(title: c.tr('act.report_problem'), cta: c.tr('common.submit'), info: c.tr('job.problem_note'), allowEmpty: true));
    if (note != null) await _run(() => ref.read(apiProvider).reportNoWork(widget.offerId, note.isEmpty ? null : note), success: 'job.reported_ok');
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final job = ref.watch(jobProvider(widget.offerId));
    return Scaffold(
      appBar: AppBar(title: Text(job.value?.ref ?? t('nav.my_jobs'), textDirection: TextDirection.ltr), actions: [if (job.hasValue && job.value!.status != 'offered') IconButton(tooltip: t('chat.title'), icon: const Icon(Icons.chat_bubble_outline), onPressed: () => context.push('/job/${widget.offerId}/chat'))]),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(jobProvider(widget.offerId)); await ref.read(jobProvider(widget.offerId).future); },
        child: AsyncBody(value: job, onRetry: () => ref.invalidate(jobProvider(widget.offerId)), builder: (j) {
          final step = _flow.indexOf(j.status);
          final hintKey = 'job.hint_${j.status}${j.awaitingLoadingAck ? '_ack' : ''}';
          final mapsUri = j.deliveryLat != null ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${j.deliveryLat},${j.deliveryLng}') : (j.deliveryAddress != null ? Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': j.deliveryAddress!}) : null);
          return ListView(padding: const EdgeInsets.all(16), children: [
            Row(children: [Expanded(child: Text(t('svc.${j.service}'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))), StatusPill(j.status)]),
            if (step >= 0) Padding(padding: const EdgeInsets.only(top: 12, bottom: 4), child: Row(children: [for (var i = 0; i < _flow.length; i++) Expanded(child: Container(height: 5, margin: const EdgeInsetsDirectional.only(end: 4), decoration: BoxDecoration(color: i <= step ? JR.accent : JR.line, borderRadius: BorderRadius.circular(4))))])),
            const SizedBox(height: 12),
            // ── one clear next step ──
            SectionCard(border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.next_step').toUpperCase(), style: const TextStyle(color: JR.accent, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1)),
              const SizedBox(height: 6),
              Text(t(hintKey), key: const Key('hint'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.35)),
              if (j.can('accept')) ...[const SizedBox(height: 14), Text(t('job.locked_until_accept'), style: const TextStyle(color: JR.muted, fontSize: 13))],
              if (j.can('checkin')) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('checkin'), onPressed: _busy ? null : _checkIn, icon: const Icon(Icons.my_location), label: Text(t('act.checkin')))],
              if (j.can('ack_loading')) ...[const SizedBox(height: 14), FilledButton(key: const Key('ack'), onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).ackLoading(widget.offerId, true)), child: Text(t('act.ack_loading', {'n': j.loadedUnits}))), const SizedBox(height: 10), OutlinedButton(onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).ackLoading(widget.offerId, false, note: 'count differs')), child: Text(t('act.dispute_loading')))],
              if (j.can('report_delivered')) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('delivered'), onPressed: _busy ? null : () => _deliveredSheet(j), icon: const Icon(Icons.inventory_2), label: Text(j.isDelivery ? t('act.report_delivered') : t('act.finish_work')))],
            ])),
            const SizedBox(height: 16),
            // ── recipient & contact ──
            if (j.recipient != null) SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.recipient'), style: const TextStyle(color: JR.muted, fontSize: 12)),
              const SizedBox(height: 6),
              Row(children: [Expanded(child: Text('${j.recipient!['name'] ?? ''}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), IconButton.filledTonal(tooltip: t('m.call'), onPressed: () => ref.read(linkOpenerProvider).call('${j.recipient!['phone']}'), icon: const Icon(Icons.call))]),
              Text('${j.recipient!['phone']}', textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted)),
              const SizedBox(height: 12),
              // Icon above label so translations never truncate ("On my way" / "في الطريق" / "راستے میں").
              Row(children: [for (final (i, k) in ['contact', 'arriving', 'issue'].indexed) Expanded(child: Padding(padding: EdgeInsetsDirectional.only(end: i < 2 ? 8 : 0), child: OutlinedButton(key: Key('wa-$k'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 68), padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8)), onPressed: () => _whatsapp(k), child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.chat, size: 20, color: JR.accent), const SizedBox(height: 4), Text(t('wa.$k'), textAlign: TextAlign.center, maxLines: 2, style: const TextStyle(fontSize: 12.5, height: 1.2))]))))]),
              const SizedBox(height: 8),
              Text(t('job.wa_note'), style: const TextStyle(color: JR.muted, fontSize: 11.5, height: 1.4)),
              TextButton.icon(onPressed: _cantReach, icon: const Icon(Icons.phone_disabled, size: 18), label: Text(t('job.cant_reach'))),
            ])),
            if (j.recipient != null) const SizedBox(height: 12),
            // ── locations ──
            SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.locations'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 10),
              if (j.pickup == null && j.delivery == null) Text(t('job.locked_until_accept'), style: const TextStyle(color: JR.muted)) else ...[
                _addr(t('wizard.pickup_address'), j.pickup?['address'] as String?),
                const SizedBox(height: 8),
                _addr(t('wizard.delivery_address'), j.deliveryAddress),
                if (mapsUri != null) ...[const SizedBox(height: 12), OutlinedButton.icon(onPressed: () => ref.read(linkOpenerProvider).open(mapsUri), icon: const Icon(Icons.navigation_outlined), label: Text(t('m.open_in_maps')))],
              ],
            ])),
            const SizedBox(height: 12),
            SectionCard(child: Column(children: [
              _kv(t('req.starts'), fmtDateTime(j.startsAt, lang)),
              if (j.vehicleType != null) _kv(t('wizard.vehicle'), '${t('vehicle.${j.vehicleType}')}${j.temperature != null ? ' · ${t('temp.${j.temperature}')}' : ''}'),
              _kv(t(j.isDelivery ? 'units.exp' : 'wizard.days'), '${j.expectedUnits}'),
              if (j.isDelivery) _kv(t('units.loaded'), '${j.loadedUnits ?? '—'}'),
              if (j.isDelivery) _kv(t('units.delivered'), '${j.deliveredUnits ?? '—'}'),
              if (j.finalUnits != null) _kv(t('units.final'), '${j.finalUnits}'),
              if (j.expectedEarningCents != null) _kv(t('job.expected_earning'), fmtMoney(j.expectedEarningCents, lang), color: JR.accent),
              if (j.contents != null) _kv(t('wizard.contents'), j.contents!),
              if (j.notes != null) _kv(t('wizard.notes'), j.notes!),
            ])),
            const SizedBox(height: 16),
            if (j.can('cancel')) OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger)), onPressed: _busy ? null : _cancelSheet, icon: const Icon(Icons.close), label: Text(t('act.cancel_job'))),
            if (j.can('report_no_work')) ...[const SizedBox(height: 10), OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.gold, side: const BorderSide(color: JR.gold)), onPressed: _busy ? null : _problem, icon: const Icon(Icons.warning_amber), label: Text(t('act.report_problem')))],
            if (j.can('accept')) ...[const SizedBox(height: 10), Row(children: [Expanded(flex: 2, child: FilledButton(onPressed: () => context.go('/offers'), child: Text(t('act.accept'))))])],
            const SizedBox(height: 24),
          ]);
        }),
      ),
    );
  }

  Widget _addr(String label, String? v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(color: JR.muted, fontSize: 12)), Text(v ?? '—', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))]);
  Widget _kv(String k, String v, {Color? color}) => Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, crossAxisAlignment: CrossAxisAlignment.start, children: [Text(k, style: const TextStyle(color: JR.muted)), const SizedBox(width: 16), Flexible(child: Text(v, textAlign: TextAlign.end, textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w700, color: color)))]));
}

/// Big-target quantity entry (works with gloves): − / + steppers plus direct typing.
class _QtySheet extends StatefulWidget {
  const _QtySheet({required this.initial, required this.max, required this.title, required this.cta, this.hint});
  final int initial, max;
  final String title, cta;
  final String? hint;
  @override
  State<_QtySheet> createState() => _QtySheetState();
}

class _QtySheetState extends State<_QtySheet> {
  late final _c = TextEditingController(text: '${widget.initial}');
  int get _v => int.tryParse(_c.text) ?? 0;
  void _set(int v) => setState(() => _c.text = '${v.clamp(0, widget.max)}');
  @override
  Widget build(BuildContext context) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          Row(children: [
            IconButton.filledTonal(iconSize: 32, onPressed: _v > 0 ? () => _set(_v - 1) : null, icon: const Icon(Icons.remove)),
            Expanded(child: TextField(key: const Key('qty'), controller: _c, onChanged: (_) => setState(() {}), textAlign: TextAlign.center, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800), decoration: const InputDecoration(border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, fillColor: Colors.transparent))),
            IconButton.filledTonal(iconSize: 32, onPressed: _v < widget.max ? () => _set(_v + 1) : null, icon: const Icon(Icons.add)),
          ]),
          if (widget.hint != null) Center(child: Text(widget.hint!, style: const TextStyle(color: JR.muted))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('qty-submit'), onPressed: _c.text.isNotEmpty && _v <= widget.max ? () => Navigator.pop(context, _v) : null, child: Text(widget.cta)),
        ]),
      ));
}

class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.title, required this.cta, this.danger = false, this.warning, this.info, this.allowEmpty = false});
  final String title, cta;
  final bool danger, allowEmpty;
  final String? warning, info;
  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final _c = TextEditingController();
  @override
  Widget build(BuildContext context) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          if (widget.warning != null) ...[const SizedBox(height: 12), Banner2(text: widget.warning!, tone: Tone.warn)],
          if (widget.info != null) ...[const SizedBox(height: 12), Banner2(text: widget.info!)],
          const SizedBox(height: 12),
          TextField(key: const Key('reason'), controller: _c, onChanged: (_) => setState(() {}), maxLines: 3, decoration: InputDecoration(labelText: context.tr('req.reason'))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('reason-submit'), style: widget.danger ? FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.bg) : null, onPressed: (widget.allowEmpty || _c.text.trim().length >= 3) ? () => Navigator.pop(context, _c.text.trim()) : null, child: Text(widget.cta)),
        ]),
      ));
}
