import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'data/api_client.dart';
import 'data/extra_api.dart';
import 'data/models.dart';
import 'data/models_extra.dart';
import 'providers.dart';

/// Field-operations data (Addendum E). Everything here goes through [ExtraApi]; tests override [extraApiProvider] with a fake.
/// (Built from the same client as `apiProvider`, so it shares the session, retries and the "no connection" indicator.)
final extraApiProvider = Provider<ExtraApi>((ref) => ExtraApi(ref.watch(apiProvider).c));

/// The coloured legs of the whole route, fetched when the map opens.
final routeGeometryProvider = FutureProvider.autoDispose.family<RouteGeometry, String>((ref, offerId) => ref.watch(extraApiProvider).routeGeometry(offerId));

final cashProvider = FutureProvider.autoDispose<CashSummary>((ref) => ref.watch(extraApiProvider).cash());

/// `hidden` / `activeJob` of the offers endpoints. Failing is harmless: the lists themselves surface their own errors, so this just reads "not hidden".
final offersInfoProvider = FutureProvider.autoDispose<OffersInfo>((ref) async {
  try { return await ref.watch(extraApiProvider).offersInfo(); } on ApiException { return OffersInfo.none; }
});
final opportunitiesInfoProvider = FutureProvider.autoDispose<OffersInfo>((ref) async {
  try { return await ref.watch(extraApiProvider).opportunitiesInfo(); } on ApiException { return OffersInfo.none; }
});

/// The active-job shortcut of the home screen: `overview.activeJob`.
ActiveJobRef? activeJobOf(Overview o) => ActiveJobRef.fromJson(o.j['activeJob']);

// ── support ──
final ticketsProvider = FutureProvider.autoDispose<List<Ticket>>((ref) => ref.watch(extraApiProvider).tickets());
final ticketProvider = FutureProvider.autoDispose.family<TicketThread, String>((ref, id) => ref.watch(extraApiProvider).ticket(id));

/// Unread notifications (newest first) — also the source of the "new reply" cue on tickets. Null while loading or when it failed (no cue then).
final unreadNotificationsProvider = FutureProvider.autoDispose<List<AppNotification>>((ref) => ref.watch(extraApiProvider).unreadNotifications());

/// Ticket refs that have an unread reply / resolution / reopening.
final unreadTicketRefsProvider = Provider.autoDispose<Set<String>>((ref) {
  final list = ref.watch(unreadNotificationsProvider).value ?? const <AppNotification>[];
  return {for (final n in list) if (n.type.startsWith('ticket_') && n.ref != null) n.ref!};
});

/// Attachment bytes are fetched once per id and kept (thumbnails scroll in and out of view).
final attachmentBytesProvider = FutureProvider.family<Uint8List, String>((ref, id) => ref.watch(extraApiProvider).attachmentBytes(id));
