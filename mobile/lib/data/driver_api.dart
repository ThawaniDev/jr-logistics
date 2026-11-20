import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'api_client.dart';
import 'models.dart';

/// Every call the driver app makes — one place, one contract with the Next.js API.
class DriverApi {
  DriverApi(this.c);
  final ApiClient c;

  // auth
  /// Username + password sign-in (every role; this app accepts drivers only). Answer `{token, user}`; `user.mustChangePassword` sends the driver to
  /// "choose a new password". Errors: `401 UNAUTHENTICATED` (wrong credentials), `429 RATE_LIMITED` (too many attempts / locked), `403 FORBIDDEN` (suspended).
  Future<Json> login(String username, String password) => c.post('/auth/login', {'username': username, 'password': password});
  /// `{available, reason?: taken|invalid|reserved}` — public, rate limited.
  Future<Json> usernameAvailable(String username) => c.get('/auth/username-available', query: {'username': username});
  /// No OTP: `{role: 'driver', username, password, name, phone, …profile, termsAccepted}` -> `{token, user}`. `409 CONFLICT details.field` = username | phone | email.
  Future<Json> register(Json body) => c.post('/auth/register', body);
  /// `401 UNAUTHENTICATED` = the current password is wrong; `422 VALIDATION field=newPassword` = rule not met. The server may revoke the sessions, so see `changePasswordAndContinue`.
  Future<Json> changePassword(String currentPassword, String newPassword) => c.post('/auth/change-password', {'currentPassword': currentPassword, 'newPassword': newPassword});
  Future<Json> me() => c.get('/auth/me');
  Future<void> logout() async { try { await c.post('/auth/logout'); } catch (_) {} }
  Future<Json> catalog() => c.get('/catalog');
  Future<Json> profile() => c.get('/profile');
  Future<Json> updateProfile(Json body) => c.patch('/profile', body);

  // dashboard
  Future<Overview> overview() async => Overview(await c.get('/driver/overview'));
  Future<void> setAvailability(bool on) => c.put('/driver/availability', {'available': on});
  Future<void> sendLocation(double lat, double lng) => c.post('/driver/location', {'lat': lat, 'lng': lng});
  Future<void> clearLocation() async { await c.delete('/driver/location'); }

  // jobs
  Future<List<Job>> offers() async => _jobs(await c.get('/driver/offers'));
  Future<List<Job>> jobs({required bool active}) async => _jobs(await c.get('/driver/jobs', query: {'scope': active ? 'active' : 'history'}));
  Future<Job> job(String offerId) async => Job(await c.get('/driver/jobs/$offerId'));
  Future<List<Json>> opportunities() async => _items(await c.get('/driver/opportunities'));
  Future<Json> accept(String offerId) => c.post('/offers/$offerId/accept', {'termsAccepted': true});
  Future<Json> apply(String requestId) => c.post('/driver/requests/$requestId/apply', {'termsAccepted': true});
  Future<void> reject(String offerId) async => c.post('/offers/$offerId/reject');
  /// "I've arrived at the warehouse". With the geofence on, [lat]/[lng] are required (`422 LOCATION_REQUIRED`, `422 TOO_FAR_FROM_WAREHOUSE {distanceM, radiusM}`).
  /// The answer is the offer: `status` is `arrived`, or `attendance_confirmed` straight away when the warehouse does not need to confirm arrivals.
  Future<Json> checkIn(String offerId, {double? lat, double? lng}) => c.post('/offers/$offerId/checkin', {'lat': ?lat, 'lng': ?lng});
  // loading by scanning (driver_scan mode)
  /// [code] = parcel code, warehouse order reference or manifest number. `VALIDATION field=code` = not in your load; `DETAILS_INCOMPLETE`; `INVALID_TRANSITION`.
  Future<LoadingScanResult> loadingScan(String offerId, String code) async => LoadingScanResult(await c.post('/offers/$offerId/loading/scan', {'code': code}));
  /// Undo a mistaken scan (only before finishing).
  Future<Json> loadingUnscan(String offerId, String code) => c.post('/offers/$offerId/loading/unscan', {'code': code});
  /// Needs at least one scanned parcel. Unscanned parcels go back to the warehouse pool and the route is planned; the answer carries the fresh job.
  Future<LoadingFinishResult> loadingFinish(String offerId) async => LoadingFinishResult(await c.post('/offers/$offerId/loading/finish', {}, const Duration(seconds: 60)));
  Future<void> ackLoading(String offerId, bool ok, {String? note}) async => c.post('/offers/$offerId/loading-ack', {'ok': ok, 'note': ?note});
  /// Legacy (count) jobs send the typed quantity; per-parcel jobs send `{}` — the server counts the delivered parcels itself.
  Future<void> delivered(String offerId, [int? units]) async => c.post('/offers/$offerId/delivered', {'units': ?units});
  Future<Json> cancel(String offerId, String reason) => c.post('/offers/$offerId/cancel', {'reason': reason});
  Future<void> reportNoWork(String offerId, String? note) async => c.post('/offers/$offerId/no-work', {'note': ?note});
  Future<void> contactException(String offerId, String reason, {String? note}) async => c.post('/driver/jobs/$offerId/contact-exception', {'reason': reason, 'note': ?note});
  Future<void> rate(String offerId, int stars, {String? comment}) async => c.post('/offers/$offerId/rate', {'stars': stars, 'comment': ?comment});
  Future<List<Json>> custody(String offerId) async => _items(await c.get('/offers/$offerId/custody'));
  Future<void> acknowledgeCustody(String itemId) async => c.post('/custody/$itemId/acknowledge');
  /// [shipmentId] = the CURRENT stop of a per-parcel job (the server only allows contacting that recipient).
  Future<Json> whatsapp(String offerId, String kind, String lang, {String? shipmentId}) => c.get('/driver/jobs/$offerId/whatsapp', query: {'kind': kind, 'lang': lang, 'shipmentId': ?shipmentId});

  // per-parcel delivery — one stop at a time (the server refuses any action on a non-current stop with STOP_LOCKED)
  Future<void> routeApprove(String offerId) async => c.post('/offers/$offerId/route/approve');
  /// Plans the best order of the parcels still on board (traffic-aware, Google Routes), before AND after approval. [lat]/[lng] = where the
  /// driver is (both or neither; without them the server starts from the pickup, or from the stop being served). A repeat with the same inputs is
  /// `cached` (free); a real re-plan is limited per job (429 RATE_LIMITED); 409 CONFLICT = the parcels changed meanwhile (retry).
  /// Planning calls Google several times for a big route, so this waits longer than a normal request.
  Future<RouteOptimizeResult> optimizeRoute(String offerId, {double? lat, double? lng}) async {
    final both = lat != null && lng != null;
    return RouteOptimizeResult(await c.post('/offers/$offerId/route/optimize', {if (both) 'lat': lat, if (both) 'lng': lng}, const Duration(seconds: 60)));
  }
  Future<void> arriveStop(String offerId, String stopId, {double? lat, double? lng}) async => c.post('/offers/$offerId/stops/$stopId/arrive', {'lat': ?lat, 'lng': ?lng});
  /// [code] = typed/pasted parcel code. Then either [otp] (the recipient's 4 digits) or, for business stops, [proof] = 'receipt' + [receiverName] after [uploadProof].
  /// [signatureMediaId] = a `signature` upload ([uploadStopMedia]) when the warehouse wants one (`SIGNATURE_REQUIRED`); [cashCollectedCents] must equal the stop's
  /// `codCents` (`CASH_MISMATCH {expectedCents}`). [otp] is omitted when the warehouse does not use delivery codes (`needsOtp == false`).
  Future<Json> deliverStop(String offerId, String stopId, {required String code, String? otp, String? proof, String? receiverName, String? signatureMediaId, int? cashCollectedCents, double? lat, double? lng}) =>
      c.post('/offers/$offerId/stops/$stopId/deliver', {'code': code, 'otp': ?otp, 'proof': ?proof, 'receiverName': ?receiverName, 'signatureMediaId': ?signatureMediaId, 'cashCollectedCents': ?cashCollectedCents, 'lat': ?lat, 'lng': ?lng});
  /// Every reason is accepted at any time unless the platform is strict (`policy.failStrict`). [mediaId] = an optional `fail` photo.
  Future<Json> failStop(String offerId, String stopId, String reason, {String? note, String? mediaId, double? lat, double? lng}) => c.post('/offers/$offerId/stops/$stopId/fail', {'reason': reason, 'note': ?note, 'mediaId': ?mediaId, 'lat': ?lat, 'lng': ?lng});
  /// Postpone once. The platform may require [note] and/or a `defer` photo ([mediaId]) as evidence: `422 EVIDENCE_REQUIRED {note, photo}` says which is missing.
  Future<Json> deferStop(String offerId, String stopId, {String? note, String? mediaId}) => c.post('/offers/$offerId/stops/$stopId/defer', {'note': ?note, 'mediaId': ?mediaId});
  /// Uploads evidence for the CURRENT stop: [kind] = `defer` | `fail` | `signature`. Give a file [path] (camera/gallery photo) or in-memory [bytes] (the signature PNG).
  /// Answer `{id, kind}`: pass `id` as `mediaId` / `signatureMediaId` to the next action. A weak signal gets a long send window and progress.
  Future<Json> uploadStopMedia(String offerId, String stopId, {required String kind, String? path, Uint8List? bytes, required String filename, void Function(double progress)? onProgress}) async {
    assert(path != null || bytes != null, 'a file path or bytes is required');
    final ct = DioMediaType.parse(_mime(filename));
    final file = bytes != null ? MultipartFile.fromBytes(bytes, filename: filename, contentType: ct) : await MultipartFile.fromFile(path!, filename: filename, contentType: ct);
    return c.postForm('/offers/$offerId/stops/$stopId/media', FormData.fromMap({'kind': kind, 'file': file}), onProgress: onProgress);
  }
  /// Manual stop order (E5): [order] = ids of the not-yet-resolved, not-pinned stops in the wanted visiting order (the stop the driver has arrived at is pinned first and is NOT in it).
  /// `403 FEATURE_DISABLED`, `422 VALIDATION field=order`, `409 INVALID_TRANSITION`. The answer carries the fresh job like [optimizeRoute].
  Future<RouteOptimizeResult> routeReorder(String offerId, List<String> order) async => RouteOptimizeResult(await c.post('/offers/$offerId/route/reorder', {'order': order}, const Duration(seconds: 30)));
  Future<Json> resendCode(String offerId, String stopId) => c.post('/offers/$offerId/stops/$stopId/resend-code');
  /// [onProgress] gets 0..1 while the photo is being sent (poor networks: the driver must see it moving, and can retry).
  Future<Json> uploadProof(String offerId, String stopId, String path, String filename, {void Function(double progress)? onProgress}) async {
    final form = FormData.fromMap({'file': await MultipartFile.fromFile(path, filename: filename, contentType: DioMediaType.parse(_mime(filename)))});
    return c.postForm('/offers/$offerId/stops/$stopId/proof', form, onProgress: onProgress);
  }
  Future<Json> endRoute(String offerId, String reason, {String? note}) => c.post('/offers/$offerId/end-route', {'reason': reason, 'note': ?note});
  Future<List<Json>> messages(String offerId) async => _items(await c.get('/offers/$offerId/messages'));
  Future<void> sendMessage(String offerId, String body) async => c.post('/offers/$offerId/messages', {'body': body});
  Future<List<Json>> timeline(String offerId) async => _items(await c.get('/offers/$offerId/timeline'));

  // money
  Future<Json> wallet() => c.get('/wallet');
  Future<List<Json>> withdrawals() async => _items(await c.get('/withdrawals'));
  Future<Json> requestWithdrawal(int cents) => c.post('/withdrawals', {'amountCents': cents});

  // docs & notifications
  Future<List<Json>> documents() async => _items(await c.get('/documents'));
  Future<Json> uploadDocument(String type, String path, String filename, {String? expiresOn, void Function(double progress)? onProgress}) async {
    final form = FormData.fromMap({'type': type, 'expiresOn': ?expiresOn, 'file': await MultipartFile.fromFile(path, filename: filename, contentType: DioMediaType.parse(_mime(filename)))});
    return c.postForm('/documents', form, onProgress: onProgress);
  }
  Future<Json> notifications() => c.get('/notifications');
  Future<void> markNotificationsRead() async => c.post('/notifications/read');
  Future<Json> invites() => c.get('/driver/invites');
  Future<void> respondInvite(String id, bool accept) async => c.post('/driver/invites/$id/respond', {'accept': accept});

  /// Tolerant list parsing: a missing `items` is an empty list and non-object entries are skipped (a new/odd server row never blanks the screen).
  static List<Json> _items(Json r) {
    final raw = r['items'];
    return raw is List ? [for (final e in raw) if (e is Map) e.cast<String, dynamic>()] : const [];
  }
  List<Job> _jobs(Json r) => [for (final e in _items(r)) if (e['offerId'] != null) Job(e)];
  static String _mime(String f) => f.toLowerCase().endsWith('.png') ? 'image/png' : f.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}
