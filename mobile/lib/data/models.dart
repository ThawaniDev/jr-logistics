import 'api_client.dart';

/// Server-driven driver job. `actions` decides which buttons the UI shows, so web and mobile never diverge.
class Job {
  Job(this.j);
  final Json j;
  String get offerId => j['offerId'] as String;
  String get requestId => j['requestId'] as String;
  String get ref => j['ref'] as String;
  String get service => j['service'] as String;
  String get status => j['status'] as String;
  String? get business => j['business'] as String?;
  String? get vehicleType => j['vehicleType'] as String?;
  String? get temperature => j['temperature'] as String?;
  String get pickupCity => j['pickupCity'] as String;
  String get deliveryCity => j['deliveryCity'] as String;
  String get startsAt => j['startsAt'] as String;
  int get expectedUnits => (j['expectedUnits'] as num).toInt();
  int? get loadedUnits => (j['loadedUnits'] as num?)?.toInt();
  int? get deliveredUnits => (j['deliveredUnits'] as num?)?.toInt();
  int? get finalUnits => (j['finalUnits'] as num?)?.toInt();
  int? get expectedEarningCents => (j['expectedEarningCents'] as num?)?.toInt();
  bool get earningHidden => j['earningHidden'] == true;
  bool get isReplacement => j['isReplacement'] == true;
  bool get isDelivery => service == 'delivery_driver';
  List<String> get actions => (j['actions'] as List? ?? const []).cast<String>();
  bool can(String a) => actions.contains(a);
  String? get contents => j['contents'] as String?;
  String? get notes => j['notes'] as String?;
  Json? get pickup => (j['pickup'] as Map?)?.cast<String, dynamic>();
  Json? get delivery => (j['delivery'] as Map?)?.cast<String, dynamic>();
  Json? get recipient => (j['recipient'] as Map?)?.cast<String, dynamic>();
  String? get deliveryAddress => delivery?['address'] as String?;
  double? get deliveryLat => (delivery?['lat'] as num?)?.toDouble();
  double? get deliveryLng => (delivery?['lng'] as num?)?.toDouble();
  bool get isActive => const ['accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'qty_disputed', 'pending_settlement'].contains(status);
  bool get awaitingLoadingAck => status == 'attendance_confirmed' && loadedUnits != null && j['loadedAckByDriver'] == null;
}

class Overview {
  Overview(this.j);
  final Json j;
  String get availability => j['availability'] as String? ?? 'unavailable';
  bool get available => availability == 'available';
  String get verification => j['verificationStatus'] as String? ?? 'pending';
  bool get verified => verification == 'verified';
  String? get suspendedUntil => j['suspendedUntil'] as String?;
  bool get suspended => suspendedUntil != null && DateTime.parse(suspendedUntil!).isAfter(DateTime.now());
  int get newOffers => (j['newOffers'] as num?)?.toInt() ?? 0;
  int get activeJobs => (j['activeJobs'] as num?)?.toInt() ?? 0;
  int get jobsCompleted => (j['jobsCompleted'] as num?)?.toInt() ?? 0;
  num? get rating => j['rating'] as num?;
  bool get officeLinked => j['officeLinked'] == true;
  int get availableCents => ((j['wallet'] as Map)['availableCents'] as num).toInt();
  int get pendingCents => ((j['wallet'] as Map)['pendingCents'] as num).toInt();
  int get heldCents => ((j['wallet'] as Map)['heldCents'] as num).toInt();
}

class RouteLeg {
  RouteLeg(this.from, this.to, this.distanceM, this.durationS);
  final String from, to;
  final num distanceM, durationS;
}

class RoutePlan {
  RoutePlan(this.j);
  final Json j;
  String get provider => j['provider'] as String;
  bool get isGoogle => provider == 'google_routes';
  String? get warning => j['warning'] as String?;
  List<String> get order => (j['order'] as List).cast<String>();
  num get totalDistanceM => j['totalDistanceM'] as num;
  num get totalDurationS => j['totalDurationS'] as num;
  List<RouteLeg> get legs => (j['legs'] as List).map((l) => RouteLeg((l as Map)['from'] as String, l['to'] as String, l['distanceM'] as num, l['durationS'] as num)).toList();
}

/// Builds a Google Maps directions URL for stops in the order the driver reviewed.
/// Each stop is "lat,lng" or a free-text address.
Uri googleMapsDirections(List<String> stops) {
  assert(stops.isNotEmpty);
  final mids = stops.take(stops.length - 1).join('|');
  return Uri.https('www.google.com', '/maps/dir/', {
    'api': '1', 'destination': stops.last, 'travelmode': 'driving',
    if (mids.isNotEmpty) 'waypoints': mids,
  });
}
