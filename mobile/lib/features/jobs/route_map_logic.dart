import 'package:flutter/painting.dart' show Color;
import '../../data/models.dart';
import '../../data/models_extra.dart';

/// Pure logic of the route map (E6): which stops are drawn, in which order, with which letter and colour, which lines connect them, and which
/// quick actions the popup of a stop may offer. No widgets here, so all of it is unit-tested.

/// Leg / marker colours, cycled per leg. All light enough for the dark ink on the markers, distinct from the map's own greens and blues.
const legPalette = [Color(0xFF00C5D5), Color(0xFF05E5A3), Color(0xFFF59E0B), Color(0xFFA78BFA), Color(0xFFF472B6), Color(0xFF60A5FA)];
Color legColor(int index) => legPalette[index % legPalette.length];

/// Marker label by position: A, B, … Z, then 27, 28, … (a route with more than 26 stops left switches to numbers rather than "AA").
String stopLabel(int index) => index < 26 ? String.fromCharCode(65 + index) : '${index + 1}';

/// A stop still to do, as the map shows it.
class MapStop {
  MapStop({required this.stop, required this.index, required this.color, this.leg});
  final Stop stop;
  /// Position among the stops still to do (0 = first), in route order.
  final int index;
  final Color color;
  /// The driving leg into this stop from the route geometry, when there is one.
  final RouteLeg? leg;

  String get label => stopLabel(index);
  String get id => stop.id;
  bool get current => stop.current;
  /// Has a usable map position (listed even when it has not — then it is simply not drawn).
  bool get plotted => stop.located && validGeo(stop.lat, stop.lng);
  GeoPt? get point => plotted ? (lat: stop.lat!, lng: stop.lng!) : null;
  int? get distanceM => (leg?.distanceM ?? 0) > 0 ? leg!.distanceM : ((stop.legDistanceM ?? 0) > 0 ? stop.legDistanceM : null);
  int? get durationS => (leg?.durationS ?? 0) > 0 ? leg!.durationS : ((stop.legDurationS ?? 0) > 0 ? stop.legDurationS : null);
}

class MapLine {
  const MapLine({required this.points, required this.color, required this.dashed, this.stopId});
  final List<GeoPt> points;
  final Color color;
  /// A straight-line estimate (no road geometry) is dashed.
  final bool dashed;
  final String? stopId;
}

class RouteMapModel {
  RouteMapModel({required this.stops, required this.lines, this.origin, this.totalDistanceM, this.totalDurationS, required this.fitPoints});
  final List<MapStop> stops;
  final List<MapLine> lines;
  final GeoPt? origin;
  /// What is left of the route (from the plan, else the sum of the legs); null when unknown.
  final int? totalDistanceM, totalDurationS;
  /// Everything the camera should be able to see: the stops, the start, the lines (and the driver, when known).
  final List<GeoPt> fitPoints;

  List<MapStop> get plotted => [for (final s in stops) if (s.plotted) s];
  List<MapStop> get unplotted => [for (final s in stops) if (!s.plotted) s];
  bool get hasMap => plotted.isNotEmpty;
  bool get allEstimates => lines.isNotEmpty && lines.every((l) => l.dashed);
  MapStop? byId(String id) { for (final s in stops) { if (s.id == id) return s; } return null; }

  /// [geo] may be null (not loaded / failed): the map then connects the stops with straight dashed lines. [me] = the driver's position, when known.
  static RouteMapModel build(Job job, RouteGeometry? geo, {GeoPt? me}) {
    final todo = [for (final s in job.stops) if (s.status == 'loaded') s]..sort((a, b) { final c = a.stopOrder.compareTo(b.stopOrder); return c != 0 ? c : a.seq.compareTo(b.seq); });
    final stops = [for (final (i, s) in todo.indexed) MapStop(stop: s, index: i, color: legColor(i), leg: geo?.legFor(s.id))];
    final byId = {for (final s in stops) s.id: s};
    final origin = geo?.origin;

    final lines = <MapLine>[];
    if (geo != null && geo.hasLines) {
      for (final (i, l) in geo.legs.indexed) {
        final pts = l.linePoints;
        if (pts.length < 2) continue;
        lines.add(MapLine(points: pts, color: byId[l.stopId]?.color ?? legColor(i), dashed: l.isEstimate, stopId: l.stopId));
      }
    } else {
      // No geometry (not loaded yet, failed, or an old server): straight dashed lines start → stop 1 → stop 2 …, so the map still shows the order.
      GeoPt? prev = origin;
      for (final s in stops) {
        final p = s.point;
        if (p == null) continue;
        if (prev != null) lines.add(MapLine(points: [prev, p], color: s.color, dashed: true, stopId: s.id));
        prev = p;
      }
    }

    final dist = job.route?.remainingDistanceM, dur = job.route?.remainingDurationS;
    int sum(int? Function(MapStop) f) { var t = 0; for (final s in stops) { t += f(s) ?? 0; } return t; }
    final sumD = sum((s) => s.distanceM), sumT = sum((s) => s.durationS);
    final fit = <GeoPt>[
      for (final s in stops) ?s.point,
      ?origin,
      ?me,
      for (final l in lines) ...l.points,
    ];
    return RouteMapModel(
      stops: stops, lines: lines, origin: origin,
      totalDistanceM: (dist ?? 0) > 0 ? dist : (sumD > 0 ? sumD : null), totalDurationS: (dur ?? 0) > 0 ? dur : (sumT > 0 ? sumT : null),
      fitPoints: fit,
    );
  }
}

/// Which quick actions the popup of a stop offers. Everything follows what the server allows: stop actions only while the job's `actions[]` has
/// `work_stops`, and call / WhatsApp / arrive / deliver / can't deliver / postpone only on the CURRENT stop. "Make next" is for any other stop that is
/// still to do, when the server says the order may be changed (`route.canReorder`).
class StopActionSet {
  const StopActionSet({this.navigate = false, this.call = false, this.whatsapp = false, this.arrive = false, this.deliver = false, this.cantDeliver = false, this.postpone = false, this.makeNext = false});
  final bool navigate, call, whatsapp, arrive, deliver, cantDeliver, postpone, makeNext;
  bool get any => navigate || call || whatsapp || arrive || deliver || cantDeliver || postpone || makeNext;
}

bool canReorderRoute(Job job) => job.route?.j['canReorder'] == true;

StopActionSet allowedStopActions(Job job, Stop s) {
  final work = job.can('work_stops');
  final cur = work && s.current && s.status == 'loaded';
  final phone = s.recipientPhone;
  return StopActionSet(
    navigate: s.located && validGeo(s.lat, s.lng),
    call: cur && phone != null && phone.trim().isNotEmpty,
    whatsapp: cur,
    arrive: cur && !s.arrived,
    deliver: cur && s.arrived,
    cantDeliver: cur,
    postpone: cur && s.canDefer,
    makeNext: work && !s.current && s.status == 'loaded' && !s.arrived && canReorderRoute(job),
  );
}

/// The COD amount of a stop (`codCents` of the stop view, E.4), 0 when none.
int stopCodCents(Stop s) { final v = s.j['codCents']; return v is num ? v.toInt() : 0; }
