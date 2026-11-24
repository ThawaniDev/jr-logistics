import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' show TileCoordinates, TileLayer, TileProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/extra_api.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/map_actions.dart';
import 'package:jr_driver/features/jobs/route_map_screen.dart';
import 'package:jr_driver/features/support/attachments.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/providers_extra.dart';
import 'package:jr_driver/services.dart';
import 'package:jr_driver/services_notify.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'helpers.dart';

/// Test doubles and pumping helpers for the Mobile-B features (route map, cash, notifications, offers, support). Separate from `helpers.dart` so the
/// two sets of tests never edit the same file.

Future<void> settleB(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

/// An [ExtraApi] answering from memory. Every call is recorded in [calls]; set the `…Error` fields to make the next call of that kind fail.
class FakeExtraApi extends ExtraApi {
  FakeExtraApi() : super(ApiClient(baseUrl: 'http://fake', tokens: MemoryTokenStore()));
  final calls = <String>[];

  RouteGeometry geometry = RouteGeometry.empty;
  Object? geometryError;
  Completer<void>? geometryGate;
  CashSummary cashResult = CashSummary({'collectedCents': 0, 'receivedCents': 0, 'outstandingCents': 0, 'orders': [], 'recent': []});
  OffersInfo offers = OffersInfo.none;
  List<AppNotification> unread = [];
  Object? unreadError;
  List<Ticket> ticketList = [];
  final threads = <String, TicketThread>{};
  Object? errorOnNext;
  Completer<void>? gate;
  int uploads = 0;
  Uint8List bytes = _png;

  void _maybeThrow() { final e = errorOnNext; if (e != null) { errorOnNext = null; throw e; } }

  @override
  Future<RouteGeometry> routeGeometry(String offerId) async { calls.add('geometry:$offerId'); await geometryGate?.future; if (geometryError != null) throw geometryError!; return geometry; }
  @override
  Future<CashSummary> cash() async { calls.add('cash'); _maybeThrow(); return cashResult; }
  @override
  Future<OffersInfo> offersInfo() async { calls.add('offersInfo'); return offers; }
  @override
  Future<OffersInfo> opportunitiesInfo() async { calls.add('oppInfo'); return offers; }
  @override
  Future<List<AppNotification>> unreadNotifications() async { calls.add('unread'); if (unreadError != null) throw unreadError!; return unread; }
  @override
  Future<void> markRead({List<String>? ids}) async { calls.add('markRead:${ids?.join(',') ?? 'all'}'); _maybeThrow(); }
  @override
  Future<List<Ticket>> tickets() async { calls.add('tickets'); _maybeThrow(); return ticketList; }
  @override
  Future<TicketThread> ticket(String id) async { calls.add('ticket:$id'); _maybeThrow(); return threads[id] ?? (throw ApiException('NOT_FOUND', 'no', status: 404)); }
  @override
  Future<Ticket> createTicket({required String category, required String subject, String? body, String? offerId, List<String> attachmentIds = const []}) async {
    calls.add('create:$category|$subject|${body ?? ''}|${offerId ?? ''}|${attachmentIds.join(',')}');
    await gate?.future;
    _maybeThrow();
    final t = Ticket({'id': 'tk-new', 'ref': 'TK-000099', 'category': category, 'subject': subject, 'status': 'open', 'priority': 'normal', 'createdAt': '2026-12-01T06:00:00.000Z'});
    threads['tk-new'] = TicketThread({'ticket': t.j, 'replies': [if (body != null) {'id': 'r0', 'authorRole': 'driver', 'body': body, 'createdAt': '2026-12-01T06:00:00.000Z', 'attachments': []}]});
    return t;
  }
  @override
  Future<void> replyTicket(String id, String body, {List<String> attachmentIds = const []}) async { calls.add('reply:$id|$body|${attachmentIds.join(',')}'); await gate?.future; _maybeThrow(); }
  @override
  Future<Ticket> reopenTicket(String id, {String? body}) async { calls.add('reopen:$id|${body ?? ''}'); _maybeThrow(); return Ticket({'id': id, 'status': 'open'}); }
  @override
  Future<Ticket> resolveTicket(String id) async { calls.add('resolve:$id'); _maybeThrow(); return Ticket({'id': id, 'status': 'resolved'}); }
  @override
  Future<UploadedFile> uploadTicketFile(String path, String filename, {void Function(double progress)? onProgress}) async {
    calls.add('upload:$filename');
    onProgress?.call(0.5);
    await gate?.future;
    _maybeThrow();
    return UploadedFile({'id': 'up-${++uploads}', 'name': filename, 'mime': 'image/jpeg', 'size': 1234});
  }
  @override
  Future<Uint8List> attachmentBytes(String id) async { calls.add('bytes:$id'); return bytes; }
}

/// A 1x1 transparent PNG: valid image bytes for thumbnails and map tiles.
final Uint8List _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

/// A tile source that never touches the network.
class NoTiles extends TileProvider {
  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) => MemoryImage(_png);
}

/// The per-stop actions of the map popup, recorded. [applies] = what each action reports ("applied on the server" or not).
class FakeMapActions implements MapStopActions {
  final calls = <String>[];
  bool applies = true;
  /// Runs when an action "applies" — tests use it to change what the server would now answer.
  void Function(String action, Stop stop)? onApplied;
  Future<bool> _do(String name, Stop s) async { calls.add('$name:${s.id}'); if (applies) onApplied?.call(name, s); return applies; }
  @override
  Future<bool> arrive(BuildContext context, WidgetRef ref, Job job, Stop stop) => _do('arrive', stop);
  @override
  Future<bool> deliver(BuildContext context, WidgetRef ref, Job job, Stop stop) => _do('deliver', stop);
  @override
  Future<bool> cantDeliver(BuildContext context, WidgetRef ref, Job job, Stop stop) => _do('cant', stop);
  @override
  Future<bool> postpone(BuildContext context, WidgetRef ref, Job job, Stop stop) => _do('postpone', stop);
  @override
  Future<bool> makeNext(BuildContext context, WidgetRef ref, Job job, Stop stop) => _do('makeNext', stop);
  @override
  Future<void> navigate(BuildContext context, Stop stop) async { calls.add('navigate:${stop.id}'); }
  @override
  Future<void> call(BuildContext context, Stop stop) async { calls.add('call:${stop.id}'); }
  @override
  Future<void> whatsapp(BuildContext context, WidgetRef ref, Job job, Stop stop) async { calls.add('whatsapp:${stop.id}'); }
}

class FakeAttachmentPicker implements AttachmentPicker {
  final picked = <ImageSource>[];
  int n = 0;
  @override
  Future<PickedPhoto?> pick(ImageSource source) async { picked.add(source); n++; return (path: '/tmp/ticket-$n.jpg', name: 'ticket-$n.jpg'); }
}

/// A notifier that records what would have been shown and lets a test decide the permission state.
class FakeNotifier extends NoopNotifier {
  FakeNotifier({this.permission, this.grantOnRequest = true});
  bool? permission;
  bool grantOnRequest;
  int asked = 0, settingsOpened = 0, cancelled = 0;
  final tapController = StreamController<String?>.broadcast();
  String? launch;
  @override
  Stream<String?> get taps => tapController.stream;
  @override
  Future<String?> takeLaunchPayload() async { final l = launch; launch = null; return l; }
  @override
  Future<bool?> granted() async => permission;
  @override
  Future<bool> requestPermission() async { asked++; if (grantOnRequest) permission = true; return permission == true; }
  @override
  Future<void> cancelAll() async { cancelled++; }
  @override
  Future<bool> openSettings() async { settingsOpened++; return true; }
}

class SignedInAuth extends AuthNotifier {
  SignedInAuth([this.uid = 'u1']);
  final String uid;
  @override
  Future<AuthState> build() async => AuthState(user: {'id': uid, 'role': 'driver', 'name': 'Omar Test', 'language': 'en'});
}

/// Overrides every Mobile-B provider that would otherwise reach the network or a platform channel.
List<Override> extraOverrides({FakeExtraApi? api, FakeMapActions? actions, FakeAttachmentPicker? picker, LocalNotifier? notifier}) => [
      extraApiProvider.overrideWithValue(api ?? FakeExtraApi()),
      mapTileProviderProvider.overrideWith((_) => NoTiles()),
      if (actions != null) mapStopActionsProvider.overrideWithValue(actions),
      if (picker != null) attachmentPickerProvider.overrideWithValue(picker),
      if (notifier != null) localNotifierProvider.overrideWithValue(notifier),
    ];

/// Plain pages for every route a Mobile-B screen can navigate to: `PAGE:<location>`.
List<RouteBase> stubRoutes() => [
      for (final p in ['/offers', '/wallet', '/jobs', '/cash', '/support', '/notifications', '/documents', '/profile/edit', '/privacy', '/legal-accept', '/legal/driver', '/legal/privacy'])
        GoRoute(path: p, builder: (_, s) => Scaffold(body: Center(child: Text('PAGE:${s.uri}')))),
    ];

/// Pumps [home] at "/" inside a GoRouter (so `context.push` / `go` work) with the Mobile-B providers faked. Extra routes: [routes].
Future<GoRouter> pumpRoutedB(WidgetTester t, Widget home, {FakeLegalApi? legal, FakePrivacyRepo? privacy, FakeSharer? sharer, String lang = 'en', required FakeApi api, FakeExtraApi? extraApi, FakeMapActions? actions, FakeAttachmentPicker? picker, FakeLinks? links, LocationService? location, LocalNotifier? notifier, List<Override> overrides = const [], List<RouteBase> routes = const [], Map<String, Object> prefsValues = const {}, Size size = const Size(900, 1900), String initial = '/'}) async {
  JR.use(testBrightness);
  SharedPreferences.setMockInitialValues({'lang': lang, installMarkerKey: '1', ...prefsValues});
  final prefs = await SharedPreferences.getInstance();
  t.view.physicalSize = size;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  final router = GoRouter(initialLocation: initial, routes: [
    GoRoute(path: '/', builder: (_, _) => home),
    GoRoute(path: '/job/:id', builder: (_, s) => Scaffold(body: Center(child: Text('JOB-PAGE-${s.pathParameters['id']}'))), routes: [GoRoute(path: 'chat', builder: (_, s) => Scaffold(body: Center(child: Text('CHAT-PAGE-${s.pathParameters['id']}'))))]),
    ...stubRoutes(),
    ...routes,
  ]);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [
      prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
      linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(location ?? FakeLocation()),
      legalApiProvider.overrideWithValue(legal ?? FakeLegalApi()), privacyRepoProvider.overrideWithValue(privacy ?? FakePrivacyRepo()), fileSharerProvider.overrideWithValue(sharer ?? FakeSharer()),
      ...extraOverrides(api: extraApi, actions: actions, picker: picker, notifier: notifier), ...overrides,
    ],
    child: MaterialApp.router(
      theme: buildTheme(testBrightness), locale: Locale(lang), routerConfig: router,
      builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: w!)),
    ),
  ));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
  return router;
}

/// A tiny ticket thread fixture.
TicketThread mkThread({String id = 'tk1', String ref = 'TK-000007', String status = 'open', String priority = 'normal', String? resolvedAt, List<Json>? replies, Json? extra}) => TicketThread({
      'ticket': {'id': id, 'ref': ref, 'category': 'cod_issue', 'subject': 'Cash does not match', 'status': status, 'priority': priority, 'createdAt': '2026-12-01T06:00:00.000Z', 'updatedAt': '2026-12-02T06:00:00.000Z', 'resolvedAt': resolvedAt, ...?extra},
      'replies': replies ?? [
        {'id': 'r1', 'authorRole': 'driver', 'body': 'I collected 50 but the system says 60', 'createdAt': '2026-12-01T06:00:00.000Z', 'attachments': [{'id': 'a1', 'name': 'receipt.jpg', 'mime': 'image/jpeg', 'size': 2000}]},
        {'id': 'r2', 'authorRole': 'admin', 'body': 'Thanks, we are checking with the warehouse.', 'createdAt': '2026-12-01T07:00:00.000Z', 'attachments': [{'id': 'a2', 'name': 'statement.pdf', 'mime': 'application/pdf', 'size': 9000}]},
      ],
    });

Json mkTicketRow(String id, {String ref = 'TK-000001', String status = 'open', String priority = 'normal', String category = 'payment_issue', String subject = 'Payment is late'}) =>
    {'id': id, 'ref': ref, 'category': category, 'subject': subject, 'status': status, 'priority': priority, 'createdAt': '2026-12-01T06:00:00.000Z', 'updatedAt': '2026-12-02T06:00:00.000Z', 'resolvedAt': status == 'resolved' ? '2026-12-02T06:00:00.000Z' : null};

Json mkNotification(String id, String type, {Json? data, String? readAt, String? createdAt}) => {'id': id, 'type': type, 'data': data ?? {}, 'readAt': readAt, 'createdAt': createdAt ?? '2026-12-01T06:00:00.000Z'};
