import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/services_notify.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// A timer the test drives by hand.
class _ManualTimer implements Timer {
  _ManualTimer(this.every, this.fire);
  final Duration every;
  final void Function() fire;
  bool cancelled = false;
  @override
  void cancel() => cancelled = true;
  @override
  bool get isActive => !cancelled;
  @override
  int get tick => 0;
}

AppNotification _offer(String id, {String? readAt, String? createdAt, String type = 'offer_new', Map<String, dynamic>? data}) =>
    AppNotification(mkNotification(id, type, readAt: readAt, createdAt: createdAt, data: data ?? {'ref': 'JR-$id', 'parcels': 5, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah', 'offerId': 'o-$id', 'earningCents': 9000}));

void main() {
  late DateTime now;
  late List<_ManualTimer> timers;
  late MemorySeenStore seen;
  late List<List<String>> alerts;
  late List<AppNotification> server;
  late int fetches;
  Object? fetchError;
  Completer<void>? fetchGate;

  OfferPoller make({Duration maxAge = const Duration(hours: 6), int maxSeen = 300, MemorySeenStore? store}) => OfferPoller(
        fetch: () async { fetches++; await fetchGate?.future; if (fetchError != null) throw fetchError!; return List.of(server); },
        seen: store ?? seen, onAlerts: (l) => alerts.add([for (final n in l) n.id]), maxAge: maxAge, maxSeen: maxSeen,
        now: () => now, periodic: (every, fire) { final t = _ManualTimer(every, fire); timers.add(t); return t; },
      );

  setUp(() {
    now = DateTime.utc(2026, 12, 1, 12);
    timers = [];
    seen = MemorySeenStore();
    alerts = [];
    server = [];
    fetches = 0;
    fetchError = null;
    fetchGate = null;
  });

  group('OfferPoller — one alert per new offer', () {
    test('an unseen offer_new raises exactly one alert, however often it is polled', () async {
      server = [_offer('a', createdAt: '2026-12-01T11:59:00Z')];
      final p = make()..start(immediate: false);
      await p.pollOnce(); await p.pollOnce(); await p.pollOnce();
      expect(alerts, [['a']]);
      expect(seen.load(), ['a']);
    });

    test('offers are announced oldest first (the newest ends up on top of the notification shade)', () async {
      server = [_offer('c', createdAt: '2026-12-01T11:59:00Z'), _offer('b', createdAt: '2026-12-01T11:58:00Z'), _offer('a', createdAt: '2026-12-01T11:57:00Z')]; // newest first, like the API
      final p = make()..start(immediate: false);
      await p.pollOnce();
      expect(alerts, [['a', 'b', 'c']]);
    });

    test('later polls only announce what is new since', () async {
      server = [_offer('a', createdAt: '2026-12-01T11:50:00Z')];
      final p = make()..start(immediate: false);
      await p.pollOnce();
      server = [_offer('b', createdAt: '2026-12-01T11:59:00Z'), ...server];
      await p.pollOnce();
      expect(alerts, [['a'], ['b']]);
    });

    test('dedupe survives a restart: a new poller with the same store stays quiet', () async {
      server = [_offer('a', createdAt: '2026-12-01T11:50:00Z')];
      await (make()..start(immediate: false)).pollOnce();
      final again = make()..start(immediate: false);
      await again.pollOnce();
      expect(alerts, [['a']]);
    });

    test('other notification types, already-read ones and id-less rows never alert', () async {
      server = [
        _offer('t', type: 'ticket_reply'), _offer('c', type: 'cod_received'), _offer('r', readAt: '2026-12-01T11:00:00Z', createdAt: '2026-12-01T11:50:00Z'),
        AppNotification({'type': 'offer_new', 'data': {}}),
      ];
      await (make()..start(immediate: false)).pollOnce();
      expect(alerts, isEmpty);
    });

    test('an old offer (older than maxAge) is remembered but not announced — a fresh install must not replay yesterday', () async {
      server = [_offer('old', createdAt: '2026-11-30T12:00:00Z'), _offer('new', createdAt: '2026-12-01T11:00:00Z')];
      final p = make()..start(immediate: false);
      await p.pollOnce();
      expect(alerts, [['new']]);
      expect(seen.load(), containsAll(['old', 'new']));
    });

    test('the injected clock decides what "old" means', () async {
      server = [_offer('a', createdAt: '2026-12-01T11:00:00Z')];
      now = DateTime.utc(2026, 12, 1, 18); // 7 h later
      await (make()..start(immediate: false)).pollOnce();
      expect(alerts, isEmpty);
    });

    test('the remembered ids are capped (the oldest are forgotten first)', () async {
      server = [for (var i = 0; i < 12; i++) _offer('n$i', createdAt: '2026-12-01T11:${(10 + i).toString().padLeft(2, '0')}:00Z')];
      final p = make(maxSeen: 5)..start(immediate: false);
      await p.pollOnce();
      expect(seen.load().length, 5);
      expect(alerts.single.length, 12);
    });
  });

  group('OfferPoller — scheduling', () {
    test('starts with an immediate poll and a 20 s foreground timer; stop() cancels it', () async {
      final p = make()..start();
      await Future<void>.delayed(Duration.zero);
      expect(fetches, 1);
      expect(timers.single.every, const Duration(seconds: 20));
      expect(p.running, isTrue);
      p.stop();
      expect(timers.single.cancelled, isTrue);
      expect(p.running, isFalse);
      await p.pollOnce();
      expect(fetches, 1, reason: 'a stopped poller never polls');
    });

    test('each timer tick polls', () async {
      final p = make()..start(immediate: false);
      timers.single.fire();
      await Future<void>.delayed(Duration.zero);
      timers.single.fire();
      await Future<void>.delayed(Duration.zero);
      expect(fetches, 2);
      p.stop();
    });

    test('background = slower timer; coming back polls at once and restores the 20 s rhythm', () async {
      final p = make()..start(immediate: false);
      p.setForeground(false);
      expect(timers.first.cancelled, isTrue);
      expect(timers.last.every, const Duration(seconds: 60));
      expect(fetches, 0, reason: 'going to the background does not poll');
      p.setForeground(true);
      await Future<void>.delayed(Duration.zero);
      expect(fetches, 1, reason: 'resume polls immediately');
      expect(timers.last.every, const Duration(seconds: 20));
      p.stop();
    });

    test('one poll at a time: a tick while a request is in flight does nothing', () async {
      fetchGate = Completer<void>();
      final p = make()..start(immediate: false);
      final first = p.pollOnce();
      await p.pollOnce(); await p.pollOnce();
      expect(fetches, 1);
      fetchGate!.complete();
      await first;
      await p.pollOnce();
      expect(fetches, 2);
    });

    test('a network error is swallowed and the next poll still works', () async {
      fetchError = StateError('offline');
      server = [_offer('a', createdAt: '2026-12-01T11:59:00Z')];
      final p = make()..start(immediate: false);
      await p.pollOnce();
      expect(alerts, isEmpty);
      fetchError = null;
      await p.pollOnce();
      expect(alerts, [['a']]);
    });

    test('logout while a request is in flight: its answer is ignored (no alert, nothing remembered)', () async {
      fetchGate = Completer<void>();
      server = [_offer('a', createdAt: '2026-12-01T11:59:00Z')];
      final p = make()..start(immediate: false);
      final f = p.pollOnce();
      p.stop();
      fetchGate!.complete();
      await f;
      expect(alerts, isEmpty);
      expect(seen.load(), isEmpty);
    });

    test('start() twice does not create a second timer', () {
      final p = make()..start(immediate: false)..start(immediate: false);
      expect(timers.length, 1);
      p.stop();
    });
  });

  group('device notification helpers', () {
    test('stableNotificationId: deterministic, positive, 31-bit, and different ids differ', () {
      expect(stableNotificationId('abc'), stableNotificationId('abc'));
      expect(stableNotificationId('abc'), isNot(stableNotificationId('abd')));
      for (final s in ['', 'x', '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab']) { final v = stableNotificationId(s); expect(v, greaterThan(0)); expect(v, lessThanOrEqualTo(0x7fffffff)); }
    });

    test('offerNotice: title + notif.offer_new with ref, parcels and localized cities', () {
      final t = strings('en');
      final m = offerNotice(t, _offer('x', data: {'ref': 'JR-000042', 'parcels': 12, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'}));
      expect(m.title, 'New job offer');
      expect(m.body, 'New job offer JR-000042: 12 parcels, Riyadh → Jeddah');
      final ar = offerNotice(strings('ar'), _offer('x', data: {'ref': 'JR-000042', 'parcels': 12, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'}));
      expect(ar.body, contains('JR-000042')); expect(ar.body, contains('12'));
      expect(ar.body, isNot(contains('riyadh')), reason: 'cities are translated, never shown as keys');
    });
  });
}
