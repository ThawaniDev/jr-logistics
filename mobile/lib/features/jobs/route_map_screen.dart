import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' as ll;
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import 'map_actions.dart';
import 'route_map_logic.dart';

/// OpenStreetMap raster tiles — no Maps SDK key needed. Override with `--dart-define=MAP_TILE_URL=https://…/{z}/{x}/{y}.png` (a self-hosted or commercial tile server).
const mapTileUrl = String.fromEnvironment('MAP_TILE_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
const mapUserAgentPackage = 'com.jrlogistics.jrDriver';
const _defaultCenter = ll.LatLng(24.7136, 46.6753); // Riyadh, only used when nothing at all can be plotted
final _osmCopyright = Uri.parse('https://www.openstreetmap.org/copyright');

/// The tile source. Tests override it with a provider that never touches the network.
final mapTileProviderProvider = Provider.autoDispose<TileProvider>((ref) {
  final p = NetworkTileProvider();
  ref.onDispose(p.dispose);
  return p;
});

ll.LatLng _ll(GeoPt p) => ll.LatLng(p.lat, p.lng);

/// "Route map" button for the job screen: opens `/job/:id/map`.
class RouteMapButton extends StatelessWidget {
  const RouteMapButton({super.key, required this.offerId});
  final String offerId;
  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        key: const Key('route-map-button'), onPressed: () => context.push('/job/$offerId/map'),
        icon: const Icon(Icons.map_outlined, color: JR.cyan), label: Text(context.tr('fmb.map_btn'), textAlign: TextAlign.center),
      );
}

/// The whole route on a map (top) and as a list (bottom): coloured legs, lettered markers, a navigate button per stop, and a popup with the
/// stop's details and every quick action the server allows for it. See memory/DECISIONS.md E6.
class RouteMapScreen extends ConsumerStatefulWidget {
  const RouteMapScreen({super.key, required this.offerId});
  final String offerId;
  @override
  ConsumerState<RouteMapScreen> createState() => _RouteMapScreenState();
}

class _RouteMapScreenState extends ConsumerState<RouteMapScreen> {
  final _map = MapController();
  bool _ready = false, _userMoved = false, _locating = false;
  String? _selected, _fitSig;
  GeoPt? _me;

  @override
  void initState() {
    super.initState();
    _readPosition(ask: false);
  }

  @override
  void dispose() { _map.dispose(); super.dispose(); }

  /// The driver's own position. At open it is only read when location is already allowed (no permission dialog out of the blue); the locate button may ask.
  Future<void> _readPosition({required bool ask}) async {
    final loc = ref.read(locationServiceProvider);
    try {
      if (!await loc.hasPermission()) {
        if (!ask || !await loc.requestPermission()) { if (ask && mounted) toast(context, context.tr('fmb.map_no_gps'), error: true); return; }
      }
      final p = await loc.current();
      if (!mounted) return;
      if (p == null) { if (ask) toast(context, context.tr('fmb.map_no_gps'), error: true); return; }
      setState(() => _me = (lat: p.lat, lng: p.lng));
      if (ask && _ready) _map.move(ll.LatLng(p.lat, p.lng), math.max(_map.camera.zoom, 15));
    } catch (_) {
      if (ask && mounted) toast(context, context.tr('fmb.map_no_gps'), error: true);
    }
  }

  Future<void> _locate() async {
    if (_locating) return;
    setState(() => _locating = true);
    await _readPosition(ask: true);
    if (mounted) setState(() => _locating = false);
  }

  CameraFit? _fitFor(List<GeoPt> pts) => pts.isEmpty ? null : CameraFit.coordinates(coordinates: [for (final p in pts) _ll(p)], padding: const EdgeInsets.fromLTRB(44, 56, 44, 44), maxZoom: 16);

  void _fit(RouteMapModel m) {
    final f = _fitFor(m.fitPoints);
    if (f == null || !_ready) return;
    _userMoved = false;
    _map.fitCamera(f);
  }

  /// The camera follows the data (route lines arriving, a re-plan) until the driver pans or zooms by hand; "fit" gives control back.
  void _syncFit(RouteMapModel m) {
    final sig = m.fitPoints.map((p) => '${p.lat.toStringAsFixed(4)},${p.lng.toStringAsFixed(4)}').join('|');
    if (_fitSig == sig) return;
    final first = _fitSig == null;
    _fitSig = sig;
    if (first || _userMoved) return; // the first fit is the map's initialCameraFit
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted && !_userMoved) { final f = _fitFor(m.fitPoints); if (f != null && _ready) _map.fitCamera(f); } });
  }

  Future<void> _open(MapStop s, RouteMapModel m) async {
    setState(() => _selected = s.id);
    final p = s.point;
    if (p != null && _ready) _map.move(_ll(p), math.max(_map.camera.zoom, 14));
    await showModalBottomSheet<void>(
      context: context, useRootNavigator: true, isScrollControlled: true, showDragHandle: true,
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.88),
      builder: (_) => StopSheet(offerId: widget.offerId, stopId: s.id),
    );
  }

  void _refresh() { ref.invalidate(jobProvider(widget.offerId)); ref.invalidate(routeGeometryProvider(widget.offerId)); }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final job = ref.watch(jobProvider(widget.offerId));
    final geo = ref.watch(routeGeometryProvider(widget.offerId));
    return Scaffold(
      appBar: AppBar(title: Text(t('fmb.map_title')), actions: [IconButton(key: const Key('map-refresh'), tooltip: t('common.retry'), icon: const Icon(Icons.refresh), onPressed: _refresh)]),
      body: AsyncBody<Job>(value: job, onRetry: _refresh, builder: (j) {
        if (!j.manifest) return EmptyView(title: t('fmb.map_not_available'), icon: Icons.map_outlined);
        final model = RouteMapModel.build(j, geo.value, me: _me);
        if (model.stops.isEmpty) return EmptyView(title: t('fmb.map_no_stops'), icon: Icons.task_alt);
        _syncFit(model);
        return LayoutBuilder(builder: (context, box) {
          final mapH = model.hasMap ? (box.maxHeight * 0.5).clamp(180.0, 460.0) : 0.0;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (model.hasMap) SizedBox(height: mapH, child: _mapArea(context, model, geo)),
            Expanded(child: _StopList(model: model, job: j, selected: _selected, noMap: !model.hasMap, onOpen: (s) => _open(s, model))),
          ]);
        });
      }),
    );
  }

  Widget _mapArea(BuildContext context, RouteMapModel m, AsyncValue<RouteGeometry> geo) {
    final t = context.tr;
    final fit = _fitFor(m.fitPoints);
    final tiles = ref.watch(mapTileProviderProvider);
    final order = [for (final s in m.plotted) s]..sort((a, b) => (a.id == _selected ? 2 : a.current ? 1 : 0) - (b.id == _selected ? 2 : b.current ? 1 : 0));
    return Stack(children: [
      FlutterMap(
        key: const Key('route-map'), mapController: _map,
        options: MapOptions(
          initialCenter: fit == null ? _defaultCenter : _ll(m.fitPoints.first), initialZoom: 12, initialCameraFit: fit,
          minZoom: 3, maxZoom: 19, backgroundColor: const Color(0xFFE5E3DF),
          interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
          onMapReady: () { if (!_ready) { _ready = true; } },
          onPositionChanged: (_, hasGesture) { if (hasGesture) _userMoved = true; },
        ),
        children: [
          TileLayer(urlTemplate: mapTileUrl, userAgentPackageName: mapUserAgentPackage, tileProvider: tiles),
          PolylineLayer(polylines: [
            for (final l in m.lines) Polyline(points: [for (final p in l.points) _ll(p)], strokeWidth: 5, color: l.color, borderStrokeWidth: 1.5, borderColor: const Color(0xCC0B132B), pattern: l.dashed ? StrokePattern.dashed(segments: const [10, 8]) : const StrokePattern.solid()),
          ]),
          MarkerLayer(markers: [
            if (m.origin != null) Marker(point: _ll(m.origin!), width: 32, height: 32, rotate: true, child: Semantics(label: t('fmb.map_origin'), child: Container(key: const Key('map-origin'), decoration: BoxDecoration(color: JR.bg, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)), child: const Icon(Icons.warehouse_outlined, size: 16, color: JR.accent)))),
            if (_me != null) Marker(point: _ll(_me!), width: 28, height: 28, rotate: true, child: Semantics(label: t('fmb.map_you'), child: Container(key: const Key('map-me'), decoration: BoxDecoration(color: const Color(0xFF2563EB), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(color: Color(0x662563EB), blurRadius: 8, spreadRadius: 3)])))),
            for (final s in order) Marker(
              point: _ll(s.point!), width: 48, height: 48, rotate: true,
              child: GestureDetector(
                key: Key('map-marker-${s.id}'), behavior: HitTestBehavior.opaque, onTap: () => _open(s, m),
                child: Semantics(button: true, label: t('fmb.map_stop_aria', {'label': s.label, 'code': s.stop.code}), child: Center(child: StopDot(label: s.label, color: s.color, current: s.current, selected: s.id == _selected))),
              ),
            ),
          ]),
        ],
      ),
      PositionedDirectional(start: 8, bottom: 6, child: GestureDetector(
        key: const Key('map-attribution'), onTap: () => ref.read(linkOpenerProvider).open(_osmCopyright),
        child: Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3), decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)), child: Text(t('fmb.map_osm'), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 10.5, color: Color(0xFF1F2937)))),
      )),
      PositionedDirectional(end: 10, top: 10, child: Column(children: [
        _MapButton(key: const Key('map-locate'), icon: Icons.my_location, tooltip: t('fmb.map_locate'), busy: _locating, onPressed: _locate),
        const SizedBox(height: 8),
        _MapButton(key: const Key('map-fit'), icon: Icons.zoom_out_map, tooltip: t('fmb.map_fit'), onPressed: () => _fit(m)),
      ])),
      if (geo.isLoading) const Positioned(left: 0, right: 0, top: 0, child: LinearProgressIndicator(key: Key('map-geo-loading'), minHeight: 3, color: JR.accent, backgroundColor: Colors.transparent)),
      if (geo.hasError && !geo.isLoading) Positioned(left: 8, right: 64, top: 8, child: Material(
        key: const Key('map-geo-error'), color: JR.bg.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(10),
        child: Padding(padding: const EdgeInsetsDirectional.fromSTEB(10, 4, 4, 4), child: Row(children: [
          const Icon(Icons.sync_problem_outlined, size: 18, color: JR.gold), const SizedBox(width: 8),
          Expanded(child: Text(t('fmb.map_geo_failed'), style: const TextStyle(fontSize: 12.5, height: 1.25))),
          TextButton(style: TextButton.styleFrom(minimumSize: const Size(56, 40), padding: const EdgeInsets.symmetric(horizontal: 8)), onPressed: () => ref.invalidate(routeGeometryProvider(widget.offerId)), child: Text(t('common.retry'))),
        ])),
      )),
    ]);
  }
}

class _MapButton extends StatelessWidget {
  const _MapButton({super.key, required this.icon, required this.tooltip, required this.onPressed, this.busy = false});
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final bool busy;
  @override
  Widget build(BuildContext context) => Material(
        color: JR.bg.withValues(alpha: 0.92), shape: const CircleBorder(side: BorderSide(color: JR.line)), elevation: 2,
        child: IconButton(tooltip: tooltip, onPressed: busy ? null : onPressed, constraints: const BoxConstraints(minWidth: 48, minHeight: 48), icon: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accent)) : Icon(icon, color: JR.accent)),
      );
}

/// The round lettered marker (also used in the list and in the popup, so the three always match).
class StopDot extends StatelessWidget {
  const StopDot({super.key, required this.label, required this.color, this.current = false, this.selected = false, this.size = 34});
  final String label;
  final Color color;
  final bool current, selected;
  final double size;
  @override
  Widget build(BuildContext context) {
    final big = current || selected;
    final d = big ? size + 8 : size;
    return Container(
      width: d, height: d, alignment: Alignment.center,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle, border: Border.all(color: big ? Colors.white : JR.bg, width: big ? 3 : 2), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: big ? 8 : 4)]),
      // Letters are Latin even in Arabic/Urdu UIs; fixed size so a large system font cannot push them out of the circle.
      child: Text(label, textDirection: TextDirection.ltr, textScaler: TextScaler.noScaling, style: TextStyle(color: JR.accentInk, fontWeight: FontWeight.w800, fontSize: label.length > 2 ? 11 : 15, height: 1.1)),
    );
  }
}

/// "≈ 27 min · 20.2 km" (the driving leg into the stop); empty when the plan has no numbers for it.
String _legText(Strings t, MapStop s) {
  final time = s.durationS == null ? null : fmtTravel(t, s.durationS!), dist = s.distanceM == null ? null : fmtDist(t, s.distanceM!);
  if (time != null && dist != null) return t('fmb.map_leg', {'time': time, 'dist': dist});
  final one = time ?? dist;
  return one == null ? '' : t('fmb.map_leg_one', {'v': one});
}

class _StopList extends ConsumerWidget {
  const _StopList({required this.model, required this.job, required this.selected, required this.noMap, required this.onOpen});
  final RouteMapModel model;
  final Job job;
  final String? selected;
  final bool noMap;
  final void Function(MapStop) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final actions = ref.watch(mapStopActionsProvider);
    final dist = model.totalDistanceM, dur = model.totalDurationS;
    final summary = dist != null && dur != null ? t('fmb.map_summary', {'n': model.stops.length, 'dist': fmtDist(t, dist), 'time': fmtTravel(t, dur)}) : t('fmb.map_summary_n', {'n': model.stops.length});
    return ListView.separated(
      key: const Key('map-list'), padding: const EdgeInsets.fromLTRB(12, 10, 12, 20), itemCount: model.stops.length + 1,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        if (i == 0) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (noMap) Padding(padding: const EdgeInsets.only(bottom: 10), child: Banner2(key: const Key('map-empty'), tone: Tone.warn, text: t('fmb.map_no_coords'))),
            Row(children: [
              const Icon(Icons.alt_route, size: 20, color: JR.cyan), const SizedBox(width: 8),
              Expanded(child: Text(summary, key: const Key('map-summary'), style: const TextStyle(fontWeight: FontWeight.w800, height: 1.3))),
            ]),
            if (model.allEstimates) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('fmb.map_estimate'), key: const Key('map-estimate'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.35))),
          ]);
        }
        final s = model.stops[i - 1];
        return _StopRow(stop: s, selected: s.id == selected, onTap: () => onOpen(s), onNavigate: s.plotted ? () => actions.navigate(context, s.stop) : null);
      },
    );
  }
}

class _StopRow extends StatelessWidget {
  const _StopRow({required this.stop, required this.selected, required this.onTap, required this.onNavigate});
  final MapStop stop;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onNavigate;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final s = stop.stop;
    final leg = _legText(t, stop);
    final address = [s.address, if (s.city != null && s.city!.isNotEmpty) cityLabel(context, s.city)].where((e) => e.isNotEmpty).join(' · ');
    return Material(
      key: Key('map-row-${s.id}'), color: JR.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius), side: BorderSide(color: selected ? JR.accent : (s.current ? JR.cyan : JR.line), width: selected || s.current ? 1.5 : 1)),
      child: InkWell(
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius)), onTap: onTap,
        child: Padding(padding: const EdgeInsetsDirectional.fromSTEB(12, 10, 6, 10), child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          StopDot(label: stop.label, color: stop.color, current: s.current, size: 32),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(s.code.isEmpty ? t('um.parcel_n', {'n': s.seq}) : s.code, textDirection: TextDirection.ltr, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800))),
              if (s.current) ...[const SizedBox(width: 8), Flexible(child: Pill(t('fmb.map_current'), tone: Tone.success))],
            ]),
            if (address.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(address, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
            if (!stop.plotted) Padding(padding: const EdgeInsets.only(top: 4), child: Align(alignment: AlignmentDirectional.centerStart, child: Pill(t('rm.no_location'), key: Key('map-unlocated-${s.id}'), tone: Tone.warn)))
            else if (leg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(leg, key: Key('map-leg-${s.id}'), style: const TextStyle(color: JR.cyan, fontSize: 13, fontWeight: FontWeight.w600, height: 1.3))),
          ])),
          const SizedBox(width: 6),
          IconButton.filled(
            key: Key('map-nav-${s.id}'), tooltip: t('um.navigate'), onPressed: onNavigate, constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            style: IconButton.styleFrom(backgroundColor: JR.accent, foregroundColor: JR.accentInk, disabledBackgroundColor: JR.line), icon: const Icon(Icons.navigation),
          ),
        ])),
      ),
    );
  }
}

/// The popup of one stop: its main details and every quick action the server allows for it right now. It reads the job live, so after "I've arrived"
/// it turns into the delivery actions without being reopened, and it closes itself once the stop is done.
class StopSheet extends ConsumerStatefulWidget {
  const StopSheet({super.key, required this.offerId, required this.stopId});
  final String offerId, stopId;
  @override
  ConsumerState<StopSheet> createState() => _StopSheetState();
}

class _StopSheetState extends ConsumerState<StopSheet> {
  bool _busy = false;

  Future<void> _run(Future<bool> Function(MapStopActions a, Job j, Stop s) f) async {
    if (_busy) return;
    final job = ref.read(jobProvider(widget.offerId)).value;
    final stop = _find(job);
    if (job == null || stop == null) return;
    setState(() => _busy = true);
    try {
      final applied = await f(ref.read(mapStopActionsProvider), job, stop);
      if (!applied || !mounted) return;
      ref.invalidate(jobProvider(widget.offerId));
      ref.invalidate(routeGeometryProvider(widget.offerId));
      ref.invalidate(activeJobsProvider);
      ref.invalidate(overviewProvider);
      final fresh = await ref.read(jobProvider(widget.offerId).future);
      final after = _find(fresh);
      if (mounted && (after == null || after.status != 'loaded')) Navigator.of(context).pop(); // delivered / failed / removed: nothing left to do here
    } catch (_) {
      // the action already told the driver what went wrong
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Stop? _find(Job? j) { if (j == null) return null; for (final s in j.stops) { if (s.id == widget.stopId) return s; } return null; }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final job = ref.watch(jobProvider(widget.offerId)).value;
    final geo = ref.watch(routeGeometryProvider(widget.offerId)).value;
    final stop = _find(job);
    if (job == null || stop == null) return Padding(padding: const EdgeInsets.all(24), child: EmptyView(title: t('fmb.map_stop_done'), icon: Icons.task_alt));
    final model = RouteMapModel.build(job, geo);
    final ms = model.byId(stop.id);
    if (ms == null) return Padding(padding: const EdgeInsets.all(24), child: EmptyView(title: t('fmb.map_stop_done'), icon: Icons.task_alt));
    final allow = allowedStopActions(job, stop);
    final cod = stopCodCents(stop);
    final address = [stop.address, if (stop.city != null && stop.city!.isNotEmpty) cityLabel(context, stop.city)].where((e) => e.isNotEmpty).join(' · ');
    final leg = _legText(t, ms);
    Widget quick(Key k, IconData i, String label, VoidCallback f, {Color? color}) => Expanded(child: Material(key: k, color: JR.bg2, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: JR.line)), child: InkWell(
          customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), onTap: _busy ? null : f,
          child: Padding(padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4), child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(i, color: color ?? JR.cyan), const SizedBox(height: 4), Text(label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, height: 1.2))])),
        )));
    final quickTiles = <Widget>[
      if (allow.navigate) quick(const Key('sheet-navigate'), Icons.navigation_outlined, t('um.navigate'), () => ref.read(mapStopActionsProvider).navigate(context, stop)),
      if (allow.call) quick(const Key('sheet-call'), Icons.call, t('m.call'), () => ref.read(mapStopActionsProvider).call(context, stop)),
      if (allow.whatsapp) quick(const Key('sheet-whatsapp'), Icons.chat, t('ms.whatsapp'), () => ref.read(mapStopActionsProvider).whatsapp(context, ref, job, stop), color: JR.accent),
    ];
    final name = stop.recipientName, phone = stop.recipientPhone;
    return SafeArea(child: SingleChildScrollView(key: const Key('map-popup'), padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        StopDot(label: ms.label, color: ms.color, current: stop.current),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(stop.code.isEmpty ? t('um.parcel_n', {'n': stop.seq}) : stop.code, key: const Key('sheet-code'), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 6, children: [
            Pill(t.has('shipstatus.${stop.status}') ? t('shipstatus.${stop.status}') : stop.status, key: const Key('sheet-status'), tone: Tone.neutral),
            if (stop.current) Pill(t('fmb.map_current'), tone: Tone.success),
            if (stop.arrived) Pill(t('fmb.map_arrived'), key: const Key('sheet-arrived'), tone: Tone.info),
            if (!stop.located) Pill(t('rm.no_location'), tone: Tone.warn),
            if (stop.approximate) Pill(t('rm.approx_location'), tone: Tone.info),
          ]),
        ])),
      ]),
      const SizedBox(height: 14),
      if (address.isNotEmpty) _info(Icons.place_outlined, address, key: const Key('sheet-address')),
      if (leg.isNotEmpty) _info(Icons.directions_car_outlined, leg, key: const Key('sheet-leg'), color: JR.cyan),
      if (cod > 0) Padding(padding: const EdgeInsets.only(top: 6, bottom: 2), child: Container(
        key: const Key('sheet-cod'), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: JR.gold.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10), border: Border.all(color: JR.gold.withValues(alpha: 0.4))),
        child: Row(children: [
          const Icon(Icons.payments_outlined, color: JR.gold, size: 20), const SizedBox(width: 8),
          Expanded(child: Text(t('fmb.map_cash_due'), style: const TextStyle(fontWeight: FontWeight.w600))),
          const SizedBox(width: 8),
          Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerEnd, child: Text(fmtMoney(cod, lang), textDirection: TextDirection.ltr, style: const TextStyle(color: JR.gold, fontWeight: FontWeight.w800, fontSize: 17)))),
        ]),
      )),
      if (stop.contents != null && stop.contents!.isNotEmpty) _info(Icons.inventory_2_outlined, '${t('fmb.map_contents')}: ${stop.contents}', key: const Key('sheet-contents')),
      if (stop.notes != null && stop.notes!.isNotEmpty) _info(Icons.sticky_note_2_outlined, stop.notes!, key: const Key('sheet-notes'), color: JR.gold, strong: true),
      if ((name != null && name.isNotEmpty) || (phone != null && phone.isNotEmpty)) _info(Icons.person_outline, [if (name != null && name.isNotEmpty) name, if (phone != null && phone.isNotEmpty) phone].join(' · '), key: const Key('sheet-recipient'), ltr: true),
      if (quickTiles.isNotEmpty) ...[const SizedBox(height: 14), IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final (i, w) in quickTiles.indexed) ...[if (i > 0) const SizedBox(width: 8), w]]))],
      if (allow.arrive) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('sheet-arrive'), onPressed: _busy ? null : () => _run((a, j, s) => a.arrive(context, ref, j, s)), icon: busyIcon(_busy, Icons.my_location), label: Text(t('act.checkin')))],
      if (allow.deliver) ...[const SizedBox(height: 14), FilledButton.icon(key: const Key('sheet-deliver'), onPressed: _busy ? null : () => _run((a, j, s) => a.deliver(context, ref, j, s)), icon: busyIcon(_busy, Icons.check), label: Text(t('fmb.map_deliver')))],
      if (allow.cantDeliver) ...[const SizedBox(height: 10), OutlinedButton.icon(key: const Key('sheet-cant'), style: OutlinedButton.styleFrom(foregroundColor: JR.danger, side: const BorderSide(color: JR.danger), minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : () => _run((a, j, s) => a.cantDeliver(context, ref, j, s)), icon: const Icon(Icons.report_gmailerrorred), label: Text(t('ms.cant_deliver')))],
      if (allow.postpone) ...[const SizedBox(height: 8), OutlinedButton.icon(key: const Key('sheet-postpone'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : () => _run((a, j, s) => a.postpone(context, ref, j, s)), icon: const Icon(Icons.schedule), label: Text(t('ms.postpone')))],
      if (allow.makeNext) ...[const SizedBox(height: 10), OutlinedButton.icon(key: const Key('sheet-make-next'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : () => _run((a, j, s) => a.makeNext(context, ref, j, s)), icon: const Icon(Icons.vertical_align_top), label: Text(t('fmb.map_make_next'), textAlign: TextAlign.center))],
    ])));
  }

  Widget _info(IconData icon, String text, {Key? key, Color? color, bool strong = false, bool ltr = false}) => Padding(
        key: key, padding: const EdgeInsets.only(top: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 18, color: color ?? JR.muted)), const SizedBox(width: 8),
          Expanded(child: Text(text, textDirection: ltr ? TextDirection.ltr : null, style: TextStyle(color: color ?? JR.text, fontWeight: strong ? FontWeight.w600 : FontWeight.w400, height: 1.35))),
        ]),
      );
}
