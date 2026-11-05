import 'package:dio/dio.dart';
import 'api_client.dart';
import 'models.dart';

/// Every call the driver app makes — one place, one contract with the Next.js API.
class DriverApi {
  DriverApi(this.c);
  final ApiClient c;

  // auth
  Future<Json> sendOtp(String phone) => c.post('/auth/otp/send', {'phone': phone});
  Future<Json> verifyOtp(String phone, String code) => c.post('/auth/otp/verify', {'phone': phone, 'code': code});
  Future<Json> register(Json body) => c.post('/auth/register', body);
  Future<Json> me() => c.get('/auth/me');
  Future<void> logout() async { try { await c.post('/auth/logout'); } catch (_) {} }
  Future<Json> catalog() => c.get('/catalog');
  Future<Json> updateProfile(Json body) => c.patch('/profile', body);

  // dashboard
  Future<Overview> overview() async => Overview(await c.get('/driver/overview'));
  Future<void> setAvailability(bool on) => c.put('/driver/availability', {'available': on});
  Future<void> sendLocation(double lat, double lng) => c.post('/driver/location', {'lat': lat, 'lng': lng});
  Future<void> clearLocation() async => c.dio.delete('/driver/location');

  // jobs
  Future<List<Job>> offers() async => _jobs(await c.get('/driver/offers'));
  Future<List<Job>> jobs({required bool active}) async => _jobs(await c.get('/driver/jobs', query: {'scope': active ? 'active' : 'history'}));
  Future<Job> job(String offerId) async => Job(await c.get('/driver/jobs/$offerId'));
  Future<List<Json>> opportunities() async => ((await c.get('/driver/opportunities'))['items'] as List).cast<Json>();
  Future<Json> accept(String offerId) => c.post('/offers/$offerId/accept', {'termsAccepted': true});
  Future<Json> apply(String requestId) => c.post('/driver/requests/$requestId/apply', {'termsAccepted': true});
  Future<void> reject(String offerId) async => c.post('/offers/$offerId/reject');
  Future<void> checkIn(String offerId, {double? lat, double? lng}) async => c.post('/offers/$offerId/checkin', {'lat': ?lat, 'lng': ?lng});
  Future<void> ackLoading(String offerId, bool ok, {String? note}) async => c.post('/offers/$offerId/loading-ack', {'ok': ok, 'note': ?note});
  Future<void> delivered(String offerId, int units) async => c.post('/offers/$offerId/delivered', {'units': units});
  Future<Json> cancel(String offerId, String reason) => c.post('/offers/$offerId/cancel', {'reason': reason});
  Future<void> reportNoWork(String offerId, String? note) async => c.post('/offers/$offerId/no-work', {'note': ?note});
  Future<void> contactException(String offerId, String reason, {String? note}) async => c.post('/driver/jobs/$offerId/contact-exception', {'reason': reason, 'note': ?note});
  Future<Json> whatsapp(String offerId, String kind, String lang) => c.get('/driver/jobs/$offerId/whatsapp', query: {'kind': kind, 'lang': lang});
  Future<RoutePlan> optimizeRoute(double lat, double lng, List<String> offerIds) async => RoutePlan(await c.post('/driver/route/optimize', {'origin': {'lat': lat, 'lng': lng}, 'offerIds': offerIds}));
  Future<List<Json>> messages(String offerId) async => ((await c.get('/offers/$offerId/messages'))['items'] as List).cast<Json>();
  Future<void> sendMessage(String offerId, String body) async => c.post('/offers/$offerId/messages', {'body': body});
  Future<List<Json>> timeline(String offerId) async => ((await c.get('/offers/$offerId/timeline'))['items'] as List).cast<Json>();

  // money
  Future<Json> wallet() => c.get('/wallet');
  Future<List<Json>> withdrawals() async => ((await c.get('/withdrawals'))['items'] as List).cast<Json>();
  Future<Json> requestWithdrawal(int cents) => c.post('/withdrawals', {'amountCents': cents});

  // docs & notifications
  Future<List<Json>> documents() async => ((await c.get('/documents'))['items'] as List).cast<Json>();
  Future<Json> uploadDocument(String type, String path, String filename, {String? expiresOn}) async {
    final form = FormData.fromMap({'type': type, 'expiresOn': ?expiresOn, 'file': await MultipartFile.fromFile(path, filename: filename, contentType: DioMediaType.parse(_mime(filename)))});
    return c.postForm('/documents', form);
  }
  Future<Json> notifications() => c.get('/notifications');
  Future<void> markNotificationsRead() async => c.post('/notifications/read');
  Future<Json> invites() => c.get('/driver/invites');
  Future<void> respondInvite(String id, bool accept) async => c.post('/driver/invites/$id/respond', {'accept': accept});

  List<Job> _jobs(Json r) => (r['items'] as List).map((e) => Job((e as Map).cast<String, dynamic>())).toList();
  static String _mime(String f) => f.toLowerCase().endsWith('.png') ? 'image/png' : f.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}
