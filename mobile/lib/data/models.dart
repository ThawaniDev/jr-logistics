import 'api_client.dart';

// ── tolerant readers ──
// The server adds fields over time (partnerId, partnerStatus, ...) and a field may be null/absent on older rows. Every getter below
// reads defensively: an unexpected type degrades to a default instead of throwing and blanking the whole screen.
String? _s(Object? v) => v is String ? v : (v is num || v is bool ? '$v' : null);
int? _i(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _d(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
Json? _m(Object? v) => v is Map ? v.cast<String, dynamic>() : null;

/// Server-driven driver job. `actions` decides which buttons the UI shows, so web and mobile never diverge.
class Job {
  Job(this.j);
  final Json j;
  String get offerId => _s(j['offerId']) ?? '';
  String get requestId => _s(j['requestId']) ?? '';
  String get ref => _s(j['ref']) ?? '';
  String get service => _s(j['service']) ?? 'delivery_driver';
  String get status => _s(j['status']) ?? 'accepted';
  String? get business => _s(j['business']);
  String? get vehicleType => _s(j['vehicleType']);
  String? get temperature => _s(j['temperature']);
  String get pickupCity => _s(j['pickupCity']) ?? '';
  String get deliveryCity => _s(j['deliveryCity']) ?? '';
  String get startsAt => _s(j['startsAt']) ?? '';
  int get expectedUnits => _i(j['expectedUnits']) ?? 0;
  int? get loadedUnits => _i(j['loadedUnits']);
  int? get deliveredUnits => _i(j['deliveredUnits']);
  int? get finalUnits => _i(j['finalUnits']);
  int? get expectedEarningCents => _i(j['expectedEarningCents']);
  bool get earningHidden => j['earningHidden'] == true;
  bool get isReplacement => j['isReplacement'] == true;
  bool get isDelivery => service == 'delivery_driver';
  List<String> get actions { final a = j['actions']; return a is List ? [for (final e in a) if (e is String) e] : const []; }
  bool can(String a) => actions.contains(a);
  String? get contents => _s(j['contents']);
  String? get notes => _s(j['notes']);
  String? get cancelReason => _s(j['cancelReason']);
  Json? get pickup => _m(j['pickup']);
  Json? get delivery => _m(j['delivery']);
  Json? get recipient => _m(j['recipient']);
  String? get deliveryAddress => _s(delivery?['address']);
  double? get deliveryLat => _d(delivery?['lat']);
  double? get deliveryLng => _d(delivery?['lng']);
  /// Per-parcel job: the server sends one stop per parcel (`stops`) and no single delivery/recipient. Older payloads omit all of this.
  bool get manifest => j['manifest'] == true;
  bool get allowPartial => j['allowPartial'] != false; // default true (older payloads)
  String? get routeApprovedAt => _s(j['routeApprovedAt']);
  bool get routeApproved => routeApprovedAt != null;
  /// The planned best route (Google Routes, or a labelled local estimate). Null for legacy jobs and for servers that do not send it yet.
  RoutePlanInfo? get route { final m = _m(j['route']); return m == null ? null : RoutePlanInfo(m); }
  StopsSummary get stopsSummary => StopsSummary(_m(j['stopsSummary']) ?? const {});
  /// Effective warehouse switches (arrival confirmation, loading record, delivery code, signature). Old servers omit them: defaults = the old flow.
  JobOps get ops => JobOps(_m(j['ops']) ?? const {});
  /// Arrival geofence (E1). Absent on old servers: nothing is enforced.
  JobArrival get arrival => JobArrival(_m(j['arrival']) ?? const {});
  /// How the parcels get onto the vehicle (E3): the driver scans them (`driver_scan`) or the warehouse records them (`warehouse`).
  JobLoading get loading => JobLoading(_m(j['loading']));
  /// Platform rules the UI must follow (reorder, reschedule evidence, door timer, strict failure reasons). Null on old servers.
  JobPolicy? get policy { final m = _m(j['policy']); return m == null ? null : JobPolicy(m); }
  /// Cash on delivery summary for the stat cards (manifest jobs). Null when the server does not send it.
  JobCod? get cod { final m = _m(j['cod']); return m == null ? null : JobCod(m); }
  /// Loading by scanning is open: attendance is confirmed, the route is not approved and the driver has not finished loading yet.
  bool get inScanLoading => status == 'attendance_confirmed' && !routeApproved && (can('scan_loading') || can('finish_loading') || (loading.isScan && !loading.finished && !can('approve_route')));
  /// Show the "wait at the door" timer? Only when the platform wants one (`stopWaitMin > 0`); an old server without `policy` always had it.
  bool get showsStopWait => policy == null ? true : (policy!.stopWaitMin ?? 0) > 0;
  /// Failure reasons are gated (arrival, wait, note) only when the platform says so; an old server without `policy` enforced them.
  bool get failStrict => policy?.failStrict ?? true;
  /// A stop-order change is welcome in the UI (the route says so).
  bool get canReorder => route?.canReorder == true;
  List<Stop> get stops {
    final raw = j['stops'];
    if (raw is! List) return const [];
    return [for (final e in raw) if (e is Map && e['id'] != null) Stop(e.cast<String, dynamic>())];
  }
  Stop? get currentStop { for (final s in stops) { if (s.current) return s; } return null; }
  /// Parcels the warehouse handed over (shown while the driver confirms the count).
  int get handedOverCount => loadedUnits ?? (stopsSummary.total - stopsSummary.pending);
  bool get isActive => const ['accepted', 'arrived', 'attendance_confirmed', 'delivered_reported', 'qty_disputed', 'pending_settlement'].contains(status);
  /// Same ceiling the server enforces on a delivered quantity: min(loaded, booked).
  int get maxBillable => (loadedUnits ?? expectedUnits) < expectedUnits ? (loadedUnits ?? expectedUnits) : expectedUnits;
  bool get loadingDisputed => status == 'attendance_confirmed' && j['loadedAckByDriver'] == false;
  bool get awaitingLoadingAck => status == 'attendance_confirmed' && loadedUnits != null && j['loadedAckByDriver'] == null;
}

/// `ops` on the job view: the warehouse's effective switches (platform default overridden per warehouse).
class JobOps {
  JobOps(this.j);
  final Json j;
  bool get requireArrivalConfirmation => j['requireArrivalConfirmation'] != false;
  bool get requireLoadingRecord => j['requireLoadingRecord'] == true;
  bool get requireDeliveryOtp => j['requireDeliveryOtp'] != false;
  bool get requireSignature => j['requireSignature'] == true;
}

/// `arrival` on the job view: the warehouse geofence for "I've arrived at the warehouse".
class JobArrival {
  JobArrival(this.j);
  final Json j;
  bool get geofence => j['geofence'] == true;
  int get radiusM => _i(j['radiusM']) ?? 200;
  Json? get _w => _m(j['warehouse']);
  double? get warehouseLat => _d(_w?['lat']);
  double? get warehouseLng => _d(_w?['lng']);
  bool get hasWarehouse => warehouseLat != null && warehouseLng != null;
  /// GPS is mandatory for the check-in (geofence on AND the warehouse pin known); otherwise the server does not enforce it.
  bool get enforced => geofence && hasWarehouse;
}

/// `loading` on the job view.
class JobLoading {
  JobLoading(this.j);
  final Json? j;
  /// `driver_scan` | `warehouse`. Old servers send nothing: the warehouse records the loading.
  String get mode => _s(j?['mode']) ?? 'warehouse';
  bool get isScan => mode == 'driver_scan';
  int get assigned => _i(j?['assigned']) ?? 0;
  int get scanned => _i(j?['scanned']) ?? 0;
  bool get finished => j?['finished'] == true;
}

/// `policy` on the job view.
class JobPolicy {
  JobPolicy(this.j);
  final Json j;
  bool get canReorderRoute => j['canReorderRoute'] != false;
  bool get rescheduleEvidenceText => j['rescheduleEvidenceText'] != false;
  bool get rescheduleEvidencePhoto => j['rescheduleEvidencePhoto'] != false;
  /// Minutes to wait at the door; 0 = no timer.
  int? get stopWaitMin => _i(j['stopWaitMin']);
  bool get failStrict => j['failStrict'] == true;
}

/// `cod` on the job view (halalas).
class JobCod {
  JobCod(this.j);
  final Json j;
  int get toCollectCents => _i(j['toCollectCents']) ?? 0;
  int get collectedCents => _i(j['collectedCents']) ?? 0;
  int get parcels => _i(j['parcels']) ?? 0;
  bool get any => parcels > 0 || toCollectCents > 0 || collectedCents > 0;
}

/// Answer of `POST /offers/:id/loading/scan`.
class LoadingScanResult {
  LoadingScanResult(this.j);
  final Json j;
  Json? get _sh => _m(j['shipment']);
  String get shipmentId => _s(_sh?['id']) ?? '';
  String get code => _s(_sh?['code']) ?? '';
  int? get seq => _i(_sh?['seq']);
  int? get scanned => _i(j['scanned']);
  int? get assigned => _i(j['assigned']);
  /// This parcel was scanned before: nothing changed.
  bool get already => j['already'] == true;
}

/// Answer of `POST /offers/:id/loading/finish`.
class LoadingFinishResult {
  LoadingFinishResult(this.j);
  final Json j;
  int get loaded => _i(j['loaded']) ?? 0;
  /// Unscanned parcels that went back to the warehouse pool.
  int get released => _i(j['released']) ?? 0;
  Job? get job { final m = _m(j['job']); return m == null ? null : Job(m); }
}

class Overview {
  Overview(this.j);
  final Json j;
  String get availability => _s(j['availability']) ?? 'unavailable';
  bool get available => availability == 'available';
  String get verification => _s(j['verificationStatus']) ?? 'pending';
  bool get verified => verification == 'verified';
  String? get suspendedUntil => _s(j['suspendedUntil']);
  bool get suspended { final d = suspendedUntil == null ? null : DateTime.tryParse(suspendedUntil!); return d != null && d.isAfter(DateTime.now()); }
  int get newOffers => _i(j['newOffers']) ?? 0;
  int get activeJobs => _i(j['activeJobs']) ?? 0;
  int get jobsCompleted => _i(j['jobsCompleted']) ?? 0;
  num? get rating => j['rating'] is num ? j['rating'] as num : null;
  bool get officeLinked => j['officeLinked'] == true;
  int get availableCents => _i(_m(j['wallet'])?['availableCents']) ?? 0;
  int get pendingCents => _i(_m(j['wallet'])?['pendingCents']) ?? 0;
  int get heldCents => _i(_m(j['wallet'])?['heldCents']) ?? 0;
}

class StopsSummary {
  StopsSummary(this.j);
  final Json j;
  int _n(String k) => _i(j[k]) ?? 0;
  int get total => _n('total');
  int get pending => _n('pending');
  /// Still on the vehicle = stops left to work.
  int get loaded => _n('loaded');
  int get delivered => _n('delivered');
  int get failed => _n('failed');
  int get returned => _n('returned');
  int get missing => _n('missing');
  /// Stops that are no longer open: delivered or failed (and what happened after).
  int get done => delivered + failed + returned + missing;
  int get notDelivered => failed + returned + missing;
}

/// One parcel/stop of a per-parcel job, as the driver sees it. Name/phone are only present for the current (or a finished) stop.
class Stop {
  Stop(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  int get seq => _i(j['seq']) ?? 0;
  int get stopOrder => _i(j['stopOrder']) ?? seq;
  String get code => _s(j['code']) ?? '';
  String get status => _s(j['status']) ?? 'loaded';
  String get recipientType => _s(j['recipientType']) ?? 'consumer';
  bool get isBusiness => recipientType == 'business';
  String get address => _s(j['address']) ?? '';
  String? get city => _s(j['city']);
  double? get lat => _d(j['lat']);
  double? get lng => _d(j['lng']);
  /// Has a map position. Older payloads have no `located`: then it is simply "has coordinates".
  bool get located => j['located'] is bool ? j['located'] == true : (lat != null && lng != null);
  /// Where the position came from: `given` (typed/pinned by the business), `geocoded`, `geocoded_approx` (only roughly found from the address) or null.
  String? get geoSource => _s(j['geoSource']);
  bool get approximate => geoSource == 'geocoded_approx';
  /// The driving leg INTO this stop from the previous one (or from the start of the route), in metres / seconds.
  int? get legDistanceM => _i(j['legDistanceM']);
  int? get legDurationS => _i(j['legDurationS']);
  bool get hasLeg => (legDistanceM ?? 0) > 0 || (legDurationS ?? 0) > 0;
  String? get contents => _s(j['contents']);
  String? get notes => _s(j['notes']);
  String? get recipientName => _s(j['recipientName']);
  String? get recipientPhone => _s(j['recipientPhone']);
  bool get current => j['current'] == true;
  int get attempts => _i(j['attempts']) ?? 0;
  int get deferCount => _i(j['deferCount']) ?? 0;
  bool get canDefer => j['canDefer'] == true;
  String? get arrivedAt => _s(j['arrivedAt']);
  bool get arrived => arrivedAt != null;
  int? get waitRemainingSec => _i(j['waitRemainingSec']);
  /// 'code' (consumers) or 'code_or_receipt' (businesses may prove receipt with a signed/stamped photo).
  String get proofMode => _s(j['proofMode']) ?? 'code';
  bool get allowsReceipt => proofMode == 'code_or_receipt';
  bool get hasProof => j['hasProof'] == true;
  int get otpAttemptsLeft => _i(j['otpAttemptsLeft']) ?? 5;
  bool get canResend => j['canResend'] != false;
  String? get failReason => _s(j['failReason']);
  String? get failNote => _s(j['failNote']);
  bool get open => status == 'loaded' || status == 'pending';
  bool get resolved => !open;
  String? get deliveredAt => _s(j['deliveredAt']);
  /// The warehouse wants the recipient's 4-digit code (default; `false` = the scanned/typed parcel code is the proof, `proofMode == 'scan'`).
  bool get needsOtp => j['needsOtp'] is bool ? j['needsOtp'] == true : proofMode != 'scan';
  /// The recipient must sign on the screen (a signature picture is uploaded first).
  bool get needsSignature => j['needsSignature'] == true;
  /// Cash on delivery: halalas the driver must collect at the door (0 = none) and what was already collected.
  int get codCents => _i(j['codCents']) ?? 0;
  int get codCollectedCents => _i(j['codCollectedCents']) ?? 0;
  bool get hasCod => codCents > 0;
  /// Scanned onto the vehicle (scan-mode checklist): `loaded`; `pending` = not scanned yet.
  bool get scanned => status == 'loaded';
  /// Parcel codes the driver may type for this stop: the parcel code, plus the order reference / manifest number when the server sends them.
  bool matches(String q) {
    final n = q.trim().toLowerCase();
    if (n.isEmpty) return true;
    for (final v in [code, _s(j['externalRef']), _s(j['orderRef']), _s(j['manifestNumber']), address, recipientName]) { if (v != null && v.toLowerCase().contains(n)) return true; }
    return false;
  }
}

/// One planner warning: the server sends `CODE` or `CODE:param` (e.g. `ROUTE_UNLOCATED_STOPS:3`).
/// The text after the colon is a number for most codes but raw provider detail for `ROUTING_PROVIDER_FAILED` — it is never shown to the driver.
class RouteWarning {
  const RouteWarning(this.code, [this.param]);
  final String code;
  final String? param;
  factory RouteWarning.parse(String raw) {
    final i = raw.indexOf(':');
    final code = (i < 0 ? raw : raw.substring(0, i)).trim();
    final p = i < 0 ? '' : raw.substring(i + 1).trim();
    return RouteWarning(code, p.isEmpty ? null : p);
  }
  /// The numeric parameter, when it is one.
  int? get count => int.tryParse(param ?? '');
}

/// The server's best-route plan for one job (`route` on the driver job view). Every field is optional: a missing/odd value degrades, never throws.
class RoutePlanInfo {
  RoutePlanInfo(this.j);
  final Json j;
  bool get planned => j['planned'] == true;
  /// `google_routes` | `local_heuristic` | `mixed` | null (not planned yet).
  String? get provider => _s(j['provider']);
  bool get isGoogle => provider == 'google_routes';
  String? get plannedAt => _s(j['plannedAt']);
  /// `system` (planned after hand-over) or `driver` (re-optimised by the driver).
  String? get by => _s(j['by']);
  int? get totalDistanceM => _i(j['totalDistanceM']);
  int? get totalDurationS => _i(j['totalDurationS']);
  int? get remainingDistanceM => _i(j['remainingDistanceM']);
  int? get remainingDurationS => _i(j['remainingDurationS']);
  int get chunks => _i(j['chunks']) ?? 0;
  int get unlocated => _i(j['unlocated']) ?? 0;
  int get approximate => _i(j['approximate']) ?? 0;
  List<RouteWarning> get warnings { final w = j['warnings']; return w is List ? [for (final e in w) if (e is String && e.trim().isNotEmpty) RouteWarning.parse(e)] : const []; }
  bool get googleConfigured => j['googleConfigured'] == true;
  /// The driver may (re-)plan now: after confirming the count, while at least two stops are still on board.
  bool get canOptimize => j['canOptimize'] == true;
  /// The driver may re-order the remaining stops by hand now (setting on, loading finished, at least two movable stops).
  bool get canReorder => j['canReorder'] == true;
  /// The current order was set by the driver (`provider` is then `manual`).
  bool get manual => j['manual'] == true || provider == 'manual';
}

/// Answer of `POST /offers/:id/route/optimize`.
class RouteOptimizeResult {
  RouteOptimizeResult(this.j);
  final Json j;
  /// Same inputs as the last plan: nothing was recomputed (and no paid provider call was made).
  bool get cached => j['cached'] == true;
  /// The visiting order is different now.
  bool get changed => j['changed'] == true;
  String? get currentId => _s(j['currentId']);
  Json? get plan => _m(j['plan']);
  /// The fresh job view, when the server sends it.
  Job? get job { final m = _m(j['job']); return m == null ? null : Job(m); }
}

/// Why a driver cannot deliver a stop, and what the server requires for it (mirrors web/src/server/stops.ts).
class FailReason {
  const FailReason(this.key, {this.needsArrival = true, this.needsNote = false});
  final String key;
  final bool needsArrival, needsNote;
}

const failReasons = [
  FailReason('unreachable'), FailReason('refused'), FailReason('closed'), FailReason('no_otp'), FailReason('gate_access'),
  FailReason('damaged', needsNote: true),
  FailReason('wrong_address', needsArrival: false, needsNote: true), FailReason('out_of_zone', needsArrival: false), FailReason('other', needsArrival: false, needsNote: true),
];
