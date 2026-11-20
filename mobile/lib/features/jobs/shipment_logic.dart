import '../../core/format.dart';
import '../../data/models.dart';

/// Pure logic of the shipments screen (the "delivery run sheet"): status mapping, filters, counters, search, which stops accept actions.
/// No widgets here, so all of it is unit-tested.

/// What the driver sees on a shipment card. `loaded` (on the vehicle) is "Out for delivery"; a loaded stop that was postponed and not visited again is "Postponed".
enum ShipStatus { outForDelivery, delivered, failed, returned, missing, postponed, pending, cancelled }

ShipStatus shipStatusOf(Stop s) => switch (s.status) {
      'delivered' => ShipStatus.delivered,
      'failed' => ShipStatus.failed,
      'returned' => ShipStatus.returned,
      'missing' => ShipStatus.missing,
      'cancelled' => ShipStatus.cancelled,
      'pending' => ShipStatus.pending,
      _ => s.deferCount > 0 && !s.arrived ? ShipStatus.postponed : ShipStatus.outForDelivery,
    };

/// The filter chips: All · To deliver · Delivered · Not delivered. `key` is used in widget keys (`ship-filter-<key>`) and as the id.
enum ShipFilter {
  all('all'), toDeliver('to_deliver'), delivered('delivered'), notDelivered('not_delivered');
  const ShipFilter(this.key);
  final String key;

  bool accepts(Stop s) => switch (this) {
        ShipFilter.all => true,
        ShipFilter.toDeliver => s.status == 'loaded',
        ShipFilter.delivered => s.status == 'delivered',
        ShipFilter.notDelivered => s.status == 'failed' || s.status == 'returned' || s.status == 'missing',
      };
}

/// How many stops each chip would show.
class ShipCounts {
  const ShipCounts({this.total = 0, this.toDeliver = 0, this.delivered = 0, this.notDelivered = 0});
  final int total, toDeliver, delivered, notDelivered;
  factory ShipCounts.of(Iterable<Stop> stops) {
    var total = 0, to = 0, ok = 0, bad = 0;
    for (final s in stops) {
      total++;
      if (ShipFilter.toDeliver.accepts(s)) to++;
      if (ShipFilter.delivered.accepts(s)) ok++;
      if (ShipFilter.notDelivered.accepts(s)) bad++;
    }
    return ShipCounts(total: total, toDeliver: to, delivered: ok, notDelivered: bad);
  }
  int of(ShipFilter f) => switch (f) { ShipFilter.all => total, ShipFilter.toDeliver => toDeliver, ShipFilter.delivered => delivered, ShipFilter.notDelivered => notDelivered };
  /// Stops that are finished (delivered or not).
  int get done => delivered + notDelivered;
}

String _digits(String s) => latinDigits(s).replaceAll(RegExp(r'\D'), '');

/// Search by shipment code, order reference, manifest number, recipient name, phone (digits only, any formatting), address, city and contents.
bool shipmentMatches(Stop s, String query) {
  final q = latinDigits(query).trim().toLowerCase();
  if (q.isEmpty) return true;
  for (final v in [s.code, s.orderRef, s.manifestNumber, s.recipientName, s.address, s.city, s.contents]) {
    if (v != null && v.toLowerCase().contains(q)) return true;
  }
  // A phone search is a query made of digits and phone punctuation only ("+966 55 …", "055…", "0096655…"); letters never match digits.
  // The local form starts with 0 ("0555…") while the server keeps the international one ("+966555…"): leading zeros are dropped before comparing.
  final qd = _digits(q).replaceFirst(RegExp(r'^0+'), '');
  final phone = s.recipientPhone;
  return qd.isNotEmpty && _digits(q).length == q.replaceAll(RegExp(r'[\s+\-()]'), '').length && phone != null && _digits(phone).contains(qd);
}

/// The stops for the current chip and search, in the server's (manifest) order.
List<Stop> filterShipments(List<Stop> stops, ShipFilter f, String query) => [for (final s in stops) if (f.accepts(s) && shipmentMatches(s, query)) s];

/// The next shipment to work: the first one still on the vehicle, in manifest order (with routing on that is the server's current stop).
Stop? nextShipment(List<Stop> stops) {
  for (final s in stops) { if (s.current && s.status == 'loaded') return s; }
  for (final s in stops) { if (s.status == 'loaded') return s; }
  return null;
}

/// Which stops accept actions (arrive, deliver, fail, postpone, call, WhatsApp). The server decides through `actions[]` (`work_stops`); on top of that,
/// with routing ON only the current stop is open (one at a time), with routing OFF every shipment on the vehicle is.
bool acceptsActions(Job job, Stop s) => job.can('work_stops') && s.status == 'loaded' && (!job.routingEnabled || s.current);

/// What the stop sheet offers for one shipment.
class ShipActions {
  const ShipActions({this.arrive = false, this.deliver = false, this.cantDeliver = false, this.postpone = false, this.call = false, this.whatsapp = false, this.locked = false});
  final bool arrive, deliver, cantDeliver, postpone, call, whatsapp;
  /// Routing is ON and this is not the current stop yet.
  final bool locked;
}

ShipActions shipActionsFor(Job job, Stop s) {
  final open = job.can('work_stops') && s.status == 'loaded';
  final ok = acceptsActions(job, s);
  final phone = s.recipientPhone;
  return ShipActions(
    arrive: ok && !s.arrived,
    deliver: ok && s.arrived,
    cantDeliver: ok,
    postpone: ok && s.canDefer,
    call: ok && phone != null && phone.trim().isNotEmpty,
    whatsapp: ok,
    locked: open && !ok,
  );
}

/// Date only ("20 Nov 2026") of a timestamp for the card's clock line; empty when unknown.
String shipDate(String? iso, String lang) {
  if (iso == null) return '';
  final v = fmtDateTime(iso, lang);
  return v == '—' ? '' : v.split(' · ').first;
}
