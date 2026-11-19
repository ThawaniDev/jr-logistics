import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/maps.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../widgets/common.dart';

/// Driver-readable text of one planner warning (`CODE` or `CODE:param`): the dictionary key is `route.warn.<CODE>` and `{n}` is the parameter.
/// The text after the colon is never shown as it is — for `ROUTING_PROVIDER_FAILED` it is raw provider detail. An unknown code, or a code that
/// needs a number the server did not send, falls back to one generic line (with the code, for support).
String routeWarningText(Strings t, RouteWarning w) {
  final key = 'route.warn.${w.code}';
  final n = w.count;
  if (!t.has(key) || (t(key).contains('{n}') && n == null)) {
    return t('rm.warn_generic', {'code': RegExp(r'^[A-Z0-9_]{1,40}$').hasMatch(w.code) ? w.code : '?'});
  }
  return t(key, {'n': n});
}

/// Failure text for "Re-optimise": a 429 / 409 get a hint of what to do next, everything else goes through the app-wide mapper.
String routeErrMessage(BuildContext c, Object e) {
  if (e is ApiException) {
    if (e.code == 'RATE_LIMITED') return c.tr('rm.err_rate_limited');
    if (e.code == 'CONFLICT') return c.tr('rm.err_conflict');
  }
  return errMessage(c, e);
}

/// The route at a glance: who planned it (Google or an estimate), how far / how long, what is left, anything the planner could not do — and
/// the two actions that belong to it: "Re-optimise route" and "Open route in Google Maps". Shown while the driver reviews the route and while working it.
class RouteSummaryCard extends StatelessWidget {
  const RouteSummaryCard({super.key, required this.job, required this.busy, required this.onOptimise, required this.onOpenMaps});
  final Job job;
  /// Another action (or the planning itself) is running: no second one may start.
  final bool busy;
  final VoidCallback onOptimise;
  final void Function(Uri uri) onOpenMaps;

  @override
  Widget build(BuildContext context) {
    final r = job.route;
    if (r == null) return const SizedBox.shrink();
    final t = context.tr;
    final working = job.can('work_stops');
    final stops = job.stops;
    final left = stops.where((s) => s.open).length;
    final maps = googleMapsRoute(stops);
    final chip = r.provider != null && t.has('route.provider.${r.provider}') ? Pill(t('route.provider.${r.provider}'), key: const Key('route-provider'), tone: r.isGoogle ? Tone.success : r.manual ? Tone.info : Tone.warn) : null;
    final warnings = <String>{for (final w in r.warnings) routeWarningText(t, w)}.toList();
    String dist(int? m) => m == null || m <= 0 ? '—' : fmtDist(t, m);
    String time(int? s) => s == null || s <= 0 ? '—' : fmtTravel(t, s);
    Widget stat(Key k, String label, String value) => Expanded(child: Column(key: k, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: JR.muted, fontSize: 12, height: 1.25)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, height: 1.2)),
        ]));
    return SectionCard(key: const Key('route-summary'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        const Icon(Icons.alt_route, color: JR.cyan, size: 22),
        const SizedBox(width: 8),
        Expanded(child: Text(t('rm.title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
        if (chip != null) ...[const SizedBox(width: 8), Flexible(child: chip)],
      ]),
      const SizedBox(height: 12),
      if (!r.planned)
        Text(t('rm.not_planned'), key: const Key('route-not-planned'), style: const TextStyle(color: JR.muted, height: 1.4))
      else ...[
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          stat(const Key('route-distance'), t(working ? 'rm.remaining_distance' : 'rm.distance'), dist(working ? r.remainingDistanceM : r.totalDistanceM)),
          const SizedBox(width: 10),
          stat(const Key('route-time'), t(working ? 'rm.remaining_time' : 'rm.drive_time'), time(working ? r.remainingDurationS : r.totalDurationS)),
          const SizedBox(width: 10),
          stat(const Key('route-stops'), t(working ? 'rm.stops_left' : 'rm.stops'), working ? t('rm.stops_left_of', {'left': left, 'total': stops.length}) : '${stops.length}'),
        ]),
        if (working && (r.totalDistanceM ?? 0) + (r.totalDurationS ?? 0) > 0) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('rm.whole_route', {'dist': dist(r.totalDistanceM), 'time': time(r.totalDurationS)}), key: const Key('route-whole'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
        if (r.plannedAt != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(t(r.by == 'driver' ? 'rm.planned_driver' : 'rm.planned_system', {'time': fmtTime(r.plannedAt)}), key: const Key('route-planned'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
        // Honest about what this is: anything that did not come from Google's traffic-aware planner says so, in plain words.
        // A manual order (the driver arranged it, `provider: manual`) is not "an estimate from the planner": it says whose order it is and how to hand it back.
        if (r.manual) Padding(padding: const EdgeInsets.only(top: 12), child: Banner2(key: const Key('route-manual-notice'), tone: Tone.info, icon: Icons.swap_vert, text: t('fma.route_manual_note')))
        else if (!r.isGoogle) Padding(padding: const EdgeInsets.only(top: 12), child: Banner2(key: const Key('route-estimate-notice'), tone: Tone.warn, text: t(r.provider == 'mixed' ? 'rm.notice_mixed' : 'rm.notice_local'))),
        for (final (i, w) in warnings.indexed) Padding(padding: const EdgeInsets.only(top: 10), child: Row(key: Key('route-warning-$i'), crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, size: 18, color: JR.gold),
          const SizedBox(width: 8),
          Expanded(child: Text(w, style: const TextStyle(fontSize: 13, height: 1.35))),
        ])),
      ],
      const SizedBox(height: 14),
      if (r.canOptimize) ...[
        OutlinedButton.icon(key: const Key('route-optimize'), onPressed: busy ? null : onOptimise, icon: busyIcon(busy, Icons.autorenew, color: JR.accent), label: Text(t('rm.optimize'), textAlign: TextAlign.center)),
        Padding(padding: const EdgeInsets.only(top: 6, bottom: 12), child: Text(t(working ? 'rm.optimize_hint_working' : 'rm.optimize_hint_review'), key: const Key('route-optimize-hint'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.4))),
      ],
      OutlinedButton.icon(key: const Key('route-open-maps'), onPressed: maps == null ? null : () => onOpenMaps(maps.uri), icon: Icon(Icons.map_outlined, color: maps == null ? null : JR.cyan), label: Text(t('rm.open_maps'), textAlign: TextAlign.center)),
      Padding(padding: const EdgeInsets.only(top: 6), child: Text(
        maps == null ? t('rm.maps_none') : maps.located > maps.shown ? t('rm.maps_next_n', {'n': maps.shown, 'total': maps.located}) : t('rm.maps_hint'),
        key: const Key('route-maps-hint'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.4),
      )),
      if (maps != null && maps.skipped > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text(t('rm.maps_skipped', {'n': maps.skipped}), key: const Key('route-maps-skipped'), style: const TextStyle(color: JR.gold, fontSize: 12.5, height: 1.4))),
    ]));
  }
}

/// Under a stop's address: the driving leg into it ("≈ 12 min · 4.2 km from the previous stop") and the location badges — "No map location"
/// (the stop is placed last and cannot be navigated to by pin) and "Approximate location" (found only roughly from the address). [lead] badges
/// (e.g. the recipient type) share the same wrapping row. Renders nothing when there is nothing to say.
class StopRouteMeta extends StatelessWidget {
  const StopRouteMeta({super.key, required this.stop, this.fromStart = false, this.lead = const []});
  final Stop stop;
  /// The first stop of the route: its leg is from the start of the route, not from a previous stop.
  final bool fromStart;
  final List<Widget> lead;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final s = stop;
    final parts = [if ((s.legDurationS ?? 0) > 0) fmtTravel(t, s.legDurationS!), if ((s.legDistanceM ?? 0) > 0) fmtDist(t, s.legDistanceM!)];
    final badges = [
      ...lead,
      if (!s.located) Pill(t('rm.no_location'), key: Key('badge-unlocated-${s.id}'), tone: Tone.warn),
      if (s.approximate) Pill(t('rm.approx_location'), key: Key('badge-approx-${s.id}'), tone: Tone.info),
    ];
    if (parts.isEmpty && badges.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (parts.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.directions_car_outlined, size: 16, color: JR.cyan)),
        const SizedBox(width: 6),
        Expanded(child: Text(t(fromStart ? 'rm.leg_start' : 'rm.leg_prev', {'leg': parts.join(' · ')}), key: Key('leg-${s.id}'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
      ])),
      if (badges.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 6, runSpacing: 6, children: badges)),
    ]);
  }
}
