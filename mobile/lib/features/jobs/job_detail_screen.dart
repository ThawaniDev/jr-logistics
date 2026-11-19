import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import 'arrival_section.dart';
import 'job_stats.dart';
import 'route_map_screen.dart';
import 'stops_panel.dart';

const _flow = ['accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'pending_settlement', 'completed'];

class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.offerId});
  final String offerId;
  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen> {
  bool _busy = false, _noWorkSent = false;
  String? _rated; // null = not yet · 'done' = just sent · 'already' = server says it was rated before
  Timer? _poll;
  late final AppLifecycleListener _life;

  @override
  void initState() {
    super.initState();
    // The business confirms attendance / loading / delivery on its side: keep the driver's next step current.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) { if (mounted && !_busy) ref.invalidate(jobProvider(widget.offerId)); });
    // Coming back to the app (after a call or the maps app) shows the current state at once instead of up to 10 s later.
    _life = AppLifecycleListener(onResume: () { if (mounted && !_busy) ref.invalidate(jobProvider(widget.offerId)); });
  }

  @override
  void dispose() { _poll?.cancel(); _life.dispose(); super.dispose(); }

  /// One action at a time (a second tap while one is running is ignored).
  /// [handle] may swallow an expected server error (returns true) instead of showing the generic toast.
  /// [verify] lets an ambiguous failure (dropped connection after the server may have acted) be settled by re-reading the job.
  Future<bool> _run(Future<void> Function() fn, {String? success, bool Function(Object e)? handle, bool Function(Job fresh)? verify}) async {
    if (_busy) return false;
    var ok = false;
    setState(() => _busy = true);
    try {
      await fn();
      ok = true;
      if (success != null && mounted) toast(context, context.tr(success));
    } catch (e) {
      var applied = false;
      if (verify != null && e is ApiException && (e.isTransient || e.code == 'INTERNAL' || e.code == 'INVALID_TRANSITION' || e.code == 'CONFLICT')) {
        try { applied = verify(await ref.read(apiProvider).job(widget.offerId).timeout(const Duration(seconds: 8))); } catch (_) { /* unknown: fall through to the error */ }
      }
      if (applied) {
        ok = true;
        if (success != null && mounted) toast(context, context.tr(success));
      } else if (mounted && !(handle?.call(e) ?? false)) {
        toast(context, errMessage(context, e), error: true);
      }
    }
    refreshAll(ref);
    ref.invalidate(jobProvider(widget.offerId));
    if (mounted) setState(() => _busy = false);
    return ok;
  }

  Future<void> _whatsapp(String kind) async {
    final lang = ref.read(localeProvider);
    try {
      final r = await ref.read(apiProvider).whatsapp(widget.offerId, kind, lang);
      final ok = await ref.read(linkOpenerProvider).open(Uri.parse(r['url'] as String));
      if (!ok && mounted) toast(context, context.tr('m.wa_open_failed'), error: true);
    } catch (e) {
      if (mounted) toast(context, e is ApiException && e.isNetwork ? errMessage(context, e) : context.tr('m.wa_open_failed'), error: true);
    }
  }

  static double? _d(Object? v) => v is num ? v.toDouble() : null;

  Future<void> _openMaps(Uri uri) async {
    final ok = await ref.read(linkOpenerProvider).open(uri);
    if (!ok && mounted) toast(context, context.tr('um.cant_maps'), error: true);
  }

  Future<void> _callRecipient(String phone) async {
    final ok = await ref.read(linkOpenerProvider).call(phone);
    if (!ok && mounted) toast(context, context.tr('um.cant_call'), error: true);
  }

  Future<void> _deliveredSheet(Job j) async {
    final units = await showModalBottomSheet<int>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _QtySheet(initial: j.maxBillable, max: j.maxBillable, title: c.tr(j.isDelivery ? 'job.how_many_delivered' : 'job.days_worked'), hint: j.isDelivery ? c.tr('job.delivered_hint', {'n': j.loadedUnits ?? j.expectedUnits}) : null, cta: c.tr('common.submit')));
    if (units != null) {
      await _run(() => ref.read(apiProvider).delivered(widget.offerId, units), success: 'job.delivered_ok', verify: (f) => !f.can('report_delivered'), handle: (e) {
        // The server caps the billable quantity (booked / loaded) and tells us the ceiling.
        if (e is ApiException && e.code == 'VALIDATION' && e.details['max'] != null) { toast(context, context.tr('job.max_units', {'max': e.details['max']}), error: true); return true; }
        return false;
      });
    }
  }

  Future<void> _cancelSheet() async {
    // Await the catalog so the policy warning is always shown (it may not have been loaded yet).
    if (ref.read(catalogProvider).hasError) ref.invalidate(catalogProvider);
    final cat = await ref.read(catalogProvider.future).timeout(const Duration(seconds: 6)).catchError((_) => <String, dynamic>{});
    if (!mounted) return;
    final p = (cat['policy'] as Map?) ?? const {};
    final reason = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _ReasonSheet(title: c.tr('act.cancel_job'), cta: c.tr('act.cancel_job'), danger: true, warning: p['cancelPolicyEnabled'] == true ? '${c.tr('job.cancel_policy_title')}: ${c.tr('job.cancel_policy', {'warn': p['cancelWarnAt'], 'days': p['cancelWindowDays'], 'suspend': p['cancelSuspendAt'], 'sd': p['cancelSuspendDays']})}' : null));
    if (reason != null) {
      final ok = await _run(() async { await ref.read(apiProvider).cancel(widget.offerId, reason); }, success: 'job.cancelled_ok', verify: (f) => f.status == 'cancelled' || !f.can('cancel'));
      if (ok && mounted) Navigator.of(context).maybePop(); // only leave the screen once the server really cancelled
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
    if (note != null) {
      await _run(() => ref.read(apiProvider).reportNoWork(widget.offerId, note.isEmpty ? null : note), success: 'job.reported_ok', handle: (e) {
        // One report per job: a repeat is a 409 — say so and hide the button instead of showing a scary error.
        if (e is ApiException && e.code == 'CONFLICT') { if (mounted) setState(() => _noWorkSent = true); toast(context, context.tr('job.no_work_already')); return true; }
        return false;
      });
    }
  }

  Future<void> _disputeLoading() async {
    final reason = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => _ReasonSheet(title: c.tr('job.dispute_title'), cta: c.tr('act.dispute_loading'), danger: true, info: c.tr('job.dispute_hint'), label: c.tr('job.dispute_reason')));
    if (reason != null) await _run(() => ref.read(apiProvider).ackLoading(widget.offerId, false, note: reason));
  }

  Future<void> _rate(int stars, String comment) => _run(() => ref.read(apiProvider).rate(widget.offerId, stars, comment: comment.isEmpty ? null : comment), success: 'job.rated_ok', handle: (e) {
        if (e is ApiException && e.status == 409) { if (mounted) setState(() => _rated = 'already'); return true; }
        return false;
      }).then((ok) { if (ok && mounted) setState(() => _rated = 'done'); });

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
          final hint = _hint(t, j);
          final mapsUri = j.manifest ? null : j.deliveryLat != null ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${j.deliveryLat},${j.deliveryLng}') : (j.deliveryAddress != null ? Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': j.deliveryAddress!}) : null);
          // Pickup navigation matters before loading; once the parcels are on board the stops panel owns navigation.
          final pLat = _d(j.pickup?['lat']), pLng = _d(j.pickup?['lng']), pAddr = j.pickup?['address'];
          final pickupUri = !const ['accepted', 'arrived'].contains(j.status) ? null : pLat != null && pLng != null ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$pLat,$pLng') : (pAddr is String && pAddr.isNotEmpty ? Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': pAddr}) : null);
          return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
            Row(children: [Expanded(child: Text(t('svc.${j.service}'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))), StatusPill(j.status)]),
            if (step >= 0) Padding(padding: const EdgeInsets.only(top: 12, bottom: 4), child: Row(children: [for (var i = 0; i < _flow.length; i++) Expanded(child: Container(height: 5, margin: const EdgeInsetsDirectional.only(end: 4), decoration: BoxDecoration(color: i <= step ? JR.accent : JR.line, borderRadius: BorderRadius.circular(4))))])),
            const SizedBox(height: 12),
            // ── stat cards: shipments · to deliver · delivered · not delivered · cash ──
            if (JobStatCards.visible(j)) ...[JobStatCards(job: j, lang: lang), const SizedBox(height: 12)],
            // ── one clear next step ──
            SectionCard(border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.next_step').toUpperCase(), style: const TextStyle(color: JR.accent, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1)),
              const SizedBox(height: 6),
              Text(hint, key: const Key('hint'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.35)),
              if (j.can('accept')) ...[const SizedBox(height: 14), Text(t('job.locked_until_accept'), style: const TextStyle(color: JR.muted, fontSize: 13))],
              if (j.can('checkin')) ...[const SizedBox(height: 14), ArrivalSection(job: j, run: _run, busy: _busy)],
              if (j.can('ack_loading')) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('ack'), onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).ackLoading(widget.offerId, true), verify: (f) => !f.can('ack_loading')), icon: busyIcon(_busy, Icons.inventory_2_outlined), label: Text(t('act.ack_loading', {'n': j.handedOverCount})))],
              if (j.can('dispute_loading')) ...[const SizedBox(height: 10), OutlinedButton(key: const Key('dispute'), onPressed: _busy ? null : _disputeLoading, child: Text(t('act.dispute_loading')))],
              if (j.can('report_delivered') && !j.manifest) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('delivered'), onPressed: _busy ? null : () => _deliveredSheet(j), icon: const Icon(Icons.inventory_2), label: Text(j.isDelivery ? t('act.report_delivered') : t('act.finish_work')))],
            ])),
            const SizedBox(height: 16),
            // ── finished: the delivery is confirmed and paid at once (no warehouse confirmation step) ──
            if (j.status == 'completed') ...[_CompletedCard(job: j, lang: lang), const SizedBox(height: 16)],
            // ── per-parcel jobs: route review, one current stop at a time, finish / end route ──
            // the whole route on a map, with a popup of quick actions per shipment
            if (j.manifest && (j.route?.planned ?? false) && j.status == 'attendance_confirmed') ...[RouteMapButton(offerId: j.offerId), const SizedBox(height: 12)],
            if (j.manifest) ManifestPanel(job: j),
            // ── recipient & contact ──
            if (j.recipient != null) SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.recipient'), style: const TextStyle(color: JR.muted, fontSize: 12)),
              const SizedBox(height: 6),
              Row(children: [Expanded(child: Text('${j.recipient!['name'] ?? ''}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), IconButton.filledTonal(key: const Key('recipient-call'), tooltip: t('m.call'), iconSize: 28, constraints: const BoxConstraints(minWidth: 52, minHeight: 52), onPressed: () => _callRecipient('${j.recipient!['phone']}'), icon: const Icon(Icons.call))]),
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
              if (j.pickup == null && j.delivery == null && !j.manifest) Text(t(j.status == 'offered' ? 'job.locked_until_accept' : 'job.details_hidden'), style: const TextStyle(color: JR.muted)) else ...[
                _addr(t('wizard.pickup_address'), j.pickup?['address'] as String?),
                if (pickupUri != null) ...[const SizedBox(height: 8), OutlinedButton.icon(key: const Key('pickup-maps'), onPressed: () => _openMaps(pickupUri), icon: const Icon(Icons.navigation_outlined), label: Text(t('um.navigate_pickup')))],
                const SizedBox(height: 8),
                if (!j.manifest) ...[_addr(t('wizard.delivery_address'), j.deliveryAddress)],
                if (j.manifest) Text(t('ms.stops_in_city', {'n': j.stops.isEmpty ? j.expectedUnits : j.stops.length, 'city': t('city.${j.deliveryCity}')}), key: const Key('stops-in-city'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                if (mapsUri != null) ...[const SizedBox(height: 12), OutlinedButton.icon(key: const Key('delivery-maps'), onPressed: () => _openMaps(mapsUri), icon: const Icon(Icons.navigation_outlined), label: Text(t('m.open_in_maps')))],
              ],
            ])),
            const SizedBox(height: 12),
            SectionCard(child: Column(children: [
              _kv(t('req.starts'), fmtDateTime(j.startsAt, lang)),
              if (j.vehicleType != null) _kv(t('wizard.vehicle'), '${t('vehicle.${j.vehicleType}')}${j.temperature != null ? ' · ${t('temp.${j.temperature}')}' : ''}'),
              _kv(t(j.isDelivery ? 'units.exp' : 'wizard.days'), '${j.expectedUnits}'),
              if (j.isDelivery) _kv(t(j.manifest ? 'ms.handed_over' : 'units.loaded'), '${j.loadedUnits ?? '—'}'),
              if (j.isDelivery) _kv(t('units.delivered'), '${j.deliveredUnits ?? (j.manifest && j.routeApproved ? j.stopsSummary.delivered : null) ?? '—'}'),
              if (j.manifest && !j.allowPartial) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('ms.all_or_nothing'), style: const TextStyle(color: JR.gold, fontSize: 12.5, height: 1.4))),
              if (j.finalUnits != null) _kv(t('units.final'), '${j.finalUnits}'),
              if (j.expectedEarningCents != null) _kv(t('job.expected_earning'), fmtMoney(j.expectedEarningCents, lang), color: JR.accent),
              if (j.contents != null) _kv(t('wizard.contents'), j.contents!),
              if (j.notes != null) _kv(t('wizard.notes'), j.notes!),
              if (j.cancelReason != null) _kv(t('req.reason'), j.cancelReason!),
            ])),
            const SizedBox(height: 16),
            if (j.status != 'offered' && j.status != 'rejected' && j.status != 'expired') ...[_CustodyCard(offerId: widget.offerId), ],
            if (j.status == 'completed' && _rated != 'already') ...[_RatingCard(done: _rated == 'done', busy: _busy, onSubmit: _rate), const SizedBox(height: 12)],
            if (j.status == 'completed' && _rated == 'already') ...[Banner2(text: t('job.rated_already')), const SizedBox(height: 12)],
            if (_noWorkSent) ...[Banner2(text: t('job.no_work_already')), const SizedBox(height: 10)],
            if (j.can('cancel')) OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger)), onPressed: _busy ? null : _cancelSheet, icon: const Icon(Icons.close), label: Text(t('act.cancel_job'))),
            if (j.can('report_no_work') && !_noWorkSent) ...[const SizedBox(height: 10), OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.gold, side: const BorderSide(color: JR.gold)), onPressed: _busy ? null : _problem, icon: const Icon(Icons.warning_amber), label: Text(t('act.report_problem')))],
            if (j.can('accept')) ...[const SizedBox(height: 10), Row(children: [Expanded(flex: 2, child: FilledButton(onPressed: () => context.go('/offers'), child: Text(t('act.accept'))))])],
            const SizedBox(height: 24),
          ]);
        }),
      ),
    );
  }

  /// One sentence for the "next step" card, derived from the server's actions so web and mobile never diverge.
  String _hint(Strings t, Job j) {
    // Finishing the route confirms and pays at once: nothing here waits for the warehouse any more.
    if (j.status == 'completed') return t('fma.hint_completed');
    if (j.status == 'delivered_reported' || j.status == 'pending_settlement') return t('fma.hint_settling');
    if (j.manifest && j.status == 'attendance_confirmed') {
      if (j.inScanLoading) return t('fma.hint_scan_loading');
      if (j.loadingDisputed) return t('job.hint_attendance_disputed');
      if (j.can('ack_loading')) return t('ms.hint_ack_parcels', {'n': j.handedOverCount});
      if (j.can('approve_route')) return t('ms.hint_approve_route');
      if (j.can('work_stops')) return t('ms.hint_work_stops');
      if (j.can('report_delivered')) return t('ms.hint_finish');
      if (j.loading.isScan) return t('fma.hint_planning'); // scanning is done and the route is being prepared: never "waiting for the warehouse to record the loading"
      return t('ms.hint_wait_handover');
    }
    return t(j.loadingDisputed ? 'job.hint_attendance_disputed' : 'job.hint_${j.status}${j.awaitingLoadingAck ? '_ack' : ''}');
  }

  Widget _addr(String label, String? v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(color: JR.muted, fontSize: 12)), Text(v ?? '—', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))]);
  /// Label left, value right. The label may take at most ~55% of the row and wraps beyond that, so a long label ("Handed over to you") at a large
  /// text size on a narrow phone can never push the row wider than the card; short labels keep their natural width and the value gets the rest.
  Widget _kv(String k, String v, {Color? color}) => Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: LayoutBuilder(builder: (context, c) => Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, crossAxisAlignment: CrossAxisAlignment.start, children: [ConstrainedBox(constraints: BoxConstraints(maxWidth: c.maxWidth * 0.55), child: Text(k, style: const TextStyle(color: JR.muted))), const SizedBox(width: 16), Flexible(child: Text(v, textAlign: TextAlign.end, textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w700, color: color)))])));
}

/// The job is over: the delivery was confirmed automatically and the earnings are already in the wallet.
class _CompletedCard extends StatelessWidget {
  const _CompletedCard({required this.job, required this.lang});
  final Job job;
  final String lang;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final router = GoRouter.maybeOf(context);
    return SectionCard(key: const Key('job-completed'), border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [const Icon(Icons.check_circle, color: JR.accent, size: 28), const SizedBox(width: 10), Expanded(child: Text(t('fma.job_completed_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)))]),
      const SizedBox(height: 6),
      Text(t('fma.job_completed_body'), key: const Key('job-completed-body'), style: const TextStyle(color: JR.muted, height: 1.4)),
      if (job.manifest && job.stopsSummary.notDelivered > 0) ...[const SizedBox(height: 10), Banner2(tone: Tone.warn, text: t('fma.finish_return_warning', {'n': job.stopsSummary.notDelivered}))],
      if (router != null) ...[const SizedBox(height: 12), OutlinedButton.icon(key: const Key('view-wallet'), onPressed: () => context.go('/wallet'), icon: const Icon(Icons.account_balance_wallet_outlined), label: Text(t('fma.view_wallet')))],
    ]));
  }
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
            IconButton.filledTonal(key: const Key('qty-minus'), tooltip: context.tr('um.decrease'), iconSize: 32, onPressed: _v > 0 ? () => _set(_v - 1) : null, icon: const Icon(Icons.remove)),
            Expanded(child: TextField(key: const Key('qty'), controller: _c, onChanged: (_) => setState(() {}), textAlign: TextAlign.center, keyboardType: TextInputType.number, inputFormatters: digitsOnly(max: 6), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800), decoration: const InputDecoration(border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, fillColor: Colors.transparent))),
            IconButton.filledTonal(key: const Key('qty-plus'), tooltip: context.tr('um.increase'), iconSize: 32, onPressed: _v < widget.max ? () => _set(_v + 1) : null, icon: const Icon(Icons.add)),
          ]),
          if (widget.hint != null) Center(child: Text(widget.hint!, style: const TextStyle(color: JR.muted))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('qty-submit'), onPressed: _c.text.isNotEmpty && _v <= widget.max ? () => Navigator.pop(context, _v) : null, child: Text(widget.cta)),
        ]),
      ));
}

class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.title, required this.cta, this.danger = false, this.warning, this.info, this.label, this.allowEmpty = false});
  final String title, cta;
  final bool danger, allowEmpty;
  final String? warning, info, label;
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
          TextField(key: const Key('reason'), controller: _c, onChanged: (_) => setState(() {}), maxLines: 3, decoration: InputDecoration(labelText: widget.label ?? context.tr('req.reason'))),
          const SizedBox(height: 16),
          FilledButton(key: const Key('reason-submit'), style: widget.danger ? FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.bg) : null, onPressed: (widget.allowEmpty || _c.text.trim().length >= 3) ? () => Navigator.pop(context, _c.text.trim()) : null, child: Text(widget.cta)),
        ]),
      ));
}

/// Custody: items the business handed to the driver. Hidden when there are none (or the list cannot load).
class _CustodyCard extends ConsumerStatefulWidget {
  const _CustodyCard({required this.offerId});
  final String offerId;
  @override
  ConsumerState<_CustodyCard> createState() => _CustodyCardState();
}

class _CustodyCardState extends ConsumerState<_CustodyCard> {
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
          Expanded(child: Text('${t('custody.${i['itemType']}')} × ${i['qty']}', style: const TextStyle(fontWeight: FontWeight.w700))),
          if (i['status'] != 'handed_over') ...[const SizedBox(width: 8), Flexible(child: Pill(t('status.${i['status']}'), tone: i['status'] == 'acknowledged' ? Tone.info : i['status'] == 'returned' ? Tone.success : Tone.danger))],
        ]),
        if (i['description'] != null) Text('${i['description']}', style: const TextStyle(color: JR.muted, fontSize: 12)),
        if (i['status'] == 'handed_over') Padding(padding: const EdgeInsets.only(top: 8), child: FilledButton(key: Key('ack-custody-${i['id']}'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: _busyId != null ? null : () => _ack('${i['id']}'), child: Text(t('custody.ack')))),
      ])),
      const SizedBox(height: 4),
      Text(t('custody.return_note'), style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.4)),
    ])));
  }
}

/// 1–5 star rating of the business after a completed job.
class _RatingCard extends StatefulWidget {
  const _RatingCard({required this.done, required this.busy, required this.onSubmit});
  final bool done, busy;
  final Future<void> Function(int stars, String comment) onSubmit;
  @override
  State<_RatingCard> createState() => _RatingCardState();
}

class _RatingCardState extends State<_RatingCard> {
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
      if (widget.done) Text(t('job.rated_ok'), key: const Key('rated-ok'), style: const TextStyle(color: JR.accent, fontWeight: FontWeight.w600)) else ...[
        Text(t('job.rate_hint'), style: const TextStyle(color: JR.muted)),
        const SizedBox(height: 8),
        Row(children: [for (var n = 1; n <= 5; n++) Expanded(child: IconButton(key: Key('star-$n'), tooltip: t('rate.star', {'n': n}), iconSize: 36, onPressed: () => setState(() => _stars = n), icon: Icon(n <= _stars ? Icons.star_rounded : Icons.star_outline_rounded, color: n <= _stars ? JR.gold : JR.line)))]), // share the card width: five fixed 52 dp buttons overflow a 320 dp phone
        TextField(key: const Key('rate-comment'), controller: _c, maxLines: 2, maxLength: 500, decoration: InputDecoration(labelText: t('rate.comment'))),
        const SizedBox(height: 8),
        FilledButton(key: const Key('rate-submit'), onPressed: widget.busy ? null : () => widget.onSubmit(_stars, _c.text.trim()), child: Text(t('common.submit'))),
      ],
    ]));
  }
}
