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
import 'job_detail_parts.dart';
import 'end_route_sheet.dart';
import 'job_stats.dart';
import 'route_map_screen.dart';
import 'shipments_view.dart';
import 'stops_panel.dart';

const _flow = ['accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'pending_settlement', 'completed'];

class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.offerId, this.details = false});
  final String offerId;
  /// Routing off: the job page is the shipments run sheet; `details: true` is the full job information page behind its "Job details" button.
  final bool details;
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
    final units = await showModalBottomSheet<int>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => QtySheet(initial: j.maxBillable, max: j.maxBillable, title: c.tr(j.isDelivery ? 'job.how_many_delivered' : 'job.days_worked'), hint: j.isDelivery ? c.tr('job.delivered_hint', {'n': j.loadedUnits ?? j.expectedUnits}) : null, cta: c.tr('common.submit')));
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
    final p = mapOf(cat['policy']) ?? const <String, dynamic>{};
    final reason = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => ReasonSheet(title: c.tr('act.cancel_job'), cta: c.tr('act.cancel_job'), danger: true, warning: p['cancelPolicyEnabled'] == true ? '${c.tr('job.cancel_policy_title')}: ${c.tr('job.cancel_policy', {'warn': p['cancelWarnAt'], 'days': p['cancelWindowDays'], 'suspend': p['cancelSuspendAt'], 'sd': p['cancelSuspendDays']})}' : null));
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
    final note = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => ReasonSheet(title: c.tr('act.report_problem'), cta: c.tr('common.submit'), info: c.tr('job.problem_note'), allowEmpty: true));
    if (note != null) {
      await _run(() => ref.read(apiProvider).reportNoWork(widget.offerId, note.isEmpty ? null : note), success: 'job.reported_ok', handle: (e) {
        // One report per job: a repeat is a 409 — say so and hide the button instead of showing a scary error.
        if (e is ApiException && e.code == 'CONFLICT') { if (mounted) setState(() => _noWorkSent = true); toast(context, context.tr('job.no_work_already')); return true; }
        return false;
      });
    }
  }

  Future<void> _disputeLoading() async {
    final reason = await showModalBottomSheet<String>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => ReasonSheet(title: c.tr('job.dispute_title'), cta: c.tr('act.dispute_loading'), danger: true, info: c.tr('job.dispute_hint'), label: c.tr('job.dispute_reason')));
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
      appBar: AppBar(title: Text(job.value?.ref ?? t('nav.my_jobs'), textDirection: TextDirection.ltr), actions: [
        if (job.hasValue && job.value!.status != 'offered') IconButton(tooltip: t('chat.title'), icon: const Icon(Icons.chat_bubble_outline), onPressed: () => context.push('/job/${widget.offerId}/chat')),
        if (job.hasValue && _runSheet(job.value!)) _runSheetMenu(job.value!),
      ]),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(jobProvider(widget.offerId)); await ref.read(jobProvider(widget.offerId).future); },
        child: AsyncBody(value: job, onRetry: () => ref.invalidate(jobProvider(widget.offerId)), builder: (j) {
          if (_runSheet(j)) {
            return ShipmentsView(job: j, lang: lang, extras: [
              PendingCustody(offerId: widget.offerId),
              if (j.status == 'completed') ...[CompletedCard(job: j, lang: lang), const SizedBox(height: 12)],
              if (j.status == 'completed' && _rated != 'already') ...[RatingCard(done: _rated == 'done', busy: _busy, onSubmit: _rate), const SizedBox(height: 12)],
              if (j.status == 'completed' && _rated == 'already') ...[Banner2(text: t('job.rated_already')), const SizedBox(height: 12)],
            ]);
          }
          final step = _flow.indexOf(j.status);
          final hint = _hint(t, j);
          final mapsUri = j.manifest ? null : j.deliveryLat != null ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${j.deliveryLat},${j.deliveryLng}') : (j.deliveryAddress != null ? Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': j.deliveryAddress!}) : null);
          // Pickup navigation matters before loading; once the parcels are on board the stops panel owns navigation.
          final pLat = _d(j.pickup?['lat']), pLng = _d(j.pickup?['lng']), pAddr = j.pickup?['address'];
          final pickupUri = !const ['accepted', 'arrived'].contains(j.status) ? null : pLat != null && pLng != null ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$pLat,$pLng') : (pAddr is String && pAddr.isNotEmpty ? Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': pAddr}) : null);
          return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
            Row(children: [Expanded(child: Text(t.val('svc', j.service), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800))), StatusPill(j.status)]),
            if (step >= 0) Padding(padding: const EdgeInsets.only(top: 12, bottom: 4), child: Row(children: [for (var i = 0; i < _flow.length; i++) Expanded(child: Container(height: 5, margin: const EdgeInsetsDirectional.only(end: 4), decoration: BoxDecoration(color: i <= step ? JR.accent : JR.line, borderRadius: BorderRadius.circular(4))))])),
            const SizedBox(height: 12),
            // ── stat cards: shipments · to deliver · delivered · not delivered · cash ──
            if (JobStatCards.visible(j)) ...[JobStatCards(job: j, lang: lang), const SizedBox(height: 12)],
            // ── one clear next step ──
            SectionCard(border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.next_step').toUpperCase(), style: TextStyle(color: JR.accent, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1)),
              const SizedBox(height: 6),
              Text(hint, key: const Key('hint'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.35)),
              if (j.can('accept')) ...[const SizedBox(height: 14), Text(t('job.locked_until_accept'), style: TextStyle(color: JR.muted, fontSize: 13))],
              if (j.can('checkin')) ...[const SizedBox(height: 14), ArrivalSection(job: j, run: _run, busy: _busy)],
              if (j.can('ack_loading')) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('ack'), onPressed: _busy ? null : () => _run(() => ref.read(apiProvider).ackLoading(widget.offerId, true), verify: (f) => !f.can('ack_loading')), icon: busyIcon(_busy, Icons.inventory_2_outlined), label: Text(t('act.ack_loading', {'n': j.handedOverCount})))],
              if (j.can('dispute_loading')) ...[const SizedBox(height: 10), OutlinedButton(key: const Key('dispute'), onPressed: _busy ? null : _disputeLoading, child: Text(t('act.dispute_loading')))],
              if (j.can('report_delivered') && !j.manifest) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('delivered'), onPressed: _busy ? null : () => _deliveredSheet(j), icon: const Icon(Icons.inventory_2), label: Text(j.isDelivery ? t('act.report_delivered') : t('act.finish_work')))],
            ])),
            const SizedBox(height: 16),
            // ── finished: the delivery is confirmed and paid at once (no warehouse confirmation step) ──
            if (j.status == 'completed') ...[CompletedCard(job: j, lang: lang), const SizedBox(height: 16)],
            // ── per-parcel jobs: route review, one current stop at a time, finish / end route ──
            // the whole route on a map, with a popup of quick actions per shipment
            if (j.manifest && j.routingEnabled && (j.route?.planned ?? false) && j.status == 'attendance_confirmed') ...[RouteMapButton(offerId: j.offerId), const SizedBox(height: 12)],
            if (j.manifest && !ShipmentsView.applies(j)) ManifestPanel(job: j),
            // ── recipient & contact ──
            if (j.recipient != null) SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.recipient'), style: TextStyle(color: JR.muted, fontSize: 12)),
              const SizedBox(height: 6),
              Row(children: [Expanded(child: Text('${j.recipient!['name'] ?? ''}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), IconButton.filledTonal(key: const Key('recipient-call'), tooltip: t('m.call'), iconSize: 28, constraints: const BoxConstraints(minWidth: 52, minHeight: 52), onPressed: () => _callRecipient('${j.recipient!['phone']}'), icon: const Icon(Icons.call))]),
              Text('${j.recipient!['phone']}', textDirection: TextDirection.ltr, style: TextStyle(color: JR.muted)),
              const SizedBox(height: 12),
              // Icon above label so translations never truncate ("On my way" / "في الطريق" / "راستے میں").
              Row(children: [for (final (i, k) in ['contact', 'arriving', 'issue'].indexed) Expanded(child: Padding(padding: EdgeInsetsDirectional.only(end: i < 2 ? 8 : 0), child: OutlinedButton(key: Key('wa-$k'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 68), padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8)), onPressed: () => _whatsapp(k), child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.chat, size: 20, color: JR.accent), const SizedBox(height: 4), Text(t('wa.$k'), textAlign: TextAlign.center, maxLines: 2, style: const TextStyle(fontSize: 12.5, height: 1.2))]))))]),
              const SizedBox(height: 8),
              Text(t('job.wa_note'), style: TextStyle(color: JR.muted, fontSize: 11.5, height: 1.4)),
              TextButton.icon(onPressed: _cantReach, icon: const Icon(Icons.phone_disabled, size: 18), label: Text(t('job.cant_reach'))),
            ])),
            if (j.recipient != null) const SizedBox(height: 12),
            // ── locations ──
            SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t('job.locations'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 10),
              if (j.pickup == null && j.delivery == null && !j.manifest) Text(t(j.status == 'offered' ? 'job.locked_until_accept' : 'job.details_hidden'), style: TextStyle(color: JR.muted)) else ...[
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
              if (j.vehicleType != null) _kv(t('wizard.vehicle'), '${t.val('vehicle', j.vehicleType)}${j.temperature != null ? ' · ${t.val('temp', j.temperature)}' : ''}'),
              _kv(t(j.isDelivery ? 'units.exp' : 'wizard.days'), '${j.expectedUnits}'),
              if (j.isDelivery) _kv(t(j.manifest ? 'ms.handed_over' : 'units.loaded'), '${j.loadedUnits ?? '—'}'),
              if (j.isDelivery) _kv(t('units.delivered'), '${j.deliveredUnits ?? (j.manifest && j.routeApproved ? j.stopsSummary.delivered : null) ?? '—'}'),
              if (j.manifest && !j.allowPartial) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('ms.all_or_nothing'), style: TextStyle(color: JR.gold, fontSize: 12.5, height: 1.4))),
              if (j.finalUnits != null) _kv(t('units.final'), '${j.finalUnits}'),
              if (j.expectedEarningCents != null && !j.earningHidden) _kv(t('job.expected_earning'), fmtMoney(j.expectedEarningCents, lang), color: JR.accent),
              if (j.contents != null) _kv(t('wizard.contents'), j.contents!),
              if (j.notes != null) _kv(t('wizard.notes'), j.notes!),
              if (j.cancelReason != null) _kv(t('req.reason'), j.cancelReason!),
            ])),
            const SizedBox(height: 16),
            if (j.status != 'offered' && j.status != 'rejected' && j.status != 'expired') ...[CustodyCard(offerId: widget.offerId), ],
            if (j.status == 'completed' && _rated != 'already') ...[RatingCard(done: _rated == 'done', busy: _busy, onSubmit: _rate), const SizedBox(height: 12)],
            if (j.status == 'completed' && _rated == 'already') ...[Banner2(text: t('job.rated_already')), const SizedBox(height: 12)],
            if (_noWorkSent) ...[Banner2(text: t('job.no_work_already')), const SizedBox(height: 10)],
            if (j.can('cancel')) OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: BorderSide(color: JR.danger)), onPressed: _busy ? null : _cancelSheet, icon: const Icon(Icons.close), label: Text(t('act.cancel_job'))),
            if (j.can('report_no_work') && !_noWorkSent) ...[const SizedBox(height: 10), OutlinedButton.icon(style: OutlinedButton.styleFrom(foregroundColor: JR.gold, side: BorderSide(color: JR.gold)), onPressed: _busy ? null : _problem, icon: const Icon(Icons.warning_amber), label: Text(t('act.report_problem')))],
            if (j.can('accept')) ...[const SizedBox(height: 10), Row(children: [Expanded(flex: 2, child: FilledButton(onPressed: () => context.go('/offers'), child: Text(t('act.accept'))))])],
            const SizedBox(height: 24),
          ]);
        }),
      ),
    );
  }

  /// Routing off: the job page is the shipments run sheet (unless the full information page was asked for).
  bool _runSheet(Job j) => !widget.details && ShipmentsView.applies(j);

  /// The run sheet's overflow menu: the job's full information page, and — while delivering — ending the route early.
  Widget _runSheetMenu(Job j) => PopupMenuButton<String>(
        key: const Key('drs-menu'), tooltip: context.tr('drs.more'),
        onSelected: (v) { if (v == 'info') { Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => JobDetailScreen(offerId: widget.offerId, details: true))); } else if (v == 'end') { endRouteFlow(context, ref, widget.offerId); } },
        itemBuilder: (c) => [
          PopupMenuItem(key: const Key('job-info'), value: 'info', child: Text(c.tr('drs.job_details'))),
          if (j.can('end_route')) PopupMenuItem(key: const Key('end-route'), value: 'end', child: Text(c.tr('ms.end_route'), style: TextStyle(color: JR.danger))),
        ],
      );

  /// One sentence for the "next step" card, derived from the server's actions so web and mobile never diverge.
  String _hint(Strings t, Job j) {
    // Finishing the route confirms and pays at once: nothing here waits for the warehouse any more.
    final office = j.earningHidden; // a driver of an office: nothing about his own wallet
    if (j.status == 'completed') return t(office ? 'drs.hint_completed_office' : 'fma.hint_completed');
    if (j.status == 'delivered_reported' || j.status == 'pending_settlement') return t(office ? 'drs.hint_settling_office' : 'fma.hint_settling');
    if (j.manifest && j.status == 'attendance_confirmed') {
      if (j.inScanLoading) return t('fma.hint_scan_loading');
      if (j.loadingDisputed) return t('job.hint_attendance_disputed');
      if (j.can('ack_loading')) return t('ms.hint_ack_parcels', {'n': j.handedOverCount});
      if (j.can('approve_route')) return t('ms.hint_approve_route');
      if (j.can('work_stops')) return t(j.routingEnabled ? 'ms.hint_work_stops' : 'drs.hint_work');
      if (j.can('report_delivered')) return t('ms.hint_finish');
      if (j.loading.isScan) return t('fma.hint_planning'); // scanning is done and the route is being prepared: never "waiting for the warehouse to record the loading"
      return t('ms.hint_wait_handover');
    }
    final hint = j.loadingDisputed ? 'job.hint_attendance_disputed' : 'job.hint_${j.status}${j.awaitingLoadingAck ? '_ack' : ''}';
    return t.knows(hint) ? t(hint) : t.val('jobstatus', j.status); // a status of a newer server: its name, never a raw key
  }

  Widget _addr(String label, String? v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: TextStyle(color: JR.muted, fontSize: 12)), Text(v ?? '—', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))]);
  /// Label left, value right. The label may take at most ~55% of the row and wraps beyond that, so a long label ("Handed over to you") at a large
  /// text size on a narrow phone can never push the row wider than the card; short labels keep their natural width and the value gets the rest.
  Widget _kv(String k, String v, {Color? color}) => Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: LayoutBuilder(builder: (context, c) => Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, crossAxisAlignment: CrossAxisAlignment.start, children: [ConstrainedBox(constraints: BoxConstraints(maxWidth: c.maxWidth * 0.55), child: Text(k, style: TextStyle(color: JR.muted))), const SizedBox(width: 16), Flexible(child: Text(v, textAlign: TextAlign.end, textDirection: TextDirection.ltr, style: TextStyle(fontWeight: FontWeight.w700, color: color)))])));
}
