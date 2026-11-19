import '../../data/models.dart';

/// Manual route order (E5) — which stops the driver may move and what the server expects.
///
/// `POST /offers/:id/route/reorder {order}` takes exactly the not-yet-resolved, not-pinned stops. The stop the driver has already arrived at is pinned
/// first and is not part of `order`.

/// Stops that can be moved: still open and not the one the driver stands at.
List<Stop> movableStops(Job job) => [for (final s in job.stops) if (s.open && !(s.current && s.arrived)) s];

/// The order after moving [id] to the front of [stops] (everything else keeps its relative order). Null when [id] is not in the list.
List<String>? orderWithFirst(List<Stop> stops, String id) {
  if (!stops.any((s) => s.id == id)) return null;
  return [id, for (final s in stops) if (s.id != id) s.id];
}

/// "Make next" is meaningful: the platform allows re-ordering and [stop] is a movable stop that is not already the next one.
bool canMakeNext(Job job, Stop stop) {
  if (!job.canReorder || !stop.open) return false;
  final m = movableStops(job);
  return m.length >= 2 && m.first.id != stop.id && m.any((s) => s.id == stop.id);
}

/// Moves item [from] to position [to] the way `ReorderableListView.onReorder` reports it (the new index is counted BEFORE the item is removed).
List<T> moveItem<T>(List<T> items, int from, int to) {
  final out = List<T>.of(items);
  if (from < 0 || from >= out.length) return out;
  var target = to;
  if (target > from) target -= 1;
  target = target.clamp(0, out.length - 1);
  final it = out.removeAt(from);
  out.insert(target, it);
  return out;
}
