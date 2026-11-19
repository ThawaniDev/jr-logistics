import '../data/models.dart';

/// A Google Maps directions link takes only a handful of waypoints; 9 stops (8 waypoints + the destination) is safely inside the limit of every client.
const maxMapsStops = 9;

/// [uri] = the directions link · [shown] = stops it contains · [located] = remaining stops that have a map position (so `located > shown` means "the next 9 of N")
/// · [skipped] = remaining stops left out because they have no usable position.
typedef MapsRoute = ({Uri uri, int shown, int located, int skipped});

bool _validPoint(double? lat, double? lng) => lat != null && lng != null && lat.isFinite && lng.isFinite && lat.abs() <= 90 && lng.abs() <= 180;

/// "Open route in Google Maps": a Directions URL for the NEXT [maxMapsStops] stops still to visit, in route order. The origin is left out so Maps
/// starts from the driver's current location. Stops that were delivered/failed or have no coordinates are skipped. Null when nothing can be opened.
MapsRoute? googleMapsRoute(Iterable<Stop> stops) {
  final remaining = [for (final s in stops) if (s.open) s];
  final located = [for (final s in remaining) if (_validPoint(s.lat, s.lng)) s];
  if (located.isEmpty) return null;
  final next = located.take(maxMapsStops).toList();
  String pt(Stop s) => '${s.lat!.toStringAsFixed(6)},${s.lng!.toStringAsFixed(6)}';
  final via = next.sublist(0, next.length - 1);
  final url = StringBuffer('https://www.google.com/maps/dir/?api=1&destination=${pt(next.last)}');
  if (via.isNotEmpty) url.write('&waypoints=${via.map(pt).join('%7C')}'); // "|" must be percent-encoded
  url.write('&travelmode=driving');
  return (uri: Uri.parse(url.toString()), shown: next.length, located: located.length, skipped: remaining.length - located.length);
}
