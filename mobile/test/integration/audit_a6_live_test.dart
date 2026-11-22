@Tags(['live'])
library;

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/auth/auth_rules.dart';
import 'live_login.dart';

/// Audit A6 — the app's own API client against a real server, for the J changes and the failure paths the other live tests do not touch.
/// Skipped unless JR_API is set. The MUTATING group (creates / suspends / resets accounts, files withdrawals) only runs when JR_A6_MUTATE=1 and must
/// be pointed at a TEST database (see tool/live_test.sh for how a throw-away server is started); the read-only group is safe on the dev server.
final base = Platform.environment['JR_API'];
final mutate = Platform.environment['JR_A6_MUTATE'] == '1';

Matcher apiError(String code) => throwsA(isA<ApiException>().having((e) => e.code, 'code', code));

ApiClient newClient({TokenStore? tokens, void Function()? onUnauthorized}) => ApiClient(baseUrl: base!, tokens: tokens ?? MemoryTokenStore(), onUnauthorized: onUnauthorized, retryDelays: const []);

void main() {
  final skip = base == null ? 'set JR_API (e.g. http://localhost:3000) to run live tests' : null;
  final skipMutating = base == null ? skip : (mutate ? null : 'mutating group: set JR_A6_MUTATE=1 against a TEST database');

  group('read-only (safe on the dev server)', () {
    test('username login: errors map to the right localized key; case and spaces do not matter', skip: skip, () async {
      final api = DriverApi(newClient());
      final wrong = await api.login('demo.driver', 'wrong-password-1').then<Object?>((_) => null, onError: (Object e) => e);
      expect(wrong, isA<ApiException>());
      expect((wrong! as ApiException).code, 'UNAUTHENTICATED');
      expect(loginErrorKey(wrong), 'm.au_err_credentials');
      final unknown = await api.login('nobody.${DateTime.now().millisecondsSinceEpoch}', 'Whatever#12345').then<Object?>((_) => null, onError: (Object e) => e);
      expect(loginErrorKey(unknown!), 'm.au_err_credentials', reason: 'unknown user looks exactly like a wrong password');
      final empty = await api.login('', '').then<Object?>((_) => null, onError: (Object e) => e);
      expect((empty! as ApiException).code, 'VALIDATION');
      expect(loginErrorKey(empty), 'm.au_err_credentials');
      // the app lower-cases before sending (normalizeUsername), the server also accepts any case
      final r = await api.login(normalizeUsername('  DEMO.Driver '), 'Demo#Pass2026');
      expect(r['token'], isA<String>());
      expect((r['user'] as Map)['role'], 'driver');
      await api.logout();
    });

    test('a non-driver account that signs in through the app still gets a server session (the app refuses it client-side only)', skip: skip, () async {
      final tokens = MemoryTokenStore();
      final client = newClient(tokens: tokens);
      final r = await DriverApi(client).login('demo.business', 'Demo#Pass2026');
      expect((r['user'] as Map)['role'], 'business');
      await tokens.write(r['token'] as String);
      // the session is live: A6 finding — LoginScreen returns without calling /auth/logout, so it lives on the server until it expires (30 days for client=mobile)
      expect(((await client.get('/auth/me'))['user'] as Map)['role'], 'business');
      await DriverApi(client).logout(); // what the app should do
      await expectLater(client.get('/auth/me'), apiError('UNAUTHENTICATED'));
    });

    test('routing OFF: policy in the catalog, ROUTING_DISABLED on every routing call (checked before ownership)', skip: skip, () async {
      final client = await signedInClient(base!, '0500000011');
      final api = DriverApi(client);
      final policy = ((await api.catalog())['policy'] as Map?) ?? const {};
      if (policy['routingEnabled'] != false) { markTestSkipped('the server runs with routing ON'); return; }
      expect(policy['b2bShipmentsEnabled'], isFalse);
      const ghost = '00000000-0000-4000-8000-000000000000';
      await expectLater(api.optimizeRoute(ghost), apiError('ROUTING_DISABLED'));
      await expectLater(api.routeReorder(ghost, const ['00000000-0000-4000-8000-000000000001']), apiError('ROUTING_DISABLED'));
      await expectLater(client.get('/driver/jobs/$ghost/route-geometry'), apiError('ROUTING_DISABLED'));
      for (final j in await api.jobs(active: true)) {
        expect(j.routingEnabled, isFalse);
        expect(j.actions, isNot(contains('approve_route')));
        expect(j.route, isNull);
      }
    });

    test('office driver (demo.driver5): no wallet, no withdrawals, no payout notifications, cash stays', skip: skip, () async {
      final client = await signedInClient(base!, '0500000015');
      final api = DriverApi(client);
      final ov = await api.overview();
      if (!ov.walletManagedByOffice) { markTestSkipped('demo.driver5 has no office on this server'); return; }
      expect(ov.j['wallet'], isNull);
      expect(ov.officeName, isNotNull);
      final w = await api.wallet();
      expect(w['managedByOffice'], isTrue);
      expect(w['availableCents'], isNull);
      await expectLater(api.requestWithdrawal(20000), apiError('WALLET_MANAGED_BY_OFFICE'));
      expect(ov.j['cash'], isNotNull);
      final n = (await api.notifications())['items'] as List;
      const wallet = {'payout_paid', 'withdrawal_paid', 'withdrawal_rejected', 'wallet_adjusted'};
      expect(n.where((e) => wallet.contains((e as Map)['type'])), isEmpty);
      for (final j in await api.jobs(active: false)) {
        if (j.earningHidden) expect(j.expectedEarningCents, isNull);
      }
    });

    test('history is paged by the server (100 per page) — the app reads page 1 only', skip: skip, () async {
      final client = await signedInClient(base!, '0500000015');
      final r = await client.get('/driver/jobs', query: {'scope': 'history'});
      final items = (r['items'] as List).length;
      final total = (r['total'] as num).toInt();
      // ignore: avoid_print
      print('A6 history: items=$items total=${r['total']} pageSize=${r['pageSize']} (app shows only the first page)');
      expect(items, lessThanOrEqualTo(total));
      final w = await signedInClient(base!, '0500000011').then((c) => c.get('/wallet'));
      // ignore: avoid_print
      print('A6 wallet: entries=${(w['entries'] as List).length} total=${w['total']} pageSize=${w['pageSize']}');
    });

    test('401 with a dead token: onUnauthorized fires once per request, /auth/me is an auth error', skip: skip, () async {
      var n = 0;
      final tokens = MemoryTokenStore();
      await tokens.write('definitely-not-a-session');
      final client = newClient(tokens: tokens, onUnauthorized: () => n++);
      await expectLater(DriverApi(client).overview(), apiError('UNAUTHENTICATED'));
      expect(n, 1);
      await expectLater(DriverApi(client).me(), apiError('UNAUTHENTICATED'));
      expect(n, 1, reason: '/auth/* never expires the session by itself');
    });
  });

  group('mutating (test database only)', () {
    late ApiClient admin;
    Future<void> signAdmin() async {
      final r = await DriverApi(newClient()).login(Platform.environment['JR_ADMIN_USER'] ?? 'admin', Platform.environment['JR_ADMIN_PASS'] ?? 'E2e!Password2026');
      final tokens = MemoryTokenStore();
      await tokens.write(r['token'] as String);
      admin = newClient(tokens: tokens);
    }

    Future<({String id, String username, String password})> newDriver(String tag) async {
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final Json r;
      try {
        r = await admin.post('/admin/accounts', {'kind': 'driver', 'name': 'A6 $tag', 'phone': '05${(stamp % 100000000).toString().padLeft(8, '0')}', 'city': 'riyadh', 'vehicleType': 'sedan', 'services': ['delivery_driver']});
      } on ApiException catch (e) {
        // ignore: avoid_print
        print('A6 create account failed: ${e.code} ${e.details}');
        rethrow;
      }
      final cred = r['credentials'] as Map;
      return (id: '${(r['user'] as Map)['id']}', username: '${cred['username']}', password: '${cred['generatedPassword']}');
    }

    test('staff-created driver: forced password change contract (login → 403 PASSWORD_CHANGE_REQUIRED → change → normal)', skip: skipMutating, () async {
      await signAdmin();
      final d = await newDriver('forced');
      final tokens = MemoryTokenStore();
      final client = newClient(tokens: tokens);
      final api = DriverApi(client);
      final l = await api.login(d.username, d.password);
      final user = (l['user'] as Map).cast<String, dynamic>();
      expect(user['mustChangePassword'], isTrue, reason: 'the login answer says so — the router sends the driver to /change-password');
      await tokens.write(l['token'] as String);
      // the server enforces it on every other call: the app has no handler for this code (A6 finding), it would show err.PASSWORD_CHANGE_REQUIRED as a toast
      await expectLater(api.overview(), apiError('PASSWORD_CHANGE_REQUIRED'));
      expect(((await api.me())['user'] as Map)['mustChangePassword'], isTrue);
      await api.catalog();
      // a second device signs in with the temporary password meanwhile
      final other = MemoryTokenStore();
      final l2 = await DriverApi(newClient(tokens: other)).login(d.username, d.password);
      await other.write(l2['token'] as String);
      // wrong current password: 401 (the screen then asks /auth/me to tell "wrong password" from "session gone")
      await expectLater(api.changePassword('not-the-password-1', 'Fresh#Password2027'), apiError('UNAUTHENTICATED'));
      expect(((await api.me())['user'] as Map)['mustChangePassword'], isTrue, reason: 'the session survived the wrong attempt');
      // same password: refused with a field error
      await expectLater(api.changePassword(d.password, d.password), apiError('VALIDATION'));
      final changed = await api.changePassword(d.password, 'Fresh#Password2027');
      expect(changed['ok'], isTrue);
      expect(changed.containsKey('token'), isFalse, reason: 'no fresh token in the answer: the app falls back to /auth/me');
      expect(((await api.me())['user'] as Map)['mustChangePassword'], isFalse);
      await api.overview(); // allowed now
      await expectLater(DriverApi(newClient(tokens: other)).overview(), apiError('UNAUTHENTICATED'), reason: 'the other device was signed out');
      await expectLater(api.login(d.username, d.password), apiError('UNAUTHENTICATED'));
      await api.login(d.username, 'Fresh#Password2027');
    });

    test('lock-out, suspension and a password reset behind the driver’s back', skip: skipMutating, () async {
      await signAdmin();
      final d = await newDriver('lock');
      final tokens = MemoryTokenStore();
      var expired = 0;
      final client = newClient(tokens: tokens, onUnauthorized: () => expired++);
      final api = DriverApi(client);
      // first sign-in + change password so the session is a normal one
      final l = await api.login(d.username, d.password);
      await tokens.write(l['token'] as String);
      await api.changePassword(d.password, 'Fresh#Password2027');
      // five wrong passwords lock the account: the 6th try — even with the right password — is RATE_LIMITED
      for (var i = 0; i < 5; i++) {
        await expectLater(DriverApi(newClient()).login(d.username, 'wrong-password-$i'), apiError('UNAUTHENTICATED'));
      }
      final locked = await DriverApi(newClient()).login(d.username, 'Fresh#Password2027').then<Object?>((_) => null, onError: (Object e) => e);
      expect((locked! as ApiException).code, 'RATE_LIMITED');
      expect(loginErrorKey(locked), 'm.au_err_rate');
      // an admin unlocks by resetting the password: the driver's live session ends (401) and he must change the new temporary one
      final reset = await admin.post('/admin/users/${d.id}/reset-password', {});
      await expectLater(api.overview(), apiError('UNAUTHENTICATED'));
      expect(expired, 1, reason: 'the 401 on a normal call expires the app session exactly once');
      final tmp = '${reset['password']}';
      final again = await DriverApi(newClient()).login(d.username, tmp);
      expect((again['user'] as Map)['mustChangePassword'], isTrue);
      // suspension: the right password gets 403 FORBIDDEN (-> m.au_err_suspended); a session in use gets 401
      final t2 = MemoryTokenStore();
      await t2.write(again['token'] as String);
      await admin.post('/admin/users/${d.id}/status', {'status': 'suspended', 'reason': 'audit'});
      await expectLater(DriverApi(newClient(tokens: t2)).me(), apiError('UNAUTHENTICATED'));
      final susp = await DriverApi(newClient()).login(d.username, tmp).then<Object?>((_) => null, onError: (Object e) => e);
      expect((susp! as ApiException).code, 'FORBIDDEN');
      expect(loginErrorKey(susp), 'm.au_err_suspended');
    });

    test('repeating a write after a lost answer: what the server says (the app never retries writes itself)', skip: skipMutating, () async {
      final biz = await signedInClient(base!, '0500000001');
      final drvClient = await signedInClient(base!, '0500000011');
      final drv = DriverApi(drvClient);
      final policy = ((await drv.catalog())['policy'] as Map?) ?? const {};
      if (policy['routingEnabled'] == true) { markTestSkipped('this group walks the routing-OFF flow'); return; }
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final r = await biz.post('/requests', {
        'service': 'delivery_driver', 'shipmentsPerDriver': 30, 'vehicleType': 'sedan', 'pickupCity': 'riyadh', 'deliveryCity': 'riyadh', 'pickupAddress': 'Olaya St',
        'startsAt': DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String(), 'durationDays': 1, 'publish': true, 'termsAccepted': true,
        'shipments': [for (var n = 1; n <= 4; n++) {'recipientType': 'consumer', 'recipientName': 'Rep $n', 'recipientPhone': '05550010${n.toString().padLeft(2, '0')}', 'address': 'Street $n, Riyadh', 'city': 'riyadh', 'externalRef': 'A6-$stamp-$n'}],
      });
      final requestId = r['id'] as String;
      await drv.setAvailability(true);
      final offers = await drv.offers();
      // ignore: avoid_print
      if (!offers.any((j) => j.requestId == requestId)) print('A6 no offer for request $requestId: offers=${offers.map((o) => o.requestId).toList()} created=$r');
      final offer = offers.firstWhere((j) => j.requestId == requestId);
      final out = <String, String>{};
      Future<void> twice(String name, Future<Object?> Function() f) async {
        try { await f(); } on ApiException catch (e) { out[name] = 'FIRST CALL -> ${e.status} ${e.code}'; return; }
        try { await f(); out[name] = 'repeat OK'; } on ApiException catch (e) { out[name] = 'repeat -> ${e.status} ${e.code}'; }
      }
      await twice('accept', () => drv.accept(offer.offerId));
      final at = (await drv.job(offer.offerId)).arrival;
      final lat = at.warehouseLat ?? 24.7136, lng = at.warehouseLng ?? 46.6753;
      await twice('checkin', () => drv.checkIn(offer.offerId, lat: lat, lng: lng));
      if ((await drv.job(offer.offerId)).status == 'arrived') await biz.post('/offers/${offer.offerId}/attendance', {'present': true});
      await biz.post('/offers/${offer.offerId}/loading', {'all': true});
      await twice('loading-ack', () => drv.ackLoading(offer.offerId, true));
      var j = await drv.job(offer.offerId);
      final s1 = j.stops[0], s2 = j.stops[1], s3 = j.stops[2];
      await twice('arrive', () => drv.arriveStop(offer.offerId, s1.id, lat: lat, lng: lng));
      Future<Map<String, String>> codesNow() async {
        final r = await biz.get('/requests/$requestId/shipments', query: {'pageSize': '200'});
        return {for (final i in (r['items'] as List).cast<Map>()) if (i['demoOtp'] != null) '${i['id']}': '${i['demoOtp']}'};
      }
      var codes = await codesNow();
      codes = await codesNow(); // the recipient's code exists once his stop has been reached
      await twice('deliver', () => drv.deliverStop(offer.offerId, s1.id, code: s1.code, otp: codes[s1.id], lat: lat, lng: lng));
      await drv.arriveStop(offer.offerId, s2.id, lat: lat, lng: lng);
      codes = await codesNow();
      await twice('fail', () => drv.failStop(offer.offerId, s2.id, 'refused'));
      try { await drv.deliverStop(offer.offerId, s2.id, code: s2.code, otp: codes[s2.id]); out['deliver-after-fail'] = 'OK'; } on ApiException catch (e) { out['deliver-after-fail'] = '${e.status} ${e.code}'; }
      await drv.arriveStop(offer.offerId, s3.id, lat: lat, lng: lng);
      await twice('defer (no photo)', () => drv.deferStop(offer.offerId, s3.id, note: 'closed'));
      await twice('resend-code', () => drv.resendCode(offer.offerId, s3.id));
      j = await drv.job(offer.offerId);
      final open = j.stops.where((s) => s.status == 'loaded').toList();
      for (final s in open) { await drv.arriveStop(offer.offerId, s.id, lat: lat, lng: lng); codes = await codesNow(); await drv.deliverStop(offer.offerId, s.id, code: s.code, otp: codes[s.id]); }
      await twice('finish route (delivered)', () => drv.delivered(offer.offerId));
      await twice('withdrawal 100 SAR', () => drv.requestWithdrawal(10000));
      await twice('ticket', () async => DriverApi(drvClient).c.post('/tickets', {'category': 'other', 'subject': 'A6 duplicate probe', 'body': 'probe'}));
      // ignore: avoid_print
      out.forEach((k, v) => print('A6 repeat $k: $v'));
      expect(out, isNotEmpty);
    }, timeout: const Timeout(Duration(minutes: 3)));
  });
}
