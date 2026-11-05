@Tags(['live'])
library;

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';

/// Runs the real Dart client against a real Next.js server + Postgres (see tool/live_test.sh).
/// Skipped unless JR_API is set, so `flutter test` stays hermetic by default.
final base = Platform.environment['JR_API'];

class Session {
  Session(this.client, this.api, this.tokens);
  final ApiClient client;
  final DriverApi api;
  final TokenStore tokens;
}

Future<Session> login(String phone) async {
  final tokens = MemoryTokenStore();
  final client = ApiClient(baseUrl: base!, tokens: tokens);
  final api = DriverApi(client);
  final sent = await api.sendOtp(phone);
  final v = await api.verifyOtp(phone, sent['demoCode'] as String);
  await tokens.write(v['token'] as String);
  return Session(client, api, tokens);
}

Map<String, dynamic> requestBody({required DateTime startsAt, int shipments = 20, String address = 'King Fahd Rd 120', double lat = 24.7, double lng = 46.7}) => {
      'service': 'delivery_driver', 'quantity': 1, 'shipmentsPerDriver': shipments, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh',
      'pickupAddress': 'Olaya St', 'deliveryAddress': address, 'deliveryLat': lat, 'deliveryLng': lng, 'recipientName': 'Mona', 'recipientPhone': '0555555555',
      'startsAt': startsAt.toUtc().toIso8601String(), 'durationDays': 1, 'publish': true, 'termsAccepted': true,
    };

void main() {
  final skip = base == null ? 'set JR_API (e.g. http://localhost:3100) to run live tests' : null;

  late Session biz;
  late Session drv;

  setUpAll(() async {
    if (base == null) return;
    biz = await login('0500000001'); // seeded verified business with demo wallet
    drv = await login('0500000011'); // seeded verified direct driver (sedan)
  });

  test('driver completes the full job lifecycle and money is exact', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(hours: 1))));
    final requestId = r['id'] as String;

    final ov0 = await drv.api.overview();
    expect(ov0.verified, isTrue);
    await drv.api.setAvailability(true);

    final offers = await drv.api.offers();
    final job = offers.firstWhere((j) => j.requestId == requestId);
    expect(job.status, 'offered');
    expect(job.recipient, isNull, reason: 'recipient contact is hidden before acceptance');
    expect(job.delivery, isNull);
    expect(job.expectedEarningCents, 550 * 20, reason: 'provider cost 5.50 SAR (550 halalas) × 20 shipments');
    expect(job.can('accept'), isTrue);

    await drv.api.accept(job.offerId);
    var j = await drv.api.job(job.offerId);
    expect(j.status, 'accepted');
    expect(j.recipient?['name'], 'Mona');
    expect(j.deliveryAddress, 'King Fahd Rd 120');
    expect(j.actions, containsAll(['checkin', 'cancel']));

    await drv.api.checkIn(job.offerId, lat: 24.71, lng: 46.68);
    j = await drv.api.job(job.offerId);
    expect(j.status, 'arrived');

    await biz.client.post('/offers/${job.offerId}/attendance', {'present': true});
    await biz.client.post('/offers/${job.offerId}/loading', {'units': 20});
    j = await drv.api.job(job.offerId);
    expect(j.status, 'attendance_confirmed');
    expect(j.awaitingLoadingAck, isTrue);
    expect(j.actions, contains('ack_loading'));
    expect(j.actions, isNot(contains('report_delivered')), reason: 'cannot report delivery before confirming loading');

    await expectLater(drv.api.delivered(job.offerId, 18), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INVALID_TRANSITION')));
    await drv.api.ackLoading(job.offerId, true);
    await expectLater(drv.api.delivered(job.offerId, 25), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION')), reason: 'cannot deliver more than loaded');
    await drv.api.delivered(job.offerId, 18);

    await biz.client.post('/offers/${job.offerId}/delivery-decision', {'action': 'confirm'});
    j = await drv.api.job(job.offerId);
    expect(j.status, 'completed');
    expect(j.finalUnits, 18);

    final ov = await drv.api.overview();
    expect(ov.pendingCents, greaterThanOrEqualTo(550 * 18), reason: 'settlement = provider cost 5.50 SAR × 18 delivered');
    final hist = await drv.api.jobs(active: false);
    expect(hist.any((x) => x.offerId == job.offerId), isTrue);
  });

  test('WhatsApp hand-off, chat, contact exception, and privacy rules', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 4)), address: 'Chat St 5'));
    final job = (await drv.api.offers()).firstWhere((j) => j.requestId == r['id']);
    await expectLater(drv.api.whatsapp(job.offerId, 'contact', 'en'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FORBIDDEN')), reason: 'no contact before acceptance');
    await drv.api.accept(job.offerId);

    final wa = await drv.api.whatsapp(job.offerId, 'arriving', 'ar');
    expect(wa['url'], startsWith('https://wa.me/966555555555?text='));
    expect(Uri.decodeComponent((wa['url'] as String).split('text=').last), wa['text']);
    expect(wa['text'], contains('JR-'));
    expect(wa['note'], contains('must press send'));

    await drv.api.contactException(job.offerId, 'no_answer', note: 'rang 3 times');
    final tl = await drv.api.timeline(job.offerId);
    expect(tl.map((e) => e['type']), containsAll(['whatsapp_handoff_opened', 'contact_exception']));

    await drv.api.sendMessage(job.offerId, 'On my way');
    await biz.client.post('/offers/${job.offerId}/messages', {'body': 'Thanks!'});
    final msgs = await drv.api.messages(job.offerId);
    expect(msgs.map((m) => m['body']), ['On my way', 'Thanks!']);

    // cancel with reason frees the slot; replacement logic handled server-side
    final cancel = await drv.api.cancel(job.offerId, 'testing cancellation');
    expect((cancel['offer'] as Map)['status'], 'cancelled');
  });

  test('route optimization returns an honest, ordered plan for the driver\'s own jobs', skip: skip, () async {
    final a = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 8)), address: 'Far Stop', lat: 24.95, lng: 46.9));
    final b = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 10)), address: 'Near Stop', lat: 24.72, lng: 46.68));
    final offers = await drv.api.offers();
    final ja = offers.firstWhere((j) => j.requestId == a['id']);
    final jb = offers.firstWhere((j) => j.requestId == b['id']);
    await drv.api.accept(ja.offerId);
    await drv.api.accept(jb.offerId);

    final plan = await drv.api.optimizeRoute(24.7136, 46.6753, [ja.offerId, jb.offerId]);
    expect(plan.order.toSet(), {ja.offerId, jb.offerId});
    expect(plan.order.first, jb.offerId, reason: 'nearest stop first for the heuristic');
    expect(plan.isGoogle, isFalse);
    expect(plan.warning, isNotNull, reason: 'no Google key configured → explicit warning, never silently pretending');
    expect(plan.legs.length, 2);
    expect(plan.totalDistanceM, greaterThan(0));

    // other drivers' jobs can't be routed
    final other = await login('0500000014');
    await expectLater(other.api.optimizeRoute(24.7, 46.7, [ja.offerId]), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NOT_FOUND')));
    await expectLater(other.api.job(ja.offerId), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NOT_FOUND')));

    await drv.api.cancel(ja.offerId, 'cleanup a');
    await drv.api.cancel(jb.offerId, 'cleanup b');
  });

  test('availability, location privacy and money guards', skip: skip, () async {
    await drv.api.setAvailability(true);
    await drv.api.sendLocation(24.7, 46.7);
    await drv.api.setAvailability(false);
    await drv.api.clearLocation();
    await expectLater(drv.api.sendLocation(24.7, 46.7), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INVALID_TRANSITION')), reason: 'no location sharing while offline');
    await expectLater(drv.api.sendLocation(999, 46.7), throwsA(isA<ApiException>()));

    await expectLater(drv.api.requestWithdrawal(100), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION')), reason: 'below minimum');
    await expectLater(drv.api.requestWithdrawal(999999999), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'INSUFFICIENT_FUNDS')));
    final w = await drv.api.wallet();
    expect(w['availableCents'], isA<num>());
    // business accounts cannot use driver endpoints
    await expectLater(biz.api.overview(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FORBIDDEN')));
  });

  test('office-linked drivers never see rates or withdraw', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 14))));
    final office = await login('0500000015'); // Bilal, linked to the demo office
    final job = (await office.api.offers()).firstWhere((j) => j.requestId == r['id']);
    expect(job.earningHidden, isTrue);
    expect(job.expectedEarningCents, isNull);
    await expectLater(office.api.requestWithdrawal(20000), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FORBIDDEN')));
    await biz.client.post('/requests/${r['id']}/cancel', {'reason': 'cleanup'});
  });

  test('registration validates vehicle/temperature and returns a working session; logout revokes it', skip: skip, () async {
    final phone = '05${DateTime.now().millisecondsSinceEpoch.toString().substring(5, 13)}';
    final tokens = MemoryTokenStore();
    final api = DriverApi(ApiClient(baseUrl: base!, tokens: tokens));
    final sent = await api.sendOtp(phone);
    final v = await api.verifyOtp(phone, sent['demoCode'] as String);
    expect(v['isNew'], isTrue);
    final body = {'registrationToken': v['registrationToken'], 'role': 'driver', 'name': 'Flutter Test Driver', 'city': 'riyadh', 'vehicleType': 'van', 'services': ['delivery_driver'], 'termsAccepted': true};
    await expectLater(api.register(body), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION').having((e) => e.details.containsKey('vehicleTemperature'), 'field', true)));
    await expectLater(api.register({...body, 'vehicleTemperature': 'cold', 'termsAccepted': false}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TERMS_REQUIRED')));
    final ok = await api.register({...body, 'vehicleTemperature': 'cold'});
    await tokens.write(ok['token'] as String);
    final ov = await api.overview();
    expect(ov.verified, isFalse);
    expect(ov.verification, 'pending');
    final cat = await api.catalog();
    expect(cat['policy'], isA<Map>());
    expect(((cat['documents'] as Map)['driver'] as List).length, 4);
    await api.logout();
    await expectLater(api.overview(), throwsA(isA<ApiException>().having((e) => e.isAuth, 'auth', true)));
  });
}
