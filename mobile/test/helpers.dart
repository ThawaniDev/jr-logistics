import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/legal_api.dart';
import 'package:jr_driver/data/privacy_repo.dart';
import 'package:jr_driver/providers_extra.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/deliver_form.dart';
import 'package:jr_driver/features/jobs/signature_pad.dart';
import 'package:jr_driver/widgets/barcode_scanner.dart';
import 'package:jr_driver/widgets/evidence_photo.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, String> loadDict(String code) => (jsonDecode(File('assets/i18n/$code.json').readAsStringSync()) as Map<String, dynamic>).map((k, v) => MapEntry(k, v as String));
Strings strings(String code) => Strings.fromMaps(code, code == 'en' ? loadDict('en') : loadDict(code), loadDict('en'));

/// A DriverApi whose network calls are replaced by in-memory fakes.
class FakeApi extends DriverApi {
  FakeApi() : super(ApiClient(baseUrl: 'http://fake', tokens: MemoryTokenStore()));
  final calls = <String>[];
  Job? jobResult;
  List<Job> activeJobs = [];
  List<Job> offerList = [];
  Overview overviewResult = Overview({'availability': 'unavailable', 'verificationStatus': 'verified', 'newOffers': 0, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': false, 'wallet': {'availableCents': 12500, 'heldCents': 0, 'pendingCents': 4000}});
  List<Json> custodyItems = [];
  Json profileResult = {'user': {'id': 'u1', 'name': 'Omar Test', 'email': null, 'city': 'riyadh', 'role': 'driver'}, 'profile': {'vehicleType': 'sedan', 'vehicleTemperature': null, 'vehiclePlate': 'ABC 1234', 'nationalId': '1000000000', 'services': ['delivery_driver'], 'bankName': null, 'iban': null}};
  Json waResult = {'url': 'https://wa.me/966555555555?text=hi', 'text': 'hi'};
  Object? errorOnNext;
  /// When set, deliver/fail/arrive/upload wait for it before answering (lets a test tap twice while a request is in flight).
  Completer<void>? gate;
  int jobFetches = 0;

  void _maybeThrow() { final e = errorOnNext; if (e != null) { errorOnNext = null; throw e; } }

  @override
  Future<Overview> overview() async => overviewResult;
  @override
  Future<List<Job>> offers() async => offerList;
  @override
  Future<List<Job>> jobs({required bool active}) async => active ? activeJobs : historyJobs;
  /// Finished jobs the fake server holds (paged like the real one: `historyPageSize` per page, `total` = all of them unless [historyTotal] says otherwise).
  List<Job> historyJobs = [];
  int historyPageSize = 100;
  int? historyTotal;
  final pagesAsked = <int>[];
  @override
  Future<JobsPage> jobsPage({required bool active, int page = 1}) async {
    if (!active) pagesAsked.add(page);
    final all = await jobs(active: active); // a subclass may serve its own lists through jobs()
    final from = (page - 1) * historyPageSize;
    return JobsPage(from >= all.length ? const [] : all.skip(from).take(historyPageSize).toList(), total: active ? all.length : (historyTotal ?? all.length), page: page, pageSize: historyPageSize);
  }
  @override
  Future<Job> job(String offerId) async { jobFetches++; if (jobFetchError != null) throw jobFetchError!; return jobResult!; }
  Object? jobFetchError;
  @override
  Future<Json> catalog() async {
    if (catalogError != null) throw catalogError!;
    return {
      'terms': {'driver': ''}, 'policy': {'minWithdrawalCents': minWithdrawalCents, 'cancelPolicyEnabled': true, 'cancelWarnAt': 2, 'cancelSuspendAt': 4, 'cancelWindowDays': 7, 'cancelSuspendDays': 3, 'app': ?catalogApp},
      'cities': catalogCities, 'vehicleTypes': catalogVehicles, 'services': catalogServices, 'documents': {'driver': []}, 'company': ?catalogCompany,
    };
  }
  /// `policy.app` of the catalog (`{minVersion: {ios, android}, storeUrl: {ios, android}}`) and the `company` block (support channels); absent by default.
  Json? catalogApp, catalogCompany;
  Object? catalogError;
  int minWithdrawalCents = 0;
  List<Json> catalogCities = [], catalogServices = [];
  List<String> catalogVehicles = [];
  /// Ledger pages the fake server answers (index 0 = page 1); null = one empty page.
  List<Json>? walletPages;
  @override
  Future<Json> wallet({int page = 1}) async {
    calls.add('wallet:$page');
    final p = walletPages;
    return p != null && page - 1 < p.length ? p[page - 1] : {'availableCents': 12500, 'heldCents': 0, 'reservedCents': 0, 'entries': []};
  }
  @override
  Future<List<Json>> withdrawals() async => [];
  // ── auth: username + password (no OTP) ──
  /// What `POST /auth/login` and `POST /auth/register` answer.
  Json loginResult = {'token': 'tok', 'user': {'id': 'u1', 'role': 'driver', 'name': 'Omar Test', 'username': 'demo.driver', 'phone': '+966500000011', 'language': 'en', 'mustChangePassword': false}};
  // ── sign-out: recorded, never touches a network ──
  @override
  Future<void> goOffline() async { calls.add('goOffline'); }
  @override
  Future<void> logout() async { calls.add('logout'); }
  @override
  Future<void> revokeSession(String token) async { calls.add('revoke:$token'); }
  @override
  Future<Json> login(String username, String password) async { calls.add('login:$username:$password'); await gate?.future; _maybeThrow(); return loginResult; }
  /// Usernames the server would report as taken; every other valid name is available. [availabilityError] makes the next check fail (offline…).
  final takenUsernames = <String>{};
  Object? availabilityError;
  @override
  Future<Json> usernameAvailable(String username) async {
    calls.add('available:$username');
    final e = availabilityError;
    if (e != null) { availabilityError = null; throw e; }
    return takenUsernames.contains(username) ? {'available': false, 'reason': 'taken'} : {'available': true};
  }
  Json? registered;
  @override
  Future<Json> register(Json body) async { calls.add('register:${body['username']}'); registered = body; await gate?.future; _maybeThrow(); return loginResult; }
  /// `changePassword` fails with this once (e.g. a 401 for a wrong current password).
  @override
  Future<Json> changePassword(String currentPassword, String newPassword) async { calls.add('changePassword:$currentPassword>$newPassword'); await gate?.future; _maybeThrow(); return changePasswordResult; }
  Json changePasswordResult = {'ok': true};
  @override
  Future<Json> checkIn(String offerId, {double? lat, double? lng}) async { calls.add('checkIn:$lat,$lng'); await gate?.future; _maybeThrow(); return checkInResult; }
  /// What `POST /offers/:id/checkin` answers (the offer): `arrived`, or `attendance_confirmed` when the warehouse needs no confirmation.
  Json checkInResult = {'status': 'arrived'};
  // ── loading by scanning: a tiny in-memory warehouse ──
  /// code (or order ref / manifest number) → parcel the server would accept for this driver. Anything else is `VALIDATION field=code`.
  final scanBook = <String, ({String id, String code, int seq})>{};
  final scannedIds = <String>{};
  Job? jobAfterFinish;
  int finishReleased = 0;
  @override
  Future<LoadingScanResult> loadingScan(String offerId, String code) async {
    calls.add('scan:$code'); await gate?.future; _maybeThrow();
    final e = scanBook[code];
    if (e == null) throw ApiException('VALIDATION', 'not in your load', status: 422, details: {'field': 'code'});
    final already = !scannedIds.add(e.id);
    final assigned = {for (final b in scanBook.values) b.id}.length;
    return LoadingScanResult({'shipment': {'id': e.id, 'code': e.code, 'seq': e.seq}, 'scanned': scannedIds.length, 'assigned': assigned, 'already': already});
  }
  @override
  Future<Json> loadingUnscan(String offerId, String code) async {
    calls.add('unscan:$code'); _maybeThrow();
    final e = scanBook[code];
    if (e != null) scannedIds.remove(e.id);
    return {'scanned': scannedIds.length, 'assigned': {for (final b in scanBook.values) b.id}.length};
  }
  @override
  Future<LoadingFinishResult> loadingFinish(String offerId) async {
    calls.add('finish-loading'); await gate?.future; _maybeThrow();
    if (jobAfterFinish != null) jobResult = jobAfterFinish;
    return LoadingFinishResult({'loaded': scannedIds.length, 'released': finishReleased});
  }
  // ── evidence uploads and manual route order ──
  int _media = 0;
  @override
  Future<Json> uploadStopMedia(String offerId, String stopId, {required String kind, String? path, Uint8List? bytes, required String filename, void Function(double progress)? onProgress}) async {
    calls.add('media:$stopId:$kind:$filename${bytes != null ? ':${bytes.length}b' : ''}'); onProgress?.call(0.5); await gate?.future; _maybeThrow();
    return {'id': 'm${++_media}', 'kind': kind};
  }
  Job? jobAfterReorder;
  @override
  Future<RouteOptimizeResult> routeReorder(String offerId, List<String> order) async {
    calls.add('reorder:${order.join(',')}'); await gate?.future; _maybeThrow();
    if (jobAfterReorder != null) jobResult = jobAfterReorder;
    return RouteOptimizeResult({'plan': {}, 'currentId': null});
  }
  /// What `POST /offers/:id/route/optimize` answers, and the job the server then holds (the next job read returns [jobAfterOptimize], like a re-plan would).
  RouteOptimizeResult optimizeResult = RouteOptimizeResult({'plan': {}, 'cached': false, 'changed': true, 'currentId': null});
  Job? jobAfterOptimize;
  @override
  Future<RouteOptimizeResult> optimizeRoute(String offerId, {double? lat, double? lng}) async {
    calls.add('optimize:$lat,$lng');
    await gate?.future;
    _maybeThrow();
    if (jobAfterOptimize != null) jobResult = jobAfterOptimize;
    return optimizeResult;
  }
  @override
  Future<void> ackLoading(String offerId, bool ok, {String? note}) async { calls.add(note == null ? 'ack:$ok' : 'ack:$ok:$note'); _maybeThrow(); }
  @override
  Future<void> reportNoWork(String offerId, String? note) async { calls.add('noWork:${note ?? ''}'); _maybeThrow(); }
  @override
  Future<void> rate(String offerId, int stars, {String? comment}) async { calls.add('rate:$stars:${comment ?? ''}'); _maybeThrow(); }
  @override
  Future<List<Json>> custody(String offerId) async => custodyItems;
  @override
  Future<void> acknowledgeCustody(String itemId) async { calls.add('custody:$itemId'); _maybeThrow(); custodyItems = [for (final i in custodyItems) i['id'] == itemId ? {...i, 'status': 'acknowledged'} : i]; }
  @override
  Future<Json> profile() async => profileResult;
  @override
  Future<Json> updateProfile(Json body) async { calls.add('profile:${jsonEncode(body)}'); _maybeThrow(); return {'user': {'id': 'u1', 'name': body['name'], 'role': 'driver'}, 'profile': {}}; }
  @override
  Future<Json> requestWithdrawal(int cents) async { calls.add('withdraw:$cents'); await gate?.future; _maybeThrow(); return {}; }
  @override
  Future<void> reject(String offerId) async { calls.add('reject:$offerId'); _maybeThrow(); }
  Json meResult = {'user': {'id': 'u1', 'role': 'driver', 'name': 'Omar Test', 'phone': '0500000011', 'language': 'en'}};
  Object? meError;
  @override
  Future<Json> me() async { if (meError != null) throw meError!; return meResult; }
  @override
  Future<void> delivered(String offerId, [int? units]) async { calls.add(units == null ? 'delivered:{}' : 'delivered:$units'); _maybeThrow(); }
  @override
  Future<Json> accept(String offerId) async { calls.add('accept:$offerId'); _maybeThrow(); return {'id': offerId}; }
  Object? cancelError;
  @override
  Future<Json> cancel(String offerId, String reason) async { calls.add('cancel:$reason'); if (cancelError != null) throw cancelError!; return {}; }
  @override
  Future<Json> whatsapp(String offerId, String kind, String lang, {String? shipmentId}) async { calls.add(shipmentId == null ? 'wa:$kind:$lang' : 'wa:$kind:$lang:$shipmentId'); _maybeThrow(); return waResult; }
  // per-parcel delivery: each call is recorded, may be failed via errorOnNext, and (like the server) moves the next stop to "current"
  @override
  Future<void> routeApprove(String offerId) async { calls.add('approve'); _maybeThrow(); }
  @override
  Future<void> arriveStop(String offerId, String stopId, {double? lat, double? lng}) async { calls.add('arrive:$stopId:$lat,$lng'); await gate?.future; _maybeThrow(); }
  @override
  Future<Json> deliverStop(String offerId, String stopId, {required String code, String? otp, String? proof, String? receiverName, String? signatureMediaId, int? cashCollectedCents, double? lat, double? lng}) async { calls.add('deliver:$stopId:$code:${otp ?? ''}:${proof ?? ''}:${receiverName ?? ''}${signatureMediaId != null ? ':sig=$signatureMediaId' : ''}${cashCollectedCents != null ? ':cash=$cashCollectedCents' : ''}'); await gate?.future; _maybeThrow(); return {}; }
  @override
  Future<Json> failStop(String offerId, String stopId, String reason, {String? note, String? mediaId, double? lat, double? lng}) async { calls.add('fail:$stopId:$reason:${note ?? ''}${mediaId != null ? ':media=$mediaId' : ''}'); await gate?.future; _maybeThrow(); return {}; }
  @override
  Future<Json> deferStop(String offerId, String stopId, {String? note, String? mediaId}) async { calls.add('defer:$stopId${note != null ? ':note=$note' : ''}${mediaId != null ? ':media=$mediaId' : ''}'); await gate?.future; _maybeThrow(); return {}; }
  @override
  Future<Json> resendCode(String offerId, String stopId) async { calls.add('resend:$stopId'); _maybeThrow(); return resendResult; }
  /// What `POST …/resend-code` answers (`{sent: false, smsOff: true}` while text messages are off).
  Json resendResult = {};
  @override
  Future<Json> uploadProof(String offerId, String stopId, String path, String filename, {void Function(double progress)? onProgress}) async { calls.add('proof:$stopId:$filename'); onProgress?.call(0.5); await gate?.future; _maybeThrow(); return {}; }
  @override
  Future<Json> endRoute(String offerId, String reason, {String? note}) async { calls.add('endRoute:$reason:${note ?? ''}'); _maybeThrow(); return {}; }
  @override
  Future<void> setAvailability(bool on) async { calls.add('avail:$on'); overviewResult = Overview({...overviewResult.j, 'availability': on ? 'available' : 'unavailable'}); }
  @override
  Future<void> clearLocation() async { calls.add('clearLocation'); }
  @override
  Future<void> sendLocation(double lat, double lng) async { calls.add('loc'); }
  /// The chat of the job: what `GET /offers/:id/messages` answers (a later `sendMessage` appends to it).
  List<Map<String, dynamic>> chatMessages = [];
  int messageFetches = 0;
  @override
  Future<List<Map<String, dynamic>>> messages(String offerId) async { messageFetches++; return [...chatMessages]; }
  @override
  Future<void> sendMessage(String offerId, String body) async { calls.add('send:$body'); _maybeThrow(); chatMessages = [...chatMessages, {'id': 'm${chatMessages.length + 1}', 'senderId': 'u1', 'body': body, 'createdAt': '2026-11-20T10:00:00Z'}]; }
  @override
  Future<List<Map<String, dynamic>>> opportunities() async => [];
  /// What `GET /driver/invites` answers: `{items, walletBlock}`.
  Json invitesResult = {'items': []};
  @override
  Future<Json> invites() async => invitesResult;
  @override
  Future<void> respondInvite(String id, bool accept) async { calls.add('invite:$id:$accept'); await gate?.future; _maybeThrow(); }
  @override
  Future<Json> apply(String requestId) async { calls.add('apply:$requestId'); _maybeThrow(); return {'id': 'o-$requestId'}; }
  /// Notification pages the fake server answers (index 0 = page 1); null = none.
  List<Json>? notificationPages;
  @override
  Future<Json> notifications({int page = 1}) async {
    calls.add('notifications:$page');
    final p = notificationPages;
    return p != null && page - 1 < p.length ? p[page - 1] : {'items': [], 'unread': 0};
  }
}

/// The legal endpoints answered from memory: one text per slug (markdown), a configurable error, and what `POST /legal/accept` answers.
class FakeLegalApi extends LegalApi {
  FakeLegalApi() : super(ApiClient(baseUrl: 'http://fake', tokens: MemoryTokenStore()));
  final calls = <String>[];
  Object? docError;
  Object? acceptError;
  bool builtin = false;
  /// What is still pending after an accept (the answer's `pending` list).
  List<Json> pendingAfter = const [];
  final bodies = <String, String>{
    'driver': '## Driver terms\n\nYou work as an independent driver.\n\n- Deliver every parcel you scan\n- Hand the **cash** to the warehouse\n\nSee the [privacy policy](/privacy) or [our site](https://example.com/terms).',
    'privacy': '## What we collect\n\nYour name, phone and location while you are online.\n\n1. Purpose\n2. Retention',
  };
  @override
  Future<LegalDoc> doc(String slug, String lang, {String? version}) async {
    calls.add('doc:$slug:$lang${version == null ? '' : ':$version'}');
    if (docError != null) throw docError!;
    return LegalDoc({'kind': slug, 'title': slug == 'privacy' ? 'Privacy policy ($lang)' : 'Driver terms ($lang)', 'version': '2.0', 'effectiveAt': '2026-11-01T00:00:00.000Z', 'builtin': builtin, 'body': bodies[slug] ?? ''});
  }
  @override
  Future<Json> accept(List<PendingLegal> items, String locale) async {
    calls.add('accept:${items.map((i) => '${i.kind}@${i.version}').join(',')}:$locale');
    if (acceptError != null) { final e = acceptError!; acceptError = null; throw e; }
    return {'ok': true, 'pending': pendingAfter};
  }
}

/// `GET /privacy/status` and friends from memory.
class FakePrivacyRepo extends PrivacyRepository {
  FakePrivacyRepo() : super(ApiClient(baseUrl: 'http://fake', tokens: MemoryTokenStore()));
  final calls = <String>[];
  Json statusJson = {
    'role': 'driver', 'export': {'available': true, 'lastAt': null},
    'deletion': {'supported': true, 'eligible': true, 'canRequest': true, 'blockers': [], 'request': null},
    'retention': {'notificationDays': 90, 'recipientPiiMonths': 24, 'closedAccountYears': 5}, 'contact': {'privacyEmail': 'privacy@jr.test', 'phone': null},
  };
  Object? statusError, exportError, deleteError, cancelError;
  Uint8List exportBytes = Uint8List.fromList(utf8.encode('{"profile":{"name":"Omar"}}'));
  @override
  Future<PrivacyStatus> status() async { calls.add('status'); if (statusError != null) throw statusError!; return PrivacyStatus(statusJson); }
  @override
  Future<Uint8List> exportData() async { calls.add('export'); await exportGate?.future; if (exportError != null) throw exportError!; return exportBytes; }
  Completer<void>? exportGate;
  @override
  Future<DeletionRequest> requestDeletion(String? reason) async {
    calls.add('delete:${reason?.trim() ?? ''}');
    if (deleteError != null) { final e = deleteError!; deleteError = null; throw e; }
    final req = {'id': 'pr1', 'status': 'requested', 'reason': reason, 'requestedAt': '2026-11-22T09:00:00.000Z'};
    statusJson = {...statusJson, 'deletion': {...(statusJson['deletion'] as Map).cast<String, dynamic>(), 'canRequest': false, 'request': req}};
    return DeletionRequest(req);
  }
  @override
  Future<DeletionRequest> cancelDeletion() async {
    calls.add('cancel');
    if (cancelError != null) { final e = cancelError!; cancelError = null; throw e; }
    statusJson = {...statusJson, 'deletion': {...(statusJson['deletion'] as Map).cast<String, dynamic>(), 'canRequest': true, 'request': {'id': 'pr1', 'status': 'cancelled'}}};
    return DeletionRequest(const {'id': 'pr1', 'status': 'cancelled'});
  }
}

/// The share sheet: remembers what would have been shared.
class FakeSharer implements FileSharer {
  final shared = <({String filename, String mime, int bytes, String? subject})>[];
  Uint8List? lastBytes;
  bool succeed = true;
  @override
  Future<bool> shareFile({required Uint8List bytes, required String filename, required String mime, String? subject, Rect? origin}) async { lastBytes = bytes; shared.add((filename: filename, mime: mime, bytes: bytes.length, subject: subject)); return succeed; }
}

class FakeLinks implements LinkOpener {
  final opened = <Uri>[];
  final called = <String>[];
  bool succeed = true;
  @override
  Future<bool> open(Uri uri) async { opened.add(uri); return succeed; }
  @override
  Future<bool> call(String phone) async { called.add(phone); return succeed; }
  int settingsOpened = 0;
  @override
  Future<bool> openAppSettings() async { settingsOpened++; return true; }
}

class FakePhotos implements PhotoPicker {
  PickedPhoto? next = (path: '/tmp/receipt.jpg', name: 'receipt.jpg');
  PhotoException? failWith;
  int taken = 0;
  @override
  Future<PickedPhoto?> takePhoto() async { taken++; if (failWith != null) throw failWith!; return next; }
}

class FakeLocation implements LocationService {
  FakeLocation({this.granted = true, this.pos = const (lat: 24.7, lng: 46.7), this.grantOnRequest = false});
  bool granted;
  LatLng? pos;
  /// The driver says "Allow" when the OS permission dialog appears.
  bool grantOnRequest;
  int permissionRequests = 0;
  @override
  Future<bool> hasPermission() async => granted;
  @override
  Future<bool> requestPermission() async { permissionRequests++; if (grantOnRequest) granted = true; return granted; }
  @override
  Future<LatLng?> current() async => granted ? pos : null;
}

/// A "camera" that sees the codes queued in [queue]. One-shot mode returns the next one; continuous mode feeds every queued code to the caller's handler (like the real page does).
class FakeBarcodeScanner implements BarcodeScanner {
  final queue = <String>[];
  final opened = <({String? title, bool continuous})>[];
  final verdicts = <ScanVerdict>[];
  @override
  Future<String?> scan(BuildContext context, {String? title, bool continuous = false, ScanHandler? onCode}) async {
    opened.add((title: title, continuous: continuous));
    if (!continuous) return queue.isEmpty ? null : queue.removeAt(0);
    String? last;
    while (queue.isNotEmpty) {
      final c = queue.removeAt(0);
      final v = await onCode?.call(c) ?? const ScanVerdict(true);
      verdicts.add(v);
      if (v.ok) last = c;
    }
    return last;
  }
}

/// Camera / gallery for evidence photos.
class FakeEvidencePhotos implements EvidencePhotos {
  PickedPhoto? next = (path: '/tmp/evidence.jpg', name: 'evidence.jpg');
  PhotoException? failWith;
  final sources = <ImageSource>[];
  @override
  Future<PickedPhoto?> pick(ImageSource source) async { sources.add(source); if (failWith != null) throw failWith!; return next; }
}

Job mkJob({String status = 'accepted', String service = 'delivery_driver', List<String>? actions, Json? extra}) => Job({
      'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'service': service, 'status': status, 'requestStatus': 'assigned', 'isReplacement': false, 'business': 'Nakheel Fresh Foods',
      'vehicleType': 'sedan', 'temperature': null, 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'startsAt': '2026-12-01T06:00:00.000Z', 'durationDays': 1, 'expectedUnits': 20,
      'shipmentsPerDriver': 20, 'expectedEarningCents': 11000, 'earningHidden': false, 'notes': null, 'contents': 'Groceries',
      'pickup': {'address': 'Olaya St', 'lat': null, 'lng': null}, 'delivery': {'address': 'King Fahd Rd 120', 'lat': 24.7, 'lng': 46.7},
      'recipient': {'name': 'Mona', 'phone': '+966555555555'}, 'loadedUnits': null, 'loadedAckByDriver': null, 'deliveredUnits': null, 'finalUnits': null, 'actions': actions ?? ['checkin', 'cancel'], ...?extra,
    });

Json mkStop(int n, {String status = 'loaded', bool current = false, String type = 'consumer', Json? extra}) => {
      'id': 's$n', 'seq': n, 'stopOrder': n, 'code': 'JR-000042-${n.toString().padLeft(3, '0')}', 'status': status, 'recipientType': type,
      'address': 'Street $n, Riyadh', 'city': 'riyadh', 'lat': null, 'lng': null, 'contents': 'Clothes $n', 'notes': null,
      'recipientName': current || status == 'delivered' || status == 'failed' ? 'Recipient $n' : null, 'recipientPhone': current ? '+96655500000$n' : null,
      'current': current, 'attempts': 0, 'deferCount': 0, 'canDefer': false, 'arrivedAt': null, 'waitRemainingSec': null,
      'proofMode': type == 'business' ? 'code_or_receipt' : 'code', 'hasProof': false, 'otpAttemptsLeft': 5, 'canResend': true, 'deliveredAt': null, 'failReason': null, 'failNote': null, ...?extra,
    };

/// A stop with a map position and a driving leg into it (what the server sends once the route is planned).
Json mkLegStop(int n, {bool current = false, String type = 'consumer', int legM = 4200, int legS = 720, String geoSource = 'given', Json? extra}) => mkStop(n, current: current, type: type, extra: {
      'located': true, 'lat': 24.70 + n / 100, 'lng': 46.60 + n / 100, 'geoSource': geoSource, 'legDistanceM': legM, 'legDurationS': legS, ...?extra,
    });

/// The `route` object of a planned manifest job (see memory/SHIPMENTS_API.md, Addendum D).
Json mkRoute({String? provider = 'google_routes', bool planned = true, bool canOptimize = true, List<String> warnings = const [], Json? extra}) => {
      'planned': planned, 'provider': provider, 'plannedAt': '2026-12-01T06:20:00.000Z', 'by': 'system', 'totalDistanceM': 24300, 'totalDurationS': 6720,
      'remainingDistanceM': 12000, 'remainingDurationS': 3100, 'chunks': 1, 'unlocated': 0, 'approximate': 0, 'warnings': warnings, 'googleConfigured': provider == 'google_routes', 'canOptimize': canOptimize, ...?extra,
    };

/// Field-ops additions to a job view (`ops`, `arrival`, `loading`, `policy`, `cod`) — pass them as `extra` of [mkJob] / [mkManifestJob].
Json mkOps({bool arrivalConfirm = true, bool loadingRecord = false, bool otp = true, bool signature = false}) => {'requireArrivalConfirmation': arrivalConfirm, 'requireLoadingRecord': loadingRecord, 'requireDeliveryOtp': otp, 'requireSignature': signature};
Json mkArrival({bool geofence = true, int radiusM = 200, double? lat = 24.7, double? lng = 46.6}) => {'geofence': geofence, 'radiusM': radiusM, 'warehouse': lat == null || lng == null ? null : {'lat': lat, 'lng': lng}};
Json mkLoading({String mode = 'driver_scan', int assigned = 0, int scanned = 0, bool finished = false}) => {'mode': mode, 'assigned': assigned, 'scanned': scanned, 'finished': finished};
Json mkPolicy({bool reorder = true, bool text = true, bool photo = true, int wait = 0, bool strict = false}) => {'canReorderRoute': reorder, 'rescheduleEvidenceText': text, 'rescheduleEvidencePhoto': photo, 'stopWaitMin': wait, 'failStrict': strict};
Json mkCod({int toCollect = 0, int collected = 0, int parcels = 0}) => {'toCollectCents': toCollect, 'collectedCents': collected, 'parcels': parcels};

/// A per-parcel job (manifest: true). `stops` default to 3 open stops; `delivery`/`recipient` are null like the server sends them.
Job mkManifestJob({String status = 'attendance_confirmed', List<String>? actions, List<Json>? stops, Json? summary, Json? extra}) {
  final st = stops ?? [mkStop(1, current: true), mkStop(2), mkStop(3)];
  int c(bool Function(Json) f) => st.where(f).length;
  return mkJob(status: status, actions: actions ?? ['work_stops', 'end_route'], extra: {
    'manifest': true, 'allowPartial': true, 'delivery': null, 'recipient': null, 'loadedUnits': st.length, 'loadedAckByDriver': true, 'routeApprovedAt': '2026-12-01T06:30:00.000Z', 'expectedUnits': st.length,
    'stops': st,
    'stopsSummary': summary ?? {'total': st.length, 'pending': 0, 'loaded': c((s) => s['status'] == 'loaded'), 'delivered': c((s) => s['status'] == 'delivered'), 'failed': c((s) => s['status'] == 'failed'), 'returned': 0, 'missing': 0},
    ...?extra,
  });
}

/// A job in loading-by-scanning mode: [total] parcels, those numbered in [scanned] are already on the vehicle.
Job scanJob({int total = 4, List<int> scanned = const [], List<String>? actions, Json? extra}) {
  final stops = [for (var n = 1; n <= total; n++) mkStop(n, status: scanned.contains(n) ? 'loaded' : 'pending')];
  return mkManifestJob(
    status: 'attendance_confirmed', actions: actions ?? ['scan_loading', if (scanned.isNotEmpty) 'finish_loading', 'report_no_work'], stops: stops,
    summary: {'total': total, 'pending': total - scanned.length, 'loaded': scanned.length, 'delivered': 0, 'failed': 0, 'returned': 0, 'missing': 0},
    extra: {'routeApprovedAt': null, 'loadedUnits': null, 'loadedAckByDriver': null, 'loading': mkLoading(assigned: total, scanned: scanned.length), ...?extra},
  );
}

void seedBook(FakeApi api, int total, {List<int> scanned = const []}) {
  for (var n = 1; n <= total; n++) {
    final code = 'JR-000042-${n.toString().padLeft(3, '0')}';
    final e = (id: 's$n', code: code, seq: n);
    api.scanBook[code] = e;
    api.scanBook['ORD-$n'] = e; // the warehouse order reference finds the same parcel
    if (scanned.contains(n)) api.scannedIds.add('s$n');
  }
}

/// The mode the screen helpers render in. Dark is the original look; suites that must hold in both modes loop over [Brightness.values]
/// and switch it with [useBrightness] (and back in a tearDown). The palette (`JR.*`) and the Material theme always move together.
Brightness testBrightness = Brightness.dark;
void useBrightness(Brightness b) { testBrightness = b; JR.use(b); }

/// Pumps [child] inside a themed, localized shell with the real dictionaries.
Future<void> pumpScreen(WidgetTester t, Widget child, {FakeLegalApi? legal, FakePrivacyRepo? privacy, FakeSharer? sharer, String lang = 'en', required FakeApi api, FakeLinks? links, LocationService? location, FakePhotos? photos, FakeBarcodeScanner? scanner, EvidencePhotos? evidence, List<Override> extra = const []}) async {
  JR.use(testBrightness);
  SharedPreferences.setMockInitialValues({'lang': lang, installMarkerKey: '1'}); // not a first launch of the install (a fresh one drops the stored token)
  final prefs = await SharedPreferences.getInstance();
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [
      prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
      linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(location ?? FakeLocation()), photoPickerProvider.overrideWithValue(photos ?? FakePhotos()),
      barcodeScannerProvider.overrideWithValue(scanner ?? FakeBarcodeScanner()), evidencePhotosProvider.overrideWithValue(evidence ?? FakeEvidencePhotos()),
      legalApiProvider.overrideWithValue(legal ?? FakeLegalApi()), privacyRepoProvider.overrideWithValue(privacy ?? FakePrivacyRepo()), fileSharerProvider.overrideWithValue(sharer ?? FakeSharer()),
      // the real signature encoder needs the engine's async image pipeline: tests get a tiny fixed PNG-like payload instead
      signatureExporterProvider.overrideWithValue((SignatureController c) async => c.hasSignature ? Uint8List.fromList(const [137, 80, 78, 71, 1, 2, 3]) : null),
      ...extra,
    ],
    child: MaterialApp(
      theme: buildTheme(testBrightness), locale: Locale(lang),
      builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: w!)),
      home: child,
    ),
  ));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}

/// Same as [pumpScreen] but inside a GoRouter, for screens that navigate (e.g. after accepting a job).
Future<void> pumpRouted(WidgetTester t, Widget child, {String lang = 'en', required FakeApi api, FakeLinks? links}) async {
  JR.use(testBrightness);
  SharedPreferences.setMockInitialValues({'lang': lang, installMarkerKey: '1'}); // not a first launch of the install (a fresh one drops the stored token)
  final prefs = await SharedPreferences.getInstance();
  t.view.physicalSize = const Size(900, 1900);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  final router = GoRouter(routes: [GoRoute(path: '/', builder: (_, _) => child), GoRoute(path: '/job/:id', builder: (_, s) => Scaffold(body: Center(child: Text('JOB-PAGE-${s.pathParameters['id']}'))))]);
  await t.pumpWidget(ProviderScope(
    retry: (_, _) => null,
    overrides: [prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(MemoryTokenStore()), linkOpenerProvider.overrideWithValue(links ?? FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation()), legalApiProvider.overrideWithValue(FakeLegalApi())],
    child: MaterialApp.router(
      theme: buildTheme(testBrightness), locale: Locale(lang), routerConfig: router,
      builder: (c, w) => Directionality(textDirection: isRtl(lang) ? TextDirection.rtl : TextDirection.ltr, child: StringsScope(strings: strings(lang), child: w!)),
    ),
  ));
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}
