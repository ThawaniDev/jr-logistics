import 'api_client.dart' show Json;

// ── tolerant readers (same rule as models.dart: an odd/missing field degrades to a default, it never throws) ──
String? _s(Object? v) => v is String ? v : (v is num || v is bool ? '$v' : null);
int? _i(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _d(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
Json? _m(Object? v) => v is Map ? v.cast<String, dynamic>() : null;
List<Json> _list(Object? v) => v is List ? [for (final e in v) if (e is Map) e.cast<String, dynamic>()] : const [];

/// A plain map position (no map library needed, so everything here is unit-testable without Flutter).
typedef GeoPt = ({double lat, double lng});

bool validGeo(double? lat, double? lng) => lat != null && lng != null && lat.isFinite && lng.isFinite && lat.abs() <= 90 && lng.abs() <= 180;

GeoPt? _pt(Object? v) {
  final m = _m(v);
  if (m == null) return null;
  final lat = _d(m['lat']), lng = _d(m['lng']);
  return validGeo(lat, lng) ? (lat: lat!, lng: lng!) : null;
}

/// Decodes a Google *encoded polyline* (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
/// [precision] 5 = the standard (Google Routes), 6 = the "polyline6" variant.
///
/// Anything malformed — a character outside the alphabet, a value cut off in the middle, or a point outside the world — gives an EMPTY list, never a
/// half-drawn line: the caller then falls back to a straight line between the two stops, which is honest about being an estimate.
List<GeoPt> decodePolyline(String? encoded, {int precision = 5}) {
  if (encoded == null || encoded.isEmpty) return const [];
  final factor = _pow10(precision);
  final out = <GeoPt>[];
  var i = 0, lat = 0, lng = 0;
  // One signed delta: 5-bit groups, low to high, continuation flag 0x20, offset 63; zig-zag encoded sign.
  int? next() {
    var result = 0, shift = 0;
    int b;
    do {
      if (i >= encoded.length) return null; // cut off
      b = encoded.codeUnitAt(i++) - 63;
      if (b < 0 || b > 63) return null; // not in the alphabet
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (shift > 60) return null; // absurdly long number
    } while (b >= 0x20);
    return (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
  }

  while (i < encoded.length) {
    final dLat = next();
    final dLng = next();
    if (dLat == null || dLng == null) return const [];
    lat += dLat;
    lng += dLng;
    final p = (lat: lat / factor, lng: lng / factor);
    if (!validGeo(p.lat, p.lng)) return const [];
    out.add(p);
  }
  return out;
}

double _pow10(int n) { var r = 1.0; for (var k = 0; k < n; k++) { r *= 10; } return r; }

/// Inverse of [decodePolyline] — used by tests (and handy for fixtures); not needed at runtime.
String encodePolyline(List<GeoPt> points, {int precision = 5}) {
  final factor = _pow10(precision);
  final b = StringBuffer();
  var pLat = 0, pLng = 0;
  void put(int v) {
    var n = v < 0 ? ~(v << 1) : (v << 1);
    while (n >= 0x20) { b.writeCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    b.writeCharCode(n + 63);
  }
  for (final p in points) {
    final la = (p.lat * factor).round(), ln = (p.lng * factor).round();
    put(la - pLat); put(ln - pLng);
    pLat = la; pLng = ln;
  }
  return b.toString();
}

// ── Best route geometry: GET /driver/jobs/:id/route-geometry (Addendum E.3) ──

/// One driving leg INTO a stop. `polyline` null (an estimate) means "draw a straight line from → to".
class RouteLeg {
  RouteLeg({required this.stopId, required this.order, this.from, this.to, this.polyline, this.distanceM, this.durationS});
  final String stopId;
  final int order;
  final GeoPt? from, to;
  final String? polyline;
  final int? distanceM, durationS;

  factory RouteLeg.fromJson(Json j) => RouteLeg(
        stopId: _s(j['stopId']) ?? '', order: _i(j['order']) ?? 0, from: _pt(j['from']), to: _pt(j['to']),
        polyline: (_s(j['polyline']) ?? '').isEmpty ? null : _s(j['polyline']), distanceM: _i(j['distanceM']), durationS: _i(j['durationS']),
      );

  List<GeoPt>? _decoded;
  /// The road geometry; empty when there is none (or it is corrupt).
  List<GeoPt> get road => _decoded ??= decodePolyline(polyline);
  bool get hasRoad => road.length >= 2;
  /// No road geometry: the line is a straight-line estimate.
  bool get isEstimate => !hasRoad;
  /// What to draw: the road, else the straight line from → to (when both ends are known), else nothing.
  List<GeoPt> get linePoints => hasRoad ? road : (from != null && to != null ? [from!, to!] : const []);
}

class RouteGeometry {
  RouteGeometry({this.origin, this.provider, this.legs = const []});
  final GeoPt? origin;
  final String? provider;
  final List<RouteLeg> legs;

  factory RouteGeometry.fromJson(Json j) => RouteGeometry(
        origin: _pt(j['origin']), provider: _s(j['provider']),
        legs: ([for (final l in _list(j['legs'])) RouteLeg.fromJson(l)]..sort((a, b) => a.order.compareTo(b.order))),
      );

  static final empty = RouteGeometry();
  RouteLeg? legFor(String stopId) { for (final l in legs) { if (l.stopId == stopId) return l; } return null; }
  bool get hasLines => legs.any((l) => l.linePoints.length >= 2);
  bool get allEstimates => legs.isNotEmpty && legs.every((l) => l.isEstimate);
}

// ── Cash with me: GET /driver/cash (E17) ──

class CashOrder {
  CashOrder(this.j);
  final Json j;
  String get offerId => _s(j['offerId']) ?? '';
  String get requestId => _s(j['requestId']) ?? '';
  String get ref => _s(j['ref']) ?? '';
  String get businessName => _s(j['businessName']) ?? '';
  int get parcels => _i(j['parcels']) ?? 0;
  int get collectedCents => _i(j['collectedCents']) ?? 0;
  int get receivedCents => _i(j['receivedCents']) ?? 0;
  int get outstandingCents => _i(j['outstandingCents']) ?? 0;
  String? get lastCollectedAt => _s(j['lastCollectedAt']);
  /// Whole days since the first collection on this order (null when the server sends none, or nothing is outstanding).
  int? get ageDays => _i(j['ageDays']);
}

class CashHandover {
  CashHandover(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get ref => _s(j['ref']) ?? '';
  int get amountCents => _i(j['amountCents']) ?? 0;
  String? get receivedByName => _s(j['receivedByName']);
  /// `business` (the warehouse) or an operations role.
  String? get receivedByRole => _s(j['receivedByRole']);
  String? get note => _s(j['note']);
  String? get createdAt => _s(j['createdAt']);
}

class CashSummary {
  CashSummary(this.j);
  final Json j;
  int get collectedCents => _i(j['collectedCents']) ?? 0;
  int get receivedCents => _i(j['receivedCents']) ?? 0;
  int get outstandingCents => _i(j['outstandingCents']) ?? 0;
  List<CashOrder> get orders => [for (final o in _list(j['orders'])) CashOrder(o)];
  List<CashHandover> get recent => [for (final o in _list(j['recent'])) CashHandover(o)];
  bool get isEmpty => collectedCents == 0 && receivedCents == 0 && outstandingCents == 0 && orders.isEmpty && recent.isEmpty;
}

/// The small `cash` block of `GET /driver/overview` ({ outstandingCents, orders }), for the card on the home screen.
class CashBrief {
  const CashBrief(this.outstandingCents, this.orders);
  final int outstandingCents, orders;
  /// Null when the server sends no cash block (older servers).
  static CashBrief? fromOverview(Json overview) {
    final m = _m(overview['cash']);
    return m == null ? null : CashBrief(_i(m['outstandingCents']) ?? 0, _i(m['orders']) ?? 0);
  }
  /// Worth a card on the home screen: there is cash with the driver, or cash history to look at.
  bool get show => outstandingCents > 0 || orders > 0;
}

/// Cash-risk states (`overview.cash.state`): a driver's cash against the platform's limit and handover time.
enum CashState { ok, warn, overLimit, overdue }

/// The `cash` block of `GET /driver/overview` (and `details.cash` of `403 CASH_LIMIT`, and `cash` of a paused offers answer): what the driver holds and what it allows.
/// Every field is tolerant — a server without cash limits sends only `outstandingCents` / `orders`, which reads as "ok".
class CashRisk {
  CashRisk(this.j);
  final Json j;
  int get outstandingCents => _i(j['outstandingCents']) ?? 0;
  int get orders => _i(j['orders']) ?? 0;
  bool get enabled => j['enabled'] == true;
  int get limitCents => _i(j['limitCents']) ?? 0;
  int get warnPct => _i(j['warnPct']) ?? 0;
  int get maxDays => _i(j['maxDays']) ?? 0;
  /// Share of the limit in use, whole percent (can exceed 100); null without a money limit.
  int? get pct => _i(j['pct']);
  int get oldestDays => _i(j['oldestDays']) ?? 0;
  String? get oldestAt => _s(j['oldestAt']);
  int get overdueCents => _i(j['overdueCents']) ?? 0;
  CashState get state => switch (_s(j['state'])) { 'warn' => CashState.warn, 'over_limit' => CashState.overLimit, 'overdue' => CashState.overdue, _ => CashState.ok };
  /// No new offers while true (accepting / applying answers `CASH_LIMIT`).
  bool get blocksOffers => j['blocksOffers'] == true;
  /// `limit` | `overdue` | null.
  String? get reason => _s(j['reason']);
  /// Part of the wallet balance that cannot be withdrawn now (`CASH_OUTSTANDING`); 0 when none.
  int get lienCents => _i(j['lienCents']) ?? 0;
  /// Worth a banner: any state but ok.
  bool get atRisk => state != CashState.ok;

  /// Null when [v] is not a map (older servers send no block).
  static CashRisk? of(Object? v) { final m = _m(v); return m == null ? null : CashRisk(m); }
}

// ── Offers hidden while busy (E11) ──

class ActiveJobRef {
  const ActiveJobRef({required this.offerId, this.requestId = '', this.ref = '', this.status = ''});
  final String offerId, requestId, ref, status;
  static ActiveJobRef? fromJson(Object? v) {
    final m = _m(v);
    final id = _s(m?['offerId']);
    return id == null || id.isEmpty ? null : ActiveJobRef(offerId: id, requestId: _s(m!['requestId']) ?? '', ref: _s(m['ref']) ?? '', status: _s(m['status']) ?? '');
  }
}

/// `{ items, hidden, activeJob }` of `GET /driver/offers` and `/driver/opportunities`.
class OffersInfo {
  const OffersInfo({this.items = const [], this.hidden = false, this.activeJob, this.cashBlocked = false, this.cash});
  final List<Json> items;
  final bool hidden;
  final ActiveJobRef? activeJob;
  /// `{ items: [], cashBlocked: true, cash }`: the driver's cash is over the limit or overdue, so no offers are made until it is handed over.
  final bool cashBlocked;
  final CashRisk? cash;
  static const none = OffersInfo();
  factory OffersInfo.fromJson(Json j) => OffersInfo(items: _list(j['items']), hidden: j['hidden'] == true, activeJob: ActiveJobRef.fromJson(j['activeJob']), cashBlocked: j['cashBlocked'] == true, cash: CashRisk.of(j['cash']));
}

// ── Invitations from a courier office ──

/// `walletBlock` of `GET /driver/invites`: money in the wallet or a withdrawal waiting stops the driver from joining an office (his earnings then go to the office).
class WalletBlock {
  const WalletBlock({this.availableCents = 0, this.heldCents = 0, this.pendingWithdrawals = 0, this.blocks = false});
  final int availableCents, heldCents, pendingWithdrawals;
  final bool blocks;
  int get totalCents => availableCents + heldCents;
  static const none = WalletBlock();
  static WalletBlock fromJson(Object? v) {
    final m = _m(v);
    return m == null ? none : WalletBlock(availableCents: _i(m['availableCents']) ?? 0, heldCents: _i(m['heldCents']) ?? 0, pendingWithdrawals: _i(m['pendingWithdrawals']) ?? 0, blocks: m['blocks'] == true);
  }
}

class InvitesInfo {
  const InvitesInfo({this.items = const [], this.walletBlock = WalletBlock.none});
  final List<Json> items;
  final WalletBlock walletBlock;
  factory InvitesInfo.fromJson(Json j) => InvitesInfo(items: _list(j['items']), walletBlock: WalletBlock.fromJson(j['walletBlock']));
}

// ── Notifications ──

class AppNotification {
  AppNotification(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get type => _s(j['type']) ?? '';
  Json get data => _m(j['data']) ?? const {};
  String? get readAt => _s(j['readAt']);
  bool get unread => readAt == null;
  String? get createdAt => _s(j['createdAt']);
  DateTime? get created => createdAt == null ? null : DateTime.tryParse(createdAt!);
  String? get ref => _s(data['ref']);
  String? get offerId => _s(data['offerId']);

  /// The `{placeholders}` of the `notif.<type>` text. Scalars become text; objects/lists are dropped. Two conveniences on top of the server data:
  /// `amount` (SAR, from `amountCents` — `notif.cod_received` is worded in riyals) and localized city names (via [city]).
  Map<String, Object?> vars({String Function(String key)? city, String Function(String key)? docType}) {
    final out = <String, Object?>{for (final e in data.entries) e.key: e.value is Map || e.value is List ? '' : '${e.value ?? ''}'};
    final cents = _i(data['amountCents']);
    if (cents != null && !out.containsKey('amount')) out['amount'] = (cents / 100).toStringAsFixed(2);
    if (city != null) {
      for (final k in const ['pickupCity', 'deliveryCity']) { final v = _s(data[k]); if (v != null && v.isNotEmpty) out[k] = city(v); }
    }
    // `document_expiring` carries the document type as a dictionary key (`national_id`): shown by its localized name, like the web.
    if (docType != null) { final v = _s(data['docType']); if (v != null && v.isNotEmpty) out['docType'] = docType(v); }
    return out;
  }
}

List<AppNotification> parseNotifications(Json r) => [for (final e in _list(r['items'])) AppNotification(e)];

/// A web path an administrator typed into a broadcast (`/driver/opportunities`) → the page of the app that shows the same thing; null for anything the app does not have.
String? appRouteOfWebLink(String? link) {
  final p = (link ?? '').trim().split('?').first.split('#').first.replaceAll(RegExp(r'/+$'), '');
  const map = {
    '/driver': '/', '/driver/opportunities': '/offers', '/driver/offers': '/offers', '/driver/jobs': '/jobs', '/driver/cash': '/cash', '/driver/wallet': '/wallet', '/driver/earnings': '/wallet',
    '/driver/documents': '/documents', '/driver/notifications': '/notifications', '/driver/support': '/support', '/driver/profile': '/profile',
  };
  return map[p];
}

/// Where tapping a notification of this type goes (a go_router location), or null for "nothing to open".
String? notificationRoute(AppNotification n) {
  final t = n.type;
  if (t == 'offer_new' || t == 'offer_replacement' || t == 'office_opportunity' || t == 'offer_rescheduled') return '/offers';
  if (t == 'cod_received' || t == 'cash_limit_warning' || t == 'cash_overdue' || t == 'cash_blocked') return '/cash';
  if (t.startsWith('ticket_')) return '/support';
  if (t == 'chat_message' && (n.offerId ?? '').isNotEmpty) return '/job/${n.offerId}/chat';
  if (const ['payout_paid', 'withdrawal_paid', 'withdrawal_rejected', 'wallet_adjusted', 'balance_moved_to_office'].contains(t)) return '/wallet';
  if (t.startsWith('document_') || t.startsWith('verification_')) return '/documents';
  if (t.startsWith('privacy_request_')) return '/privacy';
  if (t == 'broadcast') return appRouteOfWebLink(_s(n.data['link']));
  if ((n.offerId ?? '').isNotEmpty) return '/job/${n.offerId}'; // stop_marked_delivered / stop_marked_failed / parcels_added / recipient_corrected …
  return null;
}

// ── Support tickets (E15) ──

class TicketAttachment {
  TicketAttachment(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get name => _s(j['name']) ?? '';
  String get mime => _s(j['mime']) ?? '';
  int get size => _i(j['size']) ?? 0;
  bool get isImage => mime.startsWith('image/');
  bool get isPdf => mime == 'application/pdf';
}

class TicketMessage {
  TicketMessage(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get authorRole => _s(j['authorRole']) ?? '';
  /// The driver's own messages; everything else (staff, operations) is "Support".
  bool get mine => authorRole == 'driver';
  String get body => _s(j['body']) ?? '';
  String? get createdAt => _s(j['createdAt']);
  List<TicketAttachment> get attachments => [for (final a in _list(j['attachments'])) TicketAttachment(a)];
}

class Ticket {
  Ticket(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get ref => _s(j['ref']) ?? '';
  String get category => _s(j['category']) ?? 'other';
  String get subject => _s(j['subject']) ?? '';
  /// `open` | `in_review` | `resolved`.
  String get status => _s(j['status']) ?? 'open';
  String get priority => _s(j['priority']) ?? 'normal';
  bool get urgent => priority == 'urgent';
  bool get resolved => status == 'resolved';
  String? get offerId => _s(j['offerId']);
  String? get requestId => _s(j['requestId']);
  String? get createdAt => _s(j['createdAt']);
  String? get updatedAt => _s(j['updatedAt']);
  String? get resolvedAt => _s(j['resolvedAt']);

  /// The server allows a reopen within 14 days of resolving. An explicit `canReopen` from the server wins; otherwise this is computed from `resolvedAt`
  /// (falling back to `updatedAt`). [now] is injectable for tests.
  bool canReopen({DateTime? now, int days = 14}) {
    if (!resolved) return false;
    if (j['canReopen'] is bool) return j['canReopen'] == true;
    final since = DateTime.tryParse(resolvedAt ?? updatedAt ?? '');
    if (since == null) return true; // unknown date: let the server decide (it answers INVALID_TRANSITION when too late)
    return (now ?? DateTime.now()).toUtc().difference(since.toUtc()) <= Duration(days: days);
  }
}

class TicketThread {
  TicketThread(this.j);
  final Json j;
  Ticket get ticket => Ticket(_m(j['ticket']) ?? const {});
  List<TicketMessage> get replies => [for (final r in _list(j['replies'])) TicketMessage(r)];
}

List<Ticket> parseTickets(Json r) => [for (final e in _list(r['items'])) Ticket(e)];

/// `{ id, name, mime, size }` of `POST /uploads/ticket`.
class UploadedFile {
  UploadedFile(this.j);
  final Json j;
  String get id => _s(j['id']) ?? '';
  String get name => _s(j['name']) ?? '';
  String get mime => _s(j['mime']) ?? '';
  int get size => _i(j['size']) ?? 0;
}

/// Ticket categories a driver may pick, from `GET /catalog` → `ticketCategories.driver`; a built-in list when the catalog has none.
const defaultDriverTicketCategories = ['business_not_ready', 'not_put_to_work', 'shipment_count_differs', 'location_issue', 'attendance_issue', 'payment_issue', 'cod_issue', 'app_problem', 'other'];
List<String> driverTicketCategories(Json catalog) {
  final tc = _m(catalog['ticketCategories']);
  final d = tc?['driver'];
  final list = d is List ? [for (final e in d) if (e is String && e.isNotEmpty) e] : const <String>[];
  return list.isEmpty ? defaultDriverTicketCategories : list;
}
