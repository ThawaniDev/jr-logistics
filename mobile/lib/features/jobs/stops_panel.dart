import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/barcode_scanner.dart';
import '../../widgets/common.dart';
import 'deliver_form.dart';
import 'end_route_sheet.dart';
import 'loading_scan.dart';
import 'route_order.dart';
import 'route_widgets.dart';
import 'shipments_screen.dart';
import 'stop_actions.dart';
import 'stop_order_editor.dart';

export 'deliver_form.dart' show StopDraft, StopDraftNotifier, stopDraftProvider;

/// Per-parcel delivery for jobs with `manifest: true`. Everything shown is driven by the server's `actions[]`:
/// `scan_loading` / `finish_loading` → loading by scanning · `approve_route` → route review · `work_stops` → one current stop at a time ·
/// `report_delivered` → finish · `end_route`. Every stop action lives in [StopActions] (shared with the route-map popup).
class ManifestPanel extends ConsumerStatefulWidget {
  const ManifestPanel({super.key, required this.job});
  final Job job;
  @override
  ConsumerState<ManifestPanel> createState() => _ManifestPanelState();
}

class _ManifestPanelState extends ConsumerState<ManifestPanel> {
  Job get j => widget.job;

  /// Where the driver is, for planning "from here". Permission is asked only now (the driver tapped Re-optimise); a refusal, a switched-off GPS or a
  /// slow fix simply means "no coordinates" — the server then plans from the pickup (or from the stop being served) and the driver is told so.
  Future<LatLng?> _position() async {
    final loc = ref.read(locationServiceProvider);
    try {
      if (!await loc.hasPermission() && !await loc.requestPermission()) return null;
      return await loc.current().timeout(const Duration(seconds: 6), onTimeout: () => null);
    } catch (_) {
      return null;
    }
  }

  /// Re-reads the job so the summary and the stop order on screen are the new plan before any message about it appears.
  Future<void> _reloadJob() async {
    ref.invalidate(jobProvider(j.offerId));
    ref.invalidate(activeJobsProvider);
    try { await ref.read(jobProvider(j.offerId).future).timeout(const Duration(seconds: 10)); } catch (_) { /* the stale strip says so */ }
  }

  /// "Re-optimise route": GPS (if allowed) → server plans → job refreshed → one message that says what happened. Single flight (shared with every
  /// other stop action); the job is re-read even after a failure that may still have been applied (dropped line, conflict). Last action wins over a manual order.
  Future<void> _optimise() async {
    String? message;
    await runStopAction(context, ref, j.offerId, () async {
      final p = await _position();
      final r = await ref.read(apiProvider).optimizeRoute(j.offerId, lat: p?.lat, lng: p?.lng);
      await _reloadJob();
      if (!mounted) return;
      final t = context.tr;
      final what = t(r.cached ? 'rm.opt_cached' : r.changed ? 'rm.opt_changed' : 'rm.opt_same');
      message = p == null ? '$what ${t('rm.no_gps_note')}' : what;
    }, handle: (e) { toast(context, routeErrMessage(context, e), error: true); return true; }, skipRefresh: (e) => e is ApiException && e.code == 'RATE_LIMITED');
    if (message != null && mounted) toast(context, message!);
  }

  Future<void> _openRouteMaps(Uri uri) async {
    final ok = await ref.read(linkOpenerProvider).open(uri);
    if (!ok && mounted) toast(context, context.tr('um.cant_maps'), error: true);
  }

  Future<void> _endRoute() => endRouteFlow(context, ref, j.offerId);

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final busy = ref.watch(stopBusyProvider).contains(j.offerId);
    final stops = j.stops;
    final s = j.stopsSummary;
    final children = <Widget>[];
    final route = j.route;
    final summary = route != null && (route.planned || route.canOptimize) ? RouteSummaryCard(job: j, busy: busy, onOptimise: _optimise, onOpenMaps: _openRouteMaps) : null;
    final firstId = stops.isEmpty ? null : stops.first.id;
    if (j.inScanLoading) {
      children.add(LoadingScanPanel(job: j));
    } else if (j.can('approve_route')) {
      if (summary != null) children..add(summary)..add(const SizedBox(height: 12));
      children.add(_RouteReview(job: j, busy: busy, onApprove: () => runStopAction(context, ref, j.offerId, () async { await ref.read(apiProvider).routeApprove(j.offerId); }, success: 'ms.route_approved_ok', verify: (f) => f.routeApproved)));
    } else if (j.can('work_stops')) {
      final cur = j.currentStop;
      children.add(_Progress(done: s.done, total: s.total));
      // The whole run sheet of the job (every shipment, with search and filters) — only an overview here: one stop at a time still applies.
      children.add(Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(key: const Key('all-shipments'), onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ShipmentsScreen(offerId: j.offerId))), icon: const Icon(Icons.view_list_outlined, size: 20), label: Text(t('drs.all_shipments')))));
      children.add(const SizedBox(height: 4));
      if (cur != null) {
        children.add(CurrentStopCard(key: ValueKey(cur.id), job: j, stop: cur, number: s.done + 1, total: s.total));
      } else {
        children.add(const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator(color: JR.accent))));
      }
      if (summary != null) children..add(const SizedBox(height: 16))..add(summary);
      final upcoming = [for (final x in stops) if (x.open && !x.current) x];
      if (upcoming.isNotEmpty) children..add(const SizedBox(height: 16))..add(_UpcomingList(job: j, stops: upcoming, firstId: firstId));
      if (j.can('end_route')) {
        children..add(const SizedBox(height: 16))..add(OutlinedButton.icon(key: const Key('end-route'), style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger)), onPressed: busy ? null : _endRoute, icon: const Icon(Icons.stop_circle_outlined), label: Text(t('ms.end_route'))));
      }
    } else if (j.can('report_delivered')) {
      children.add(_FinishCard(summary: s, busy: busy, onFinish: () => runStopAction(context, ref, j.offerId, () async { await ref.read(apiProvider).delivered(j.offerId); }, success: 'fma.finish_ok', verify: (f) => !f.can('report_delivered'))));
    }
    final done = [for (final x in stops) if (x.resolved) x];
    if (done.isNotEmpty) children..add(const SizedBox(height: 16))..add(_DoneList(stops: done));
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(key: const Key('manifest-panel'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [...children, const SizedBox(height: 16)]);
  }
}

String _cityName(BuildContext c, String? city) => cityLabel(c, city);

Widget _typeBadge(BuildContext c, Stop s) => Pill(c.tr('rtype.${s.recipientType}'), tone: s.isBusiness ? Tone.info : Tone.neutral);

/// With business shipments switched off by the platform every parcel is a consumer one: the "Consumer" tag says nothing then (an existing business parcel keeps its tag).
bool _showType(Job j, Stop s) => j.b2bShipmentsEnabled || s.isBusiness;

class _Progress extends StatelessWidget {
  const _Progress({required this.done, required this.total});
  final int done, total;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(context.tr('ms.stops_progress', {'done': done, 'total': total}), key: const Key('progress-text'), style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(key: const Key('progress-bar'), semanticsLabel: context.tr('ms.stops_progress', {'done': done, 'total': total}), minHeight: 8, value: total == 0 ? 0 : done / total, color: JR.accent, backgroundColor: JR.line)),
      ]);
}

/// "Change order" button, or — when the platform has switched manual ordering off — one line saying so (E5).
class _ReorderToggle extends StatelessWidget {
  const _ReorderToggle({required this.job, required this.editing, required this.onEdit, this.minMovable = 2});
  final Job job;
  final bool editing;
  final VoidCallback onEdit;
  final int minMovable;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    if (editing) return const SizedBox.shrink();
    if (job.canReorder && movableStops(job).length >= minMovable) return Padding(padding: const EdgeInsets.only(bottom: 12), child: OutlinedButton.icon(key: const Key('reorder-edit'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: onEdit, icon: const Icon(Icons.swap_vert), label: Text(t('fma.change_order'), textAlign: TextAlign.center)));
    if (!job.canReorder && job.policy != null && !job.policy!.canReorderRoute) return Padding(padding: const EdgeInsets.only(bottom: 12), child: Row(key: const Key('reorder-off'), crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.lock_outline, size: 16, color: JR.muted), const SizedBox(width: 6), Expanded(child: Text(t('fma.reorder_off'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.4)))]));
    return const SizedBox.shrink();
  }
}

// ───────────────────────── route review ─────────────────────────

class _RouteReview extends StatefulWidget {
  const _RouteReview({required this.job, required this.busy, required this.onApprove});
  final Job job;
  final bool busy;
  final VoidCallback onApprove;
  @override
  State<_RouteReview> createState() => _RouteReviewState();
}

class _RouteReviewState extends State<_RouteReview> {
  bool _editing = false;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final job = widget.job;
    final stops = job.stops;
    return SectionCard(key: const Key('route-review'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t('ms.route_review_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      const SizedBox(height: 4),
      Text(t('ms.parcels_count', {'n': stops.length}), style: const TextStyle(color: JR.muted)),
      const SizedBox(height: 10),
      Banner2(text: t('rm.review_note')),
      const SizedBox(height: 12),
      _ReorderToggle(job: job, editing: _editing, onEdit: () => setState(() => _editing = true)),
      if (stops.isEmpty) Text(t('ms.no_stops'), style: const TextStyle(color: JR.muted)),
      if (_editing)
        StopOrderEditor(job: job, stops: movableStops(job), fallbackCity: job.deliveryCity, onClose: () { if (mounted) setState(() => _editing = false); })
      else
        for (final (i, s) in stops.indexed) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(radius: 14, backgroundColor: JR.accent.withValues(alpha: 0.15), child: Text('${i + 1}', style: const TextStyle(color: JR.accent, fontSize: 12, fontWeight: FontWeight.w800))),
          const SizedBox(width: 12),
          Expanded(child: Column(key: Key('route-stop-${i + 1}'), crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.address, style: const TextStyle(fontWeight: FontWeight.w700)),
            Text(_cityName(context, s.city ?? job.deliveryCity), style: const TextStyle(color: JR.muted, fontSize: 13)),
            if (s.contents != null) Text(s.contents!, style: const TextStyle(color: JR.muted, fontSize: 13)),
            if (s.notes != null) Text(s.notes!, style: const TextStyle(color: JR.gold, fontSize: 13)),
            if (s.hasCod) Padding(padding: const EdgeInsets.only(top: 4), child: Pill(t('fma.cod_pill', {'amount': fmtMoney(s.codCents, t.code)}), tone: Tone.warn)),
            StopRouteMeta(stop: s, fromStart: i == 0, lead: [if (_showType(job, s)) _typeBadge(context, s)]),
          ])),
        ])),
      const SizedBox(height: 12),
      FilledButton.icon(key: const Key('approve-route'), onPressed: widget.busy || _editing ? null : widget.onApprove, icon: busyIcon(widget.busy, Icons.check_circle_outline), label: Text(t('ms.approve_route'))),
      if (_editing) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('fma.save_before_approve'), key: const Key('approve-blocked-hint'), textAlign: TextAlign.center, style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.35))),
    ]));
  }
}

// ───────────────────────── lists ─────────────────────────

class _UpcomingList extends ConsumerStatefulWidget {
  const _UpcomingList({required this.job, required this.stops, this.firstId});
  final Job job;
  final List<Stop> stops;
  /// The very first stop of the route (its leg is from the start, not from a previous stop).
  final String? firstId;
  @override
  ConsumerState<_UpcomingList> createState() => _UpcomingListState();
}

class _UpcomingListState extends ConsumerState<_UpcomingList> {
  final _find = TextEditingController();
  bool _editing = false;
  @override
  void dispose() { _find.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final job = widget.job;
    final all = widget.stops;
    final shown = [for (final s in all) if (s.matches(_find.text)) s];
    final busy = ref.watch(stopBusyProvider).contains(job.offerId);
    return SectionCard(key: const Key('upcoming'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${t('ms.upcoming')} (${all.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      const SizedBox(height: 8),
      _ReorderToggle(job: job, editing: _editing, onEdit: () => setState(() => _editing = true), minMovable: 2),
      if (_editing)
        StopOrderEditor(job: job, stops: movableStops(job), fallbackCity: job.deliveryCity, onClose: () { if (mounted) setState(() => _editing = false); })
      else ...[
        // Jump to a parcel: type or scan its code / order reference / address, the list narrows to it.
        if (all.length >= 3) Padding(padding: const EdgeInsets.only(bottom: 8), child: ScanField(fieldKey: const Key('find-parcel'), controller: _find, label: t('fma.find_parcel'), scanTitle: t('fma.find_parcel'), textInputAction: TextInputAction.search, onChanged: (_) => setState(() {}))),
        if (shown.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(t('fma.find_none'), key: const Key('find-none'), style: const TextStyle(color: JR.muted))),
        for (final s in shown) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Padding(padding: EdgeInsets.only(top: 2), child: Icon(Icons.radio_button_unchecked, size: 18, color: JR.muted)),
          const SizedBox(width: 10),
          Expanded(child: Column(key: Key('upcoming-${s.id}'), crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${s.address}${s.city != null ? ' · ${_cityName(context, s.city)}' : ''}', style: const TextStyle(color: JR.muted)),
            if (s.hasCod) Padding(padding: const EdgeInsets.only(top: 4), child: Pill(t('fma.cod_pill', {'amount': fmtMoney(s.codCents, t.code)}), tone: Tone.warn)),
            StopRouteMeta(stop: s, fromStart: s.id == widget.firstId),
            if (canMakeNext(job, s)) TextButton.icon(key: Key('make-next-${s.id}'), style: TextButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 4)), onPressed: busy ? null : () => StopActions.makeNext(context, ref, job, s), icon: const Icon(Icons.vertical_align_top, size: 18), label: Text(t('fma.make_next'))),
          ])),
        ])),
      ],
    ]));
  }
}

class _DoneList extends StatelessWidget {
  const _DoneList({required this.stops});
  final List<Stop> stops;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(key: const Key('done'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${t('ms.done')} (${stops.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      const SizedBox(height: 6),
      for (final s in stops) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(s.status == 'delivered' ? Icons.check_circle : Icons.cancel_outlined, size: 18, color: s.status == 'delivered' ? JR.accent : JR.danger),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.recipientName != null ? '${s.recipientName} · ${s.address}' : s.address),
          if (s.status != 'delivered' && s.failReason != null) Text(t('stopfail.${s.failReason}'), style: const TextStyle(color: JR.danger, fontSize: 12)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Pill(t('shipstatus.${s.status}'), tone: s.status == 'delivered' ? Tone.success : Tone.danger),
            if (s.status == 'delivered' && s.hasCod) Pill(t('fma.cod_collected_pill', {'amount': fmtMoney(s.codCollectedCents > 0 ? s.codCollectedCents : s.codCents, t.code)}), tone: Tone.info),
          ]),
        ])),
      ])),
    ]));
  }
}

// ───────────────────────── finish ─────────────────────────

class _FinishCard extends StatelessWidget {
  const _FinishCard({required this.summary, required this.busy, required this.onFinish});
  final StopsSummary summary;
  final bool busy;
  final VoidCallback onFinish;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(key: const Key('finish-card'), border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t('ms.finish_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      const SizedBox(height: 6),
      Text(t('ms.finish_summary', {'delivered': summary.delivered, 'failed': summary.notDelivered}), key: const Key('finish-summary'), style: const TextStyle(fontSize: 16)),
      if (summary.notDelivered > 0) ...[const SizedBox(height: 10), Banner2(key: const Key('return-warning'), tone: Tone.warn, text: t('fma.finish_return_warning', {'n': summary.notDelivered}))],
      const SizedBox(height: 10),
      Text(t('fma.finish_paid_note'), key: const Key('finish-paid-note'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.4)),
      const SizedBox(height: 14),
      FilledButton.icon(key: const Key('finish'), onPressed: busy ? null : onFinish, icon: busyIcon(busy, Icons.flag_outlined), label: Text(t('ms.finish_btn'))),
    ]));
  }
}

// ───────────────────────── current stop ─────────────────────────

/// The stop the driver is working on, with its one-tap contact/navigation tiles, "I've arrived", the hand-over form, "Can't deliver" and "Postpone".
/// The actions themselves are [StopActions] / [DeliverForm] — the same ones the route-map popup uses.
class CurrentStopCard extends ConsumerStatefulWidget {
  const CurrentStopCard({super.key, required this.job, required this.stop, required this.number, required this.total});
  final Job job;
  final Stop stop;
  final int number, total;
  @override
  ConsumerState<CurrentStopCard> createState() => _CurrentStopCardState();
}

class _CurrentStopCardState extends ConsumerState<CurrentStopCard> {
  /// Synchronous re-entry guard: set the instant "I've arrived" is tapped (before the GPS is read), so a second tap can never start a second arrival.
  bool _submitting = false;
  DateTime? _deadline;

  Stop get s => widget.stop;
  bool get _working => ref.read(stopBusyProvider).contains(widget.job.offerId) || _submitting;

  @override
  void initState() { super.initState(); _syncDeadline(); }

  @override
  void didUpdateWidget(CurrentStopCard old) {
    super.didUpdateWidget(old);
    if (old.stop.waitRemainingSec != s.waitRemainingSec || old.stop.arrivedAt != s.arrivedAt) _syncDeadline();
  }

  void _syncDeadline() => _deadline = s.waitRemainingSec == null ? null : DateTime.now().add(Duration(seconds: s.waitRemainingSec!));

  Future<void> _arrive() async {
    if (_working) return;
    setState(() => _submitting = true);
    try { await StopActions.arrive(context, ref, widget.job, s); } finally { if (mounted) setState(() => _submitting = false); }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final job = widget.job;
    ref.watch(stopBusyProvider); // buttons follow the shared in-flight flag (also set by the route-map popup)
    final working = _working;
    final phone = s.recipientPhone;
    return SectionCard(key: const Key('current-stop'), border: JR.accent, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(t('ms.stop_n_of', {'n': widget.number, 'total': widget.total}), key: const Key('stop-title'), style: const TextStyle(color: JR.accent, fontSize: 14, fontWeight: FontWeight.w800, letterSpacing: 0.5))),
        const SizedBox(width: 8),
        if (_showType(job, s)) Flexible(child: _typeBadge(context, s)),
      ]),
      const SizedBox(height: 8),
      Text(s.recipientName ?? '—', key: const Key('stop-recipient'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, height: 1.2)),
      if (phone != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(phone, textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 15))),
      const SizedBox(height: 12),
      Text(s.address, key: const Key('stop-address'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, height: 1.3)),
      if (s.city != null) Text(_cityName(context, s.city), style: const TextStyle(color: JR.muted, fontSize: 15)),
      StopRouteMeta(stop: s, fromStart: job.stops.isNotEmpty && job.stops.first.id == s.id),
      const SizedBox(height: 10),
      // The parcel to take out of the vehicle, in the exact form to type below.
      Container(
        key: const Key('stop-parcel'), width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(10), border: Border.all(color: JR.line)),
        child: Row(children: [
          const Icon(Icons.inventory_2_outlined, size: 20, color: JR.cyan), const SizedBox(width: 10),
          Expanded(child: Text(t('um.parcel_n', {'n': s.seq}), style: const TextStyle(fontWeight: FontWeight.w700))),
          if (s.code.isNotEmpty) Flexible(child: Text(s.code, textDirection: TextDirection.ltr, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 13))),
        ]),
      ),
      if (s.contents != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${t('wizard.contents')}: ${s.contents}', style: const TextStyle(color: JR.muted))),
      if (s.notes != null) Padding(padding: const EdgeInsets.only(top: 6), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.sticky_note_2_outlined, size: 18, color: JR.gold), const SizedBox(width: 6), Expanded(child: Text(s.notes!, style: const TextStyle(color: JR.gold, fontWeight: FontWeight.w600, height: 1.3)))])),
      if (s.hasCod && !s.arrived) ...[const SizedBox(height: 10), CodBox(cents: s.codCents)], // the cash to collect is known before the door
      const SizedBox(height: 14),
      // One tap each, thumb-sized, icon above label so no translation truncates.
      Row(children: [
        Expanded(child: _ActionTile(key: const Key('stop-call'), icon: Icons.call, label: t('m.call'), onTap: phone == null ? null : () => StopActions.call(context, s))),
        const SizedBox(width: 8),
        Expanded(child: _ActionTile(key: const Key('stop-wa'), icon: Icons.chat, label: t('ms.whatsapp'), iconColor: JR.accent, onTap: phone == null ? null : () => StopActions.whatsapp(context, ref, job, s))),
        const SizedBox(width: 8),
        Expanded(child: _ActionTile(key: const Key('stop-maps'), icon: Icons.navigation_outlined, label: t('um.navigate'), iconColor: JR.cyan, onTap: () => StopActions.navigate(context, s))),
      ]),
      const Divider(height: 28),
      if (!s.arrived) ...[
        Text(t('ms.arrive_first'), style: const TextStyle(color: JR.muted, height: 1.4)),
        const SizedBox(height: 12),
        FilledButton.icon(key: const Key('arrive'), onPressed: working ? null : _arrive, icon: busyIcon(working, Icons.my_location), label: Text(t('act.checkin'))),
      ] else ...[
        // The door timer is gone unless the platform sets a wait (policy.stopWaitMin > 0).
        if (job.showsStopWait) _WaitNotice(deadline: _deadline),
        DeliverForm(key: ValueKey('form-${s.id}'), job: job, stop: s),
      ],
      const SizedBox(height: 12),
      OutlinedButton.icon(key: const Key('cant-deliver'), style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger), minimumSize: const Size.fromHeight(52)), onPressed: working ? null : () => StopActions.cantDeliver(context, ref, job, s), icon: const Icon(Icons.report_gmailerrorred), label: Text(t('ms.cant_deliver'))),
      if (s.canDefer) ...[
        const SizedBox(height: 8),
        OutlinedButton.icon(key: const Key('postpone'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)), onPressed: working ? null : () => StopActions.postpone(context, ref, job, s), icon: const Icon(Icons.schedule), label: Text(t('ms.postpone'))),
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(t('ms.postpone_hint'), style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.4))),
      ],
    ]));
  }
}

/// Thumb-sized icon-over-label button (call / WhatsApp / navigate). A disabled one is greyed, never hidden, so the layout does not jump.
class _ActionTile extends StatelessWidget {
  const _ActionTile({super.key, required this.icon, required this.label, required this.onTap, this.iconColor});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color? iconColor;
  @override
  Widget build(BuildContext context) => OutlinedButton(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 68), padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8)),
        onPressed: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 24, color: onTap == null ? null : iconColor), const SizedBox(height: 4),
          Text(label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, height: 1.15)),
        ]),
      );
}

/// After arrival, only when the platform sets a wait (`policy.stopWaitMin > 0`): how long to wait at the door before "unreachable" becomes available.
class _WaitNotice extends StatelessWidget {
  const _WaitNotice({required this.deadline});
  final DateTime? deadline;
  @override
  Widget build(BuildContext context) {
    final d = deadline;
    if (d == null) return const SizedBox.shrink();
    final t = context.tr;
    return DeadlineBuilder(deadline: d, builder: (_, left) => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: left > 0
          ? Banner2(key: const Key('wait-notice'), tone: Tone.info, icon: Icons.timer_outlined, title: fmtCountdown(left), text: t('um.wait_notice'))
          : Banner2(key: const Key('wait-over'), tone: Tone.warn, icon: Icons.timer_off_outlined, text: t('um.wait_over')),
    ));
  }
}
