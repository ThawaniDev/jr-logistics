@Tags(['live'])
library;

import 'dart:io';
import 'dart:convert';
import 'package:dio/dio.dart' show Options;
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/legal_markdown.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/extra_api.dart';
import 'package:jr_driver/data/legal_api.dart';
import 'package:jr_driver/data/privacy_repo.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/token_store.dart';
import 'live_login.dart';

/// Runs the real Dart client against a real Next.js server + Postgres (see tool/live_test.sh).
/// Skipped unless JR_API is set, so `flutter test` stays hermetic by default.
final base = Platform.environment['JR_API'];

class Session {
  Session(this.client, this.api, this.tokens);
  final ApiClient client;
  final DriverApi api;
  final TokenStore tokens;
}

/// Signs in as the seeded demo account with this phone — username + password (see live_login.dart).
Future<Session> login(String phone) async {
  final tokens = MemoryTokenStore();
  final client = await signedInClient(base!, phone, tokens: tokens);
  return Session(client, DriverApi(client), tokens);
}

/// A per-parcel (manifest) delivery request: one shipment per parcel — seq 1 consumer, seq 2 business, seq 3 consumer.
Map<String, dynamic> requestBody({required DateTime startsAt, int parcels = 3, int perDriver = 30}) => {
      'service': 'delivery_driver', 'shipmentsPerDriver': perDriver, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh',
      'pickupAddress': 'Olaya St', 'startsAt': startsAt.toUtc().toIso8601String(), 'durationDays': 1, 'publish': true, 'termsAccepted': true,
      'shipments': [
        for (var n = 1; n <= parcels; n++) {
          'recipientType': n == 2 ? 'business' : 'consumer', 'recipientName': 'Recipient $n', 'recipientPhone': '05550000${n.toString().padLeft(2, '0')}',
          'address': 'Street $n, Riyadh', 'city': 'riyadh', 'contents': 'Parcel $n', 'externalRef': 'ORD-${DateTime.now().microsecondsSinceEpoch}-$n',
        },
      ],
    };

/// 1x1 transparent PNG — a valid receipt "photo" for the proof upload.
const _png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 252, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

Matcher apiError(String code) => throwsA(isA<ApiException>().having((e) => e.code, 'code', code));

void main() {
  final skip = base == null ? 'set JR_API (e.g. http://localhost:3100) to run live tests' : null;

  late Session biz;
  late Session drv;

  setUpAll(() async {
    if (base == null) return;
    biz = await login('0500000001'); // seeded verified business with demo wallet
    drv = await login('0500000011'); // seeded verified direct driver (sedan)
  });

  /// Business side of the hand-over: the warehouse hands over everything and the driver counts it.
  Future<Job> handOverAndApprove(String requestId, String offerId) async {
    await drv.api.checkIn(offerId, lat: 24.7136, lng: 46.6753);
    await biz.client.post('/offers/$offerId/attendance', {'present': true});
    await biz.client.post('/offers/$offerId/loading', {'all': true});
    var j = await drv.api.job(offerId);
    expect(j.status, 'attendance_confirmed');
    expect(j.manifest, isTrue);
    expect(j.actions, contains('ack_loading'));
    expect(j.actions, isNot(contains('report_delivered')), reason: 'cannot report delivery before confirming loading');
    expect(j.stops.length, j.handedOverCount);
    expect(j.stops.every((s) => s.recipientName == null && s.recipientPhone == null), isTrue, reason: 'names/phones are hidden until a stop is current');
    await expectLater(drv.api.routeApprove(offerId), apiError('INVALID_TRANSITION'), reason: 'loading must be acknowledged first');
    await drv.api.ackLoading(offerId, true);
    j = await drv.api.job(offerId);
    expect(j.actions, contains('approve_route'));
    await drv.api.routeApprove(offerId);
    j = await drv.api.job(offerId);
    expect(j.routeApproved, isTrue);
    expect(j.actions, containsAll(['work_stops', 'end_route']));
    return j;
  }

  /// The business-side demo code per shipment id (only returned in DEMO_MODE).
  Future<Map<String, String>> demoCodes(String requestId) async {
    final r = await biz.client.get('/requests/$requestId/shipments', query: {'pageSize': '200'});
    return {for (final i in (r['items'] as List).cast<Map>()) if (i['demoOtp'] != null) '${i['id']}': '${i['demoOtp']}'};
  }

  test('driver works a per-parcel route stop by stop (code, receipt photo, failure) and money is exact', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(hours: 1))));
    final requestId = r['id'] as String;

    final ov0 = await drv.api.overview();
    expect(ov0.verified, isTrue);
    await drv.api.setAvailability(true);

    final offers = await drv.api.offers();
    final job = offers.firstWhere((j) => j.requestId == requestId);
    expect(job.status, 'offered');
    expect(job.manifest, isTrue);
    expect(job.delivery, isNull, reason: 'per-parcel jobs have no single delivery address');
    expect(job.recipient, isNull);
    expect(job.expectedUnits, 3);
    expect(job.allowPartial, isTrue);
    expect(job.expectedEarningCents, 550 * 3, reason: 'provider cost 5.50 SAR (550 halalas) × 3 parcels');
    expect(job.can('accept'), isTrue);

    await drv.api.accept(job.offerId);
    var j = await drv.api.job(job.offerId);
    expect(j.status, 'accepted');
    expect(j.actions, containsAll(['checkin', 'cancel']));
    await expectLater(drv.api.whatsapp(job.offerId, 'contact', 'en'), apiError('NOT_FOUND'), reason: 'no single recipient on a per-parcel job');

    j = await handOverAndApprove(requestId, job.offerId);
    expect(j.stops.length, 3);
    final first = j.currentStop!;
    expect(first.recipientName, isNotNull);
    expect(first.recipientPhone, isNotNull);
    expect(j.stops.where((s) => s.current).length, 1);

    // one stop at a time: everything on a non-current stop is refused
    final other = j.stops.firstWhere((s) => !s.current);
    await expectLater(drv.api.arriveStop(job.offerId, other.id), apiError('STOP_LOCKED'));
    await expectLater(drv.api.whatsapp(job.offerId, 'contact', 'en', shipmentId: other.id), apiError('STOP_LOCKED'));
    await expectLater(drv.api.delivered(job.offerId), apiError('STOPS_PENDING'));
    final wa = await drv.api.whatsapp(job.offerId, 'contact', 'ar', shipmentId: first.id);
    expect(wa['url'], startsWith('https://wa.me/9665550000'));

    final codes = await demoCodes(requestId);
    expect(codes, isNotEmpty, reason: 'DEMO_MODE exposes demoOtp to the business side only');

    var delivered = 0, failed = 0;
    for (var guard = 0; guard < 5; guard++) {
      j = await drv.api.job(job.offerId);
      final cur = j.currentStop;
      if (cur == null) break;
      // cannot deliver before arriving
      await expectLater(drv.api.deliverStop(job.offerId, cur.id, code: cur.code, otp: codes[cur.id] ?? '0000'), apiError('INVALID_TRANSITION'));
      await drv.api.arriveStop(job.offerId, cur.id, lat: 24.7136, lng: 46.6753);
      if (cur.seq == 1) {
        await expectLater(drv.api.deliverStop(job.offerId, cur.id, code: 'WRONG-CODE', otp: codes[cur.id]), apiError('VALIDATION'), reason: 'the parcel code must match the current stop');
        await expectLater(drv.api.deliverStop(job.offerId, cur.id, code: cur.code), apiError('OTP_REQUIRED'));
        final wrong = codes[cur.id] == '0000' ? '1111' : '0000';
        await expectLater(drv.api.deliverStop(job.offerId, cur.id, code: cur.code, otp: wrong), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'OTP_INVALID').having((e) => e.details['attemptsLeft'], 'attemptsLeft', 4)));
        await drv.api.deliverStop(job.offerId, cur.id, code: cur.code, otp: codes[cur.id]);
        delivered++;
      } else if (cur.isBusiness) {
        expect(cur.allowsReceipt, isTrue);
        final f = File('${Directory.systemTemp.path}/jr_live_receipt.png')..writeAsBytesSync(_png);
        addTearDown(() { if (f.existsSync()) f.deleteSync(); });
        await drv.api.uploadProof(job.offerId, cur.id, f.path, 'receipt.png');
        await expectLater(drv.api.deliverStop(job.offerId, cur.id, code: cur.code, proof: 'receipt'), apiError('VALIDATION'), reason: 'receipt proof needs the receiver name');
        await drv.api.deliverStop(job.offerId, cur.id, code: cur.code, proof: 'receipt', receiverName: 'Khalid Store Manager');
        delivered++;
      } else {
        // every reason works at once now: no door timer, no note rule (decision E8 / E14)
        await drv.api.failStop(job.offerId, cur.id, 'wrong_address', note: 'No such building');
        failed++;
      }
    }
    expect((delivered, failed), (2, 1));

    j = await drv.api.job(job.offerId);
    expect(j.currentStop, isNull);
    expect(j.stopsSummary.delivered, 2);
    expect(j.stopsSummary.failed, 1);
    expect(j.actions, ['report_delivered']);

    await drv.api.delivered(job.offerId);
    j = await drv.api.job(job.offerId);
    expect(j.status, 'completed', reason: 'finishing the route confirms the delivery and pays — the warehouse confirms nothing (E16 / E18)');
    expect(j.deliveredUnits, 2, reason: 'the count comes from parcels with a valid proof, never typed');
    expect(j.finalUnits, 2);
    await expectLater(biz.client.post('/offers/${job.offerId}/delivery-decision', {'action': 'confirm'}), apiError('NOT_FOUND'), reason: 'the confirmation step no longer exists');
    // the refused parcel comes back to the warehouse afterwards; it never holds the money
    await biz.client.post('/offers/${job.offerId}/returns', {'all': true});

    final ov = await drv.api.overview();
    expect(ov.pendingCents, 0, reason: 'nothing waits for approval any more (E18)');
    final wallet = await drv.api.wallet();
    expect(wallet['availableCents'], greaterThanOrEqualTo(550 * 2), reason: 'paid at once: provider cost 5.50 SAR × 2 delivered parcels (failed attempts are not billed)');
    final hist = await drv.api.jobs(active: false);
    expect(hist.any((x) => x.offerId == job.offerId), isTrue);
  });

  test('postpone once, resend code, and end the route early (delivered stops stay paid)', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(hours: 2)), parcels: 3));
    final requestId = r['id'] as String;
    final job = (await drv.api.offers()).firstWhere((j) => j.requestId == requestId);
    await drv.api.accept(job.offerId);
    var j = await handOverAndApprove(requestId, job.offerId);

    final first = j.currentStop!;
    expect(first.canDefer, isTrue);
    await expectLater(drv.api.deferStop(job.offerId, first.id), apiError('EVIDENCE_REQUIRED'), reason: 'postponing needs a written reason and a photo (E7)');
    final shot = File('${Directory.systemTemp.path}/jr_live_defer.png')..writeAsBytesSync(_png);
    addTearDown(() { if (shot.existsSync()) shot.deleteSync(); });
    final media = await drv.api.uploadStopMedia(job.offerId, first.id, kind: 'defer', path: shot.path, filename: 'closed.png');
    await drv.api.deferStop(job.offerId, first.id, note: 'Shop is closed until 5pm', mediaId: media['id'] as String);
    j = await drv.api.job(job.offerId);
    expect(j.currentStop!.id, isNot(first.id), reason: 'postponed stop moves later in the route');
    final second = j.currentStop!;
    await drv.api.arriveStop(job.offerId, second.id);
    await drv.api.resendCode(job.offerId, second.id);

    final codes = await demoCodes(requestId);
    await drv.api.deliverStop(job.offerId, second.id, code: second.code, otp: codes[second.id]); // business stops accept the code too

    await drv.api.endRoute(job.offerId, 'Car broke down', note: 'flat tyre');
    j = await drv.api.job(job.offerId);
    expect(j.status, 'completed', reason: 'ending the route confirms and pays what was delivered');
    expect(j.deliveredUnits, 1, reason: 'the delivered stop stays counted and paid');
    await biz.client.post('/offers/${job.offerId}/returns', {'all': true});
    j = await drv.api.job(job.offerId);
    expect(j.finalUnits, 1);
  });

  test('best route: after hand-over and the count confirmation the driver re-optimises — the job carries the plan, legs and map positions (before and after approval)', skip: skip, () async {
    // The business gives map positions, so every stop is "located" whether or not Google is configured on the test server (a heuristic plan is labelled as such).
    final body = requestBody(startsAt: DateTime.now().add(const Duration(hours: 3)), parcels: 4);
    // rebuild each parcel as a dynamic map (the helper's maps are String-typed, so a double could not be stored in them)
    final pinned = <Map<String, dynamic>>[for (final (i, sh) in (body['shipments'] as List).indexed) {...Map<String, dynamic>.from(sh as Map), 'lat': 24.70 + i * 0.02, 'lng': 46.65 + (i.isEven ? 0.03 : -0.02)}];
    body['shipments'] = pinned;
    final r = await biz.client.post('/requests', body);
    final requestId = r['id'] as String;
    final job = (await drv.api.offers()).firstWhere((j) => j.requestId == requestId);
    await drv.api.accept(job.offerId);
    await expectLater(drv.api.optimizeRoute(job.offerId), apiError('INVALID_TRANSITION'), reason: 'nothing has been handed over yet');

    await drv.api.checkIn(job.offerId, lat: 24.7136, lng: 46.6753);
    await biz.client.post('/offers/${job.offerId}/attendance', {'present': true});
    await biz.client.post('/offers/${job.offerId}/loading', {'all': true});
    await drv.api.ackLoading(job.offerId, true);
    var j = await drv.api.job(job.offerId);
    expect(j.route, isNotNull, reason: 'manifest jobs carry `route`');
    expect(j.route!.canOptimize, isTrue, reason: 'count confirmed and at least two stops on board');

    final res = await drv.api.optimizeRoute(job.offerId, lat: 24.7, lng: 46.7);
    expect(res.plan, isNotNull);
    expect(res.job, isNotNull, reason: 'the answer carries the fresh job view');
    j = await drv.api.job(job.offerId);
    final route = j.route!;
    expect(route.planned, isTrue);
    expect(route.provider, anyOf('google_routes', 'local_heuristic', 'mixed'));
    expect(route.plannedAt, isNotNull);
    expect(res.plan!['provider'], route.provider);
    expect(res.job!.route!.planned, isTrue);
    expect(route.totalDistanceM, greaterThan(0));
    expect(route.totalDurationS, isNotNull);
    expect(j.stops.length, 4);
    expect(j.stops.every((s) => s.located), isTrue, reason: 'every parcel was given a position');
    expect(j.stops.every((s) => s.legDistanceM != null && s.legDurationS != null), isTrue, reason: 'each stop carries the driving leg into it');
    expect(j.stops.any((s) => s.hasLeg), isTrue);
    final order = j.stops.map((s) => s.stopOrder).toList();
    expect(order, [...order]..sort(), reason: 'stops come in planned order');
    expect(order.toSet().length, 4);
    expect(route.remainingDistanceM, j.stops.fold<int>(0, (a, s) => a + (s.legDistanceM ?? 0)), reason: 'remaining = the legs of the stops still on board');

    final again = await drv.api.optimizeRoute(job.offerId, lat: 24.7, lng: 46.7);
    expect(again.cached, isTrue, reason: 'same inputs: nothing recomputed, no paid call');

    // after approval it is still allowed, and the stop the driver is standing at stays first
    await drv.api.routeApprove(job.offerId);
    j = await drv.api.job(job.offerId);
    final cur = j.currentStop!;
    await drv.api.arriveStop(job.offerId, cur.id, lat: cur.lat, lng: cur.lng);
    j = await drv.api.job(job.offerId);
    expect(j.route!.canOptimize, isTrue);
    final after = await drv.api.optimizeRoute(job.offerId, lat: cur.lat, lng: cur.lng);
    expect(after.currentId ?? cur.id, cur.id);
    j = await drv.api.job(job.offerId);
    expect(j.currentStop!.id, cur.id, reason: 'the stop being served does not move');
    expect(j.stops.first.id, cur.id);
    expect(j.route!.planned, isTrue);

    // clean up like the other tests: deliver the current stop, end the route, the warehouse takes the rest back
    final codes = await demoCodes(requestId);
    await drv.api.deliverStop(job.offerId, cur.id, code: cur.code, otp: codes[cur.id]);
    await drv.api.endRoute(job.offerId, 'Best-route live test cleanup');
    await biz.client.post('/offers/${job.offerId}/returns', {'all': true});
    j = await drv.api.job(job.offerId);
    expect(j.status, 'completed');
  });

  test('chat, contact exception, cancellation and privacy rules on a per-parcel job', skip: skip, () async {
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 4))));
    final job = (await drv.api.offers()).firstWhere((j) => j.requestId == r['id']);
    await expectLater(drv.api.whatsapp(job.offerId, 'contact', 'en'), apiError('FORBIDDEN'), reason: 'no contact before acceptance');
    await drv.api.accept(job.offerId);

    await drv.api.contactException(job.offerId, 'no_answer', note: 'rang 3 times');
    final tl = await drv.api.timeline(job.offerId);
    expect(tl.map((e) => e['type']), contains('contact_exception'));

    await drv.api.sendMessage(job.offerId, 'On my way');
    await biz.client.post('/offers/${job.offerId}/messages', {'body': 'Thanks!'});
    final msgs = await drv.api.messages(job.offerId);
    expect(msgs.map((m) => m['body']), ['On my way', 'Thanks!']);

    // cancel with reason frees the slot; replacement logic handled server-side
    final cancel = await drv.api.cancel(job.offerId, 'testing cancellation');
    expect((cancel['offer'] as Map)['status'], 'cancelled');
  });

  test('the route optimiser no longer exists on the server', skip: skip, () async {
    await expectLater(drv.client.post('/driver/route/optimize', {'origin': {'lat': 24.7, 'lng': 46.7}, 'offerIds': <String>[]}),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', anyOf(404, 405))));
    // other drivers cannot read this driver's jobs
    final r = await biz.client.post('/requests', requestBody(startsAt: DateTime.now().add(const Duration(days: 8))));
    final job = (await drv.api.offers()).firstWhere((j) => j.requestId == r['id']);
    await drv.api.accept(job.offerId);
    final other = await login('0500000014');
    await expectLater(other.api.job(job.offerId), apiError('NOT_FOUND'));
    await drv.api.cancel(job.offerId, 'cleanup');
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
    await expectLater(office.api.requestWithdrawal(20000), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'WALLET_MANAGED_BY_OFFICE'))); // J4: the wallet is the office's
    await biz.client.post('/requests/${r['id']}/cancel', {'reason': 'cleanup'});
  });

  test('sign-in: wrong credentials, username availability, registration without OTP, change password, logout revokes the session', skip: skip, () async {
    // wrong credentials are one generic 401; an unknown user looks the same as a wrong password
    final anon = DriverApi(ApiClient(baseUrl: base!, tokens: MemoryTokenStore()));
    final demo = await demoCredentials(drv.client, '0500000011');
    await expectLater(anon.login(demo.username, 'definitely-wrong-1'), apiError('UNAUTHENTICATED'));
    await expectLater(anon.login('no.such.user.${DateTime.now().millisecondsSinceEpoch}', 'Whatever#12345'), apiError('UNAUTHENTICATED'));
    // the username is case-insensitive
    expect((await anon.login(demo.username.toUpperCase(), demo.password))['token'], isA<String>());

    final stamp = DateTime.now().millisecondsSinceEpoch.toString();
    final username = 'flutter.${stamp.substring(5)}', phone = '05${stamp.substring(5, 13)}', password = 'Flutter#Pass2026';
    expect((await anon.usernameAvailable(username))['available'], isTrue);
    expect((await anon.usernameAvailable(demo.username))['available'], isFalse, reason: 'a demo username is taken');
    expect((await anon.usernameAvailable('a!'))['available'], isFalse, reason: 'invalid shape');

    final body = {'role': 'driver', 'username': username, 'password': password, 'name': 'Flutter Test Driver', 'phone': phone, 'city': 'riyadh', 'vehicleType': 'van', 'services': ['delivery_driver'], 'termsAccepted': true};
    await expectLater(anon.register(body), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION').having((e) => e.details.containsKey('vehicleTemperature'), 'field', true)));
    await expectLater(anon.register({...body, 'vehicleTemperature': 'cold', 'termsAccepted': false}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TERMS_REQUIRED')));
    await expectLater(anon.register({...body, 'vehicleTemperature': 'cold', 'password': 'short1'}), apiError('VALIDATION'), reason: 'the password rule (10+ characters, a letter and a digit) is enforced');
    final ok = await anon.register({...body, 'vehicleTemperature': 'cold'});
    expect((ok['user'] as Map)['username'], username);
    expect((ok['user'] as Map)['role'], 'driver');

    // the same username / phone again: 409 with the offending field
    await expectLater(anon.register({...body, 'vehicleTemperature': 'cold', 'phone': '05${stamp.substring(4, 12)}'}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CONFLICT').having((e) => e.details['field'], 'field', 'username')));
    await expectLater(anon.register({...body, 'vehicleTemperature': 'cold', 'username': 'other.$username'}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CONFLICT').having((e) => e.details['field'], 'field', 'phone')));
    expect((await anon.usernameAvailable(username))['available'], isFalse);

    // the session of the registration works, and so does a normal sign-in
    final tokens = MemoryTokenStore();
    final api = DriverApi(ApiClient(baseUrl: base!, tokens: tokens));
    await tokens.write(ok['token'] as String);
    final ov = await api.overview();
    expect(ov.verified, isFalse);
    expect(ov.verification, 'pending');
    final cat = await api.catalog();
    expect(cat['policy'], isA<Map>());
    expect(((cat['documents'] as Map)['driver'] as List).length, 4);
    final fresh = await anon.login(username, password);
    expect((fresh['user'] as Map)['mustChangePassword'], isNot(true), reason: 'a self-registered account keeps its own password');

    // change password: wrong current -> 401, weak new -> 422, then it works and only the new password signs in
    await expectLater(api.changePassword('not-my-password-1', 'Another#Pass2027'), apiError('UNAUTHENTICATED'));
    await expectLater(api.changePassword(password, 'short1'), apiError('VALIDATION'));
    final changed = await api.changePassword(password, 'Another#Pass2027');
    expect(changed, isA<Map>());
    await expectLater(anon.login(username, password), apiError('UNAUTHENTICATED'));
    final again = await anon.login(username, 'Another#Pass2027');
    await tokens.write(again['token'] as String);
    expect((await api.me())['user'], isA<Map>());

    await api.logout();
    await expectLater(api.overview(), throwsA(isA<ApiException>().having((e) => e.isAuth, 'auth', true)));
  });

  // E-series (Addendum E): arrival geofence → loading by scanning → finish → planned route (→ manual order). Written against memory/SHIPMENTS_API.md "Addendum E";
  // it assumes the platform defaults (geofence on, requireLoadingRecord off) and a business whose request carries a warehouse pin.
  test('field ops: check-in with GPS, scan parcels onto the vehicle, finish loading → route planned (and manually re-ordered)', skip: skip, () async {
    const pinLat = 24.7136, pinLng = 46.6753; // the warehouse pin the request carries
    final r = await biz.client.post('/requests', {...requestBody(startsAt: DateTime.now().add(const Duration(hours: 1))), 'pickupLat': pinLat, 'pickupLng': pinLng});
    final requestId = r['id'] as String;
    await drv.api.setAvailability(true);
    final offer = (await drv.api.offers()).firstWhere((j) => j.requestId == requestId);
    await drv.api.accept(offer.offerId);

    var j = await drv.api.job(offer.offerId);
    expect(j.status, 'accepted');
    expect(j.arrival.hasWarehouse, isTrue, reason: 'the request pin is the warehouse location');
    expect(j.loading.mode, 'driver_scan', reason: 'default: requireLoadingRecord is off, the driver scans');
    expect(j.policy, isNotNull);

    if (j.arrival.enforced) {
      // no GPS at all, then far away: both are refused with the numbers the app shows
      await expectLater(drv.api.checkIn(offer.offerId), apiError('LOCATION_REQUIRED'));
      await expectLater(drv.api.checkIn(offer.offerId, lat: pinLat + 0.5, lng: pinLng + 0.5), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'TOO_FAR_FROM_WAREHOUSE').having((e) => (e.details['distanceM'] as num) > (e.details['radiusM'] as num), 'distance > radius', true)));
    }
    final arrived = await drv.api.checkIn(offer.offerId, lat: pinLat + 0.0002, lng: pinLng + 0.0002); // ~30 m from the pin
    expect(arrived['status'], anyOf('arrived', 'attendance_confirmed'));
    if (arrived['status'] == 'arrived') await biz.client.post('/offers/${offer.offerId}/attendance', {'present': true}); // the warehouse confirms the arrival

    j = await drv.api.job(offer.offerId);
    expect(j.status, 'attendance_confirmed');
    expect(j.manifest, isTrue);
    expect(j.inScanLoading, isTrue);
    expect(j.actions, contains('scan_loading'));
    expect(j.actions, isNot(contains('ack_loading')), reason: 'the old acknowledgement exists in warehouse mode only');
    expect(j.actions, isNot(contains('finish_loading')), reason: 'finish_loading appears once at least one parcel is scanned');
    expect(j.stops.length, 3, reason: 'the checklist lists every assigned parcel');
    expect(j.stops.every((s) => s.status == 'pending' && !s.scanned), isTrue);
    expect(j.loading.assigned, 3);
    expect(j.loading.scanned, 0);

    await expectLater(drv.api.loadingFinish(offer.offerId), apiError('VALIDATION'), reason: 'nothing scanned yet');
    await expectLater(drv.api.loadingScan(offer.offerId, 'NOT-MY-PARCEL'), apiError('VALIDATION'));

    final codes = [for (final s in j.stops) s.code];
    var res = await drv.api.loadingScan(offer.offerId, codes[0]);
    expect((res.scanned, res.assigned, res.already), (1, 3, false));
    expect(res.shipmentId, isNotEmpty);
    res = await drv.api.loadingScan(offer.offerId, codes[0]);
    expect(res.already, isTrue, reason: 'scanning twice changes nothing');
    res = await drv.api.loadingScan(offer.offerId, codes[1]);
    expect(res.scanned, 2);
    final undo = await drv.api.loadingUnscan(offer.offerId, codes[1]);
    expect(undo['scanned'], 1);
    res = await drv.api.loadingScan(offer.offerId, codes[1]);
    expect(res.scanned, 2);

    j = await drv.api.job(offer.offerId);
    expect(j.actions, containsAll(['scan_loading', 'finish_loading']));
    expect(j.stops.where((s) => s.scanned).length, 2);

    // third parcel is left on the shelf: it goes back to the warehouse pool, the route is planned from the two that were scanned
    final fin = await drv.api.loadingFinish(offer.offerId);
    expect(fin.loaded, 2);
    expect(fin.released, 1);
    j = fin.job ?? await drv.api.job(offer.offerId);
    expect(j.loading.finished, isTrue);
    expect(j.route?.planned, isTrue, reason: 'finishing loading plans the route');
    expect(j.stops.where((s) => s.open).length, 2);
    expect(j.actions, contains('approve_route'));
    expect(j.inScanLoading, isFalse);

    // manual order (when the platform allows it): reverse the two stops; the route is then "arranged by the driver"
    if (j.route?.canReorder == true) {
      final ids = [for (final s in j.stops) if (s.open) s.id];
      final re = await drv.api.routeReorder(offer.offerId, ids.reversed.toList());
      j = re.job ?? await drv.api.job(offer.offerId);
      expect(j.route?.manual, isTrue);
      expect(j.route?.provider, 'manual');
      expect([for (final s in j.stops) if (s.open) s.id], ids.reversed.toList());
      await expectLater(drv.api.routeReorder(offer.offerId, [ids.first]), apiError('VALIDATION'), reason: 'order must list exactly the movable stops');
    }

    await drv.api.routeApprove(offer.offerId);
    j = await drv.api.job(offer.offerId);
    expect(j.routeApproved, isTrue);
    expect(j.actions, contains('work_stops'));
  });

  // Mobile-B (E11 / E15 / E17): the cash summary, the offers-while-busy envelope, notifications and a support ticket with a photo, end to end.
  test('cash with me + support tickets (photo attachment, reply, resolve, reopen) + offers/notifications envelopes', skip: skip, () async {
    final extra = ExtraApi(drv.client);
    // E17 — cash with me: a well-formed answer, consistent with itself, also for a driver who never collected cash
    final cash = await extra.cash();
    expect(cash.outstandingCents, cash.collectedCents - cash.receivedCents);
    for (final o in cash.orders) { expect(o.outstandingCents, o.collectedCents - o.receivedCents, reason: o.ref); }
    expect(CashBrief.fromOverview((await drv.api.overview()).j), isNotNull, reason: 'overview.cash (Addendum E.5)');
    // E11 — {items, hidden, activeJob}: nothing is listed while hidden
    final info = await extra.offersInfo();
    if (info.hidden) { expect(info.items, isEmpty); expect(info.activeJob, isNotNull); }
    expect((await extra.opportunitiesInfo()).hidden, info.hidden);
    // E12 — the unread poll answers a list (offer_new rows, if any, carry what the alert needs)
    for (final n in await extra.unreadNotifications()) { expect(n.id, isNotEmpty); if (n.type == 'offer_new') { expect(n.data['ref'], isNotNull); } }
    // E15 — a ticket with one photo
    expect(driverTicketCategories(await drv.api.catalog()), contains('cod_issue'));
    final dir = await Directory.systemTemp.createTemp('jr_ticket');
    try {
      final f = File('${dir.path}/proof.png')..writeAsBytesSync(_png);
      final up = await extra.uploadTicketFile(f.path, 'proof.png');
      expect(up.id, isNotEmpty);
      expect(up.mime, 'image/png');
      final t = await extra.createTicket(category: 'cod_issue', subject: 'Live test ${DateTime.now().millisecondsSinceEpoch}', body: 'The cash does not match', attachmentIds: [up.id]);
      expect(t.id, isNotEmpty);
      expect(t.status, 'open');
      var th = await extra.ticket(t.id);
      expect(th.replies.first.body, 'The cash does not match');
      expect(th.replies.first.attachments.map((a) => a.id), [up.id]);
      expect((await extra.attachmentBytes(up.id)).length, _png.length, reason: 'the opener can fetch the photo');
      expect((await extra.tickets()).any((x) => x.id == t.id), isTrue);
      await extra.replyTicket(t.id, 'one more detail');
      await extra.resolveTicket(t.id);
      th = await extra.ticket(t.id);
      expect(th.ticket.status, 'resolved');
      expect(th.ticket.canReopen(), isTrue);
      await extra.reopenTicket(t.id, body: 'still wrong');
      expect((await extra.ticket(t.id)).ticket.status, 'open');
      // an unknown category is refused
      await expectLater(extra.createTicket(category: 'nope', subject: 'abc'), apiError('VALIDATION'));
    } finally {
      await dir.delete(recursive: true);
    }
  });

  // Update L (mobile): the terms and privacy texts, the re-acceptance list, the cash block, the catalog's update policy and support contact, the privacy tools
  // (status, export, request + withdraw) and the crash-report endpoint — against the real server. It changes no platform setting.
  test('Update L: legal texts, /auth/me legal, cash block, catalog policy + company, privacy status / export / deletion request, crash reports', skip: skip, () async {
    final anon = DriverApi(ApiClient(baseUrl: base!, tokens: MemoryTokenStore()));

    // GET /legal/:kind?lang= is public, per language, and carries markdown the app can draw
    final legal = LegalApi(anon.c);
    for (final slug in [legalDriverSlug, legalPrivacySlug]) {
      for (final lang in ['ar', 'en', 'ur']) {
        final d = await legal.doc(slug, lang);
        expect(d.version, isNotEmpty, reason: '$slug/$lang');
        expect(d.title, isNotEmpty, reason: '$slug/$lang');
        expect(parseLegalMarkdown(d.body).length, greaterThan(3), reason: '$slug/$lang has a real text');
      }
    }
    await expectLater(legal.doc('nonsense', 'en'), apiError('NOT_FOUND'));

    // GET /auth/me carries legal.pending (a list); the demo driver has nothing to re-accept unless somebody published a release that asks for it
    final me = await drv.api.me();
    expect(me['legal'], isA<Map>());
    final pending = PendingLegal.parse(me);
    for (final p in pending) { expect(const ['terms_driver', 'privacy'], contains(p.kind)); expect(p.version, isNotEmpty); }
    if (pending.isNotEmpty) {
      // POST /legal/accept {items:[{kind,version}], locale}: only the version in force can be accepted, a stale one is a 409
      await expectLater(LegalApi(drv.client).accept([PendingLegal({'kind': pending.first.kind, 'version': 'old-0'})], 'en'), apiError('CONFLICT'));
      final r = await LegalApi(drv.client).accept(pending, 'en');
      expect(r['pending'], isA<List>());
    }

    // GET /catalog: the update policy per platform and the company's support channels (both may be empty, but they exist and are tolerant)
    final cat = await anon.catalog();
    final app = mapOf(mapOf(cat['policy'])?['app']);
    expect(app, isNotNull, reason: 'policy.app');
    expect(mapOf(app!['minVersion']), isNotNull);
    expect(mapOf(app['storeUrl']), isNotNull);
    expect(mapOf(cat['company']), isNotNull, reason: 'company (Settings › Company)');

    // GET /driver/overview → cash (the cash-risk block) and the paused-offers envelope are well-formed
    final ov = await drv.api.overview();
    final risk = ov.cashRisk;
    expect(risk, isNotNull);
    expect(CashState.values, contains(risk!.state));
    expect(risk.lienCents, greaterThanOrEqualTo(0));
    if (risk.state == CashState.ok || risk.state == CashState.warn) { expect(risk.blocksOffers, isFalse); }
    final info = await ExtraApi(drv.client).offersInfo();
    if (info.cashBlocked) { expect(info.items, isEmpty); expect(info.cash, isNotNull); }
    // the stops of a job carry otpOffReason / canResend and the job carries deliveryCode (checked on the jobs of the other tests when SMS is off)
    for (final j in await drv.api.jobs(active: true)) { expect(j.deliveryCode.required, isA<bool>()); }

    // a fresh account (nothing to settle) can use the privacy tools: status → export (a JSON attachment) → request deletion → it is open → withdraw it
    final stamp = DateTime.now().millisecondsSinceEpoch.toString();
    final username = 'lm.${stamp.substring(5)}', phone = '05${stamp.substring(5, 13)}', password = 'Flutter#Pass2026';
    final reg = await anon.register({'role': 'driver', 'username': username, 'password': password, 'name': 'Update L Test Driver', 'phone': phone, 'city': 'riyadh', 'vehicleType': 'sedan', 'services': ['delivery_driver'], 'termsAccepted': true});
    final tokens = MemoryTokenStore();
    await tokens.write(reg['token'] as String);
    final client = ApiClient(baseUrl: base!, tokens: tokens);
    final repo = PrivacyRepository(client);
    var st = await repo.status();
    expect(st.deletionSupported, isTrue);
    expect(st.blockers, isEmpty, reason: 'a new account owes nothing');
    expect(st.canRequest, isTrue);
    expect(st.hasRetention, isTrue);
    final bytes = await repo.exportData();
    final exported = jsonDecode(utf8.decode(bytes));
    expect(exported, isA<Map>());
    expect(utf8.decode(bytes), isNot(contains(password)), reason: 'an export never holds the password');
    final req = await repo.requestDeletion('Live test');
    expect(req.open, isTrue);
    st = await repo.status();
    expect(st.request?.open, isTrue);
    expect(st.canRequest, isFalse);
    await expectLater(repo.requestDeletion('again'), apiError('CONFLICT'));
    final cancelled = await repo.cancelDeletion();
    expect(cancelled.status, 'cancelled');
    await expectLater(repo.cancelDeletion(), apiError('NOTHING_TO_DO'));
    // a driver with money or an open job is told what blocks it (the demo driver may hold cash or a wallet balance; either way the answer is well-formed)
    final busy = await PrivacyRepository(drv.client).status();
    for (final b in busy.blockers) { expect(b.code, isNotEmpty); }

    // POST /app/errors always answers 202 / 204 (and takes no token)
    final r = await anon.c.dio.post('/app/errors', data: {'message': 'live test', 'stack': '#0 main (package:jr_driver/main.dart:1:1)', 'route': '/', 'appVersion': '1.0.0+1', 'platform': 'android', 'osVersion': 'test', 'at': DateTime.now().toUtc().toIso8601String()}, options: Options(validateStatus: (_) => true));
    expect([202, 204], contains(r.statusCode));
  });
}
