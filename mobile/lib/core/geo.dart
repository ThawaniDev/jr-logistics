import 'dart:math' as math;

/// Great-circle distance between two WGS84 points in metres (haversine). Accurate to well under a metre per kilometre — plenty for a
/// "you are 340 m from the warehouse" read-out; the server does the authoritative check.
double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371008.8; // mean Earth radius
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  final a = math.pow(math.sin(dLat / 2), 2) + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * r * math.asin(math.min(1, math.sqrt(a)));
}
