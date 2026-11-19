import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import 'deliver_form.dart';
import 'route_order.dart';
import 'stop_runner.dart';
import 'stop_sheets.dart';

export 'stop_runner.dart' show runStopAction, stopBusyProvider, stopErrMessage, stopIn;

/// Google Maps directions to a stop: its pin when it has one, otherwise a search for its address.
Uri stopNavigationUri(Stop s) => s.lat != null && s.lng != null
    ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}')
    : Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': '${s.address} ${s.city ?? ''}'.trim()});

/// Every action a driver can take on ONE stop, as reusable calls — the stops screen and the route-map popup both use these,
/// so a stop behaves identically wherever it is acted on.
///
/// Contract: each returns `true` when the action was applied on the server (the job is then already refreshed), `false` when the driver cancelled
/// or it failed (the action has already shown the reason). They work on any stop the server allows (e.g. only the current stop can be delivered);
/// callers decide which buttons to show from `stop.current`, `stop.arrived`, etc. The [context] must stay mounted while an action runs.
/// While one action of a job runs, [stopBusyProvider] contains its offer id — watch it to disable other buttons.
class StopActions {
  StopActions._();

  /// "I've arrived" at the customer (GPS attached when available; it never blocks).
  static Future<bool> arrive(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    if (!context.mounted) return false;
    final where = await stopWhere(ref.read(locationServiceProvider));
    if (!context.mounted) return false;
    final stopId = stop.id;
    return runStopAction(context, ref, job.offerId, () async { await ref.read(apiProvider).arriveStop(job.offerId, stopId, lat: where.lat, lng: where.lng); }, success: 'job.arrived_ok', verify: (f) => stopIn(f, stopId)?.arrived == true);
  }

  /// The full delivery sheet: parcel code (scan/type), the recipient's code when the warehouse needs it, the signature when needed, cash confirmation for COD.
  static Future<bool> deliver(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    if (!context.mounted) return false;
    final r = await showModalBottomSheet<bool>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => DeliverSheet(job: job, stop: stop));
    return r == true;
  }

  /// "Can't deliver": every reason is selectable (unless the platform is strict), optional note and photo.
  static Future<bool> cantDeliver(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    if (!context.mounted) return false;
    final r = await showModalBottomSheet<bool>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => FailSheet(job: job, stop: stop));
    return r == true;
  }

  /// Postpone ("reschedule"): the evidence (written reason and/or photo) the platform policy requires.
  static Future<bool> postpone(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    if (!context.mounted) return false;
    final r = await showModalBottomSheet<bool>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => PostponeSheet(job: job, stop: stop));
    return r == true;
  }

  /// Move this stop to the front of the remaining stops (manual reorder; only when `job.route?.canReorder`). The stop the driver stands at stays first.
  static Future<bool> makeNext(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    if (!context.mounted) return false;
    final movable = movableStops(job);
    final order = orderWithFirst(movable, stop.id);
    if (!job.canReorder || order == null) { toast(context, context.tr('fma.order_off'), error: true); return false; }
    if (movable.first.id == stop.id) { toast(context, context.tr('fma.already_next'), quiet: true); return false; }
    final stopId = stop.id;
    return runStopAction(context, ref, job.offerId, () async { await ref.read(apiProvider).routeReorder(job.offerId, order); },
        success: 'fma.order_saved', verify: (f) => movableStops(f).firstOrNull?.id == stopId);
  }

  /// Open turn-by-turn navigation (Google Maps) to the stop.
  static Future<void> navigate(BuildContext context, Stop stop) async {
    final opener = ProviderScope.containerOf(context, listen: false).read(linkOpenerProvider);
    final ok = await opener.open(stopNavigationUri(stop));
    if (!ok && context.mounted) toast(context, context.tr('um.cant_maps'), error: true);
  }

  /// Call the recipient (current stop only: the server shows the phone only for it).
  static Future<void> call(BuildContext context, Stop stop) async {
    final phone = stop.recipientPhone;
    if (phone == null) return;
    final opener = ProviderScope.containerOf(context, listen: false).read(linkOpenerProvider);
    final ok = await opener.call(phone);
    if (!ok && context.mounted) toast(context, context.tr('um.cant_call'), error: true);
  }

  /// WhatsApp hand-off to the recipient (current stop only): a ready message, the driver presses send.
  static Future<void> whatsapp(BuildContext context, WidgetRef ref, Job job, Stop stop) async {
    final container = ProviderScope.containerOf(context, listen: false);
    final lang = container.read(localeProvider);
    try {
      final r = await container.read(apiProvider).whatsapp(job.offerId, 'contact', lang, shipmentId: stop.id);
      final url = r['url'];
      final ok = url is String && await container.read(linkOpenerProvider).open(Uri.parse(url));
      if (!ok && context.mounted) toast(context, context.tr('m.wa_open_failed'), error: true);
    } catch (e) {
      if (context.mounted) toast(context, e is ApiException && (e.code == 'STOP_LOCKED' || e.isNetwork) ? errMessage(context, e) : context.tr('m.wa_open_failed'), error: true);
    }
  }
}
