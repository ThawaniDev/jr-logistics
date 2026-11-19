import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/app.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/router.dart';
import 'package:jr_driver/services.dart';
import 'package:jr_driver/services_notify.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

String _ago(Duration d) => DateTime.now().toUtc().subtract(d).toIso8601String();

class _NotifApi extends FakeApi {
  Json result = {'items': [], 'unread': 0};
  int fetches = 0;
  @override
  Future<Json> notifications() async { fetches++; return result; }
}

void main() {
  group('New-offer alerts inside the real app (poller + local notification + banner + tab dot)', () {
    Future<ProviderContainer> pumpApp(WidgetTester t, {required FakeExtraApi ex, required FakeNotifier n, FakeApi? api}) async {
      SharedPreferences.setMockInitialValues({'lang': 'en'});
      final prefs = await SharedPreferences.getInstance();
      t.view.physicalSize = const Size(900, 1900);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      await t.pumpWidget(ProviderScope(
        retry: (_, _) => null,
        overrides: [
          prefsProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(api ?? FakeApi()), tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
          authProvider.overrideWith(SignedInAuth.new), stringsProvider.overrideWith((ref) async => strings('en')), linkOpenerProvider.overrideWithValue(FakeLinks()), locationServiceProvider.overrideWithValue(FakeLocation()),
          ...extraOverrides(api: ex, notifier: n),
        ],
        child: const JrApp(),
      ));
      for (var i = 0; i < 5; i++) { await t.pump(const Duration(milliseconds: 200)); }
      return ProviderScope.containerOf(t.element(find.byType(JrApp)));
    }

    AppNotification offer(String id, {String ref = 'JR-000042', String? created}) => AppNotification(mkNotification(id, 'offer_new', createdAt: created ?? _ago(const Duration(minutes: 2)), data: {'ref': ref, 'parcels': 12, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah', 'offerId': 'o-$id', 'requestId': 'r-$id', 'earningCents': 9000}));

    testWidgets('a new offer → a device notification, a haptic-backed banner, a dot on the Offers tab; a repeat poll does NOT repeat it', (t) async {
      final ex = FakeExtraApi()..unread = [offer('n1')];
      final n = FakeNotifier(permission: true);
      final c = await pumpApp(t, ex: ex, n: n);
      expect(n.shown.length, 1);
      expect(n.shown.single.title, 'New job offer');
      expect(n.shown.single.body, 'New job offer JR-000042: 12 parcels, Riyadh → Jeddah');
      expect(n.shown.single.payload, 'offers');
      expect(n.shown.single.channelName, 'New offers');
      expect(find.byKey(const Key('offer-banner')), findsOneWidget, reason: 'the app is in the foreground');
      expect(find.text('New job offer JR-000042: 12 parcels, Riyadh → Jeddah'), findsOneWidget);
      expect(c.read(offerAlertsProvider).unseen, 1);
      expect(t.widget<Badge>(find.byKey(const Key('offers-badge'))).isLabelVisible, isTrue);
      // 20 s later: the same unread notification is still on the server — no second alert
      await t.pump(const Duration(seconds: 21));
      await t.pump(const Duration(milliseconds: 100));
      expect(ex.calls.where((x) => x == 'unread').length, greaterThanOrEqualTo(2), reason: 'it polled again');
      expect(n.shown.length, 1);
      // a new one arrives
      ex.unread = [offer('n2', ref: 'JR-000043'), offer('n1')];
      await t.pump(const Duration(seconds: 21));
      await t.pump(const Duration(milliseconds: 100));
      expect(n.shown.length, 2);
      expect(n.shown.last.body, contains('JR-000043'));
    });

    testWidgets('"View" on the banner and a tap on the system notification both open the Offers tab', (t) async {
      final ex = FakeExtraApi()..unread = [offer('n1')];
      final n = FakeNotifier(permission: true);
      final c = await pumpApp(t, ex: ex, n: n);
      final router = c.read(routerProvider);
      expect(router.state.matchedLocation, '/');
      await t.tap(find.text('View'));
      await t.pump(); await t.pump(const Duration(milliseconds: 300));
      expect(router.state.matchedLocation, '/offers');
      expect(find.byType(OffersScreen), findsOneWidget);
      router.go('/');
      await t.pump(); await t.pump(const Duration(milliseconds: 300));
      n.tapController.add('offers');
      await t.pump(); await t.pump(const Duration(milliseconds: 300));
      expect(router.state.matchedLocation, '/offers');
    });

    testWidgets('the notification that STARTED the app opens the Offers tab', (t) async {
      final n = FakeNotifier(permission: true)..launch = 'offers';
      final c = await pumpApp(t, ex: FakeExtraApi(), n: n);
      expect(c.read(routerProvider).state.matchedLocation, '/offers');
    });

    testWidgets('several offers at once: the first three are separate notifications, the rest are summarised, one banner', (t) async {
      final ex = FakeExtraApi()..unread = [for (var i = 5; i >= 1; i--) offer('n$i', ref: 'JR-00000$i', created: _ago(Duration(minutes: 10 - i)))];
      final n = FakeNotifier(permission: true);
      await pumpApp(t, ex: ex, n: n);
      expect(n.shown.length, 3, reason: '2 separate + 1 "+3 more" summary');
      expect(n.shown.any((x) => x.body == '+3 more new offers'), isTrue);
      expect(find.text('5 new job offers'), findsOneWidget);
    });

    testWidgets('offers older than the cut-off are not announced (a fresh install must not replay old news)', (t) async {
      final ex = FakeExtraApi()..unread = [offer('old', created: _ago(const Duration(days: 2)))];
      final n = FakeNotifier(permission: true);
      await pumpApp(t, ex: ex, n: n);
      expect(n.shown, isEmpty);
      expect(find.byKey(const Key('offer-banner')), findsNothing);
    });

    testWidgets('signing out stops the poller and clears the notifications', (t) async {
      final ex = FakeExtraApi()..unread = [offer('n1')];
      final n = FakeNotifier(permission: true);
      final c = await pumpApp(t, ex: ex, n: n);
      final polled = ex.calls.where((x) => x == 'unread').length;
      c.read(authProvider.notifier).expire();
      await t.pump(); await t.pump(const Duration(milliseconds: 300));
      expect(c.read(offerPollerProvider), isNull);
      expect(n.cancelled, greaterThan(0));
      await t.pump(const Duration(seconds: 61));
      expect(ex.calls.where((x) => x == 'unread').length, polled, reason: 'no polling after logout');
    });

    testWidgets('a failing poll is silent (no error screen, no toast) and the app keeps working', (t) async {
      final ex = FakeExtraApi()..unreadError = ApiException('NETWORK', 'x');
      final n = FakeNotifier(permission: true);
      await pumpApp(t, ex: ex, n: n);
      expect(find.byKey(const Key('retry')), findsNothing);
      expect(find.byType(SnackBar), findsNothing);
      expect(n.shown, isEmpty);
    });
  });

  group('Notifications screen (E12)', () {
    Future<(_NotifApi, FakeExtraApi, FakeNotifier)> open(WidgetTester t, List<Json> items, {String lang = 'en', FakeNotifier? notifier, Map<String, Object> prefs = const {}}) async {
      final api = _NotifApi()..result = {'items': items, 'unread': items.where((e) => e['readAt'] == null).length};
      final ex = FakeExtraApi();
      final n = notifier ?? FakeNotifier(permission: true);
      await pumpRoutedB(t, const NotificationsScreen(), api: api, extraApi: ex, notifier: n, lang: lang, prefsValues: prefs);
      await settleB(t);
      return (api, ex, n);
    }

    final sample = [
      mkNotification('n1', 'offer_new', data: {'ref': 'JR-000042', 'parcels': 12, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'}),
      mkNotification('n2', 'cod_received', data: {'ref': 'JR-000040', 'amountCents': 50000}),
      mkNotification('n3', 'ticket_resolved', data: {'ref': 'TK-000007'}, readAt: '2026-12-01T08:00:00Z'),
      mkNotification('n4', 'something_new_from_the_server', data: {}, readAt: '2026-12-01T08:00:00Z'),
    ];

    testWidgets('renders every type with its own i18n text (offer cities localized, cash in riyals), unknown types with the generic line', (t) async {
      await open(t, sample);
      expect(find.text('New job offer JR-000042: 12 parcels, Riyadh → Jeddah'), findsOneWidget);
      expect(find.text('JR-000040: the warehouse received SAR 500.00 of your cash'), findsOneWidget);
      expect(find.text('Ticket TK-000007 was resolved'), findsOneWidget);
      expect(find.text('You have a new update.'), findsOneWidget);
    });

    testWidgets('unread ones are highlighted (dot + bold), read ones are plain', (t) async {
      await open(t, sample);
      expect(find.byKey(const Key('notif-dot-n1')), findsOneWidget);
      expect(find.byKey(const Key('notif-dot-n2')), findsOneWidget);
      expect(find.byKey(const Key('notif-dot-n3')), findsNothing);
      expect(find.byKey(const Key('notif-dot-n4')), findsNothing);
      FontWeight? weight(String text) => t.widget<Text>(find.text(text)).style?.fontWeight;
      expect(weight('Ticket TK-000007 was resolved'), FontWeight.w400);
      expect(weight('New job offer JR-000042: 12 parcels, Riyadh → Jeddah'), FontWeight.w700);
    });

    testWidgets('"Mark all as read" marks everything on the server and refreshes; it is hidden when nothing is unread', (t) async {
      final (api, ex, _) = await open(t, sample);
      expect(find.byKey(const Key('notif-mark-all')), findsOneWidget);
      api.result = {'items': [for (final e in sample) {...e, 'readAt': '2026-12-02T08:00:00Z'}], 'unread': 0};
      final before = api.fetches;
      await t.tap(find.byKey(const Key('notif-mark-all')));
      await settleB(t);
      expect(ex.calls, contains('markRead:all'));
      expect(api.fetches, greaterThan(before), reason: 'list reloaded');
      expect(find.byKey(const Key('notif-mark-all')), findsNothing);
      expect(find.byKey(const Key('notif-dot-n1')), findsNothing);
    });

    testWidgets('tapping routes by type — offer → Offers, cash → Cash, ticket → Support — and marks that notification read', (t) async {
      final (_, ex, _) = await open(t, sample);
      await t.tap(find.byKey(const Key('notif-n1')));
      await settleB(t);
      expect(find.text('PAGE:/offers'), findsOneWidget);
      expect(ex.calls, contains('markRead:n1'));
    });

    for (final c in [('n2', 'PAGE:/cash'), ('n3', 'PAGE:/support')]) {
      testWidgets('${c.$1} opens ${c.$2}', (t) async {
        await open(t, sample);
        await t.tap(find.byKey(Key('notif-${c.$1}')));
        await settleB(t);
        expect(find.text(c.$2), findsOneWidget);
      });
    }

    testWidgets('a chat message opens that job\'s chat; wallet and document notifications open their pages', (t) async {
      await open(t, [
        mkNotification('c1', 'chat_message', data: {'ref': 'JR-000042', 'offerId': 'o7'}),
        mkNotification('w1', 'payout_paid'),
        mkNotification('d1', 'document_approved'),
      ]);
      await t.tap(find.byKey(const Key('notif-c1')));
      await settleB(t);
      expect(find.text('CHAT-PAGE-o7'), findsOneWidget);
    });

    testWidgets('a notification with nowhere to go and already read is not a button', (t) async {
      await open(t, sample);
      await t.tap(find.byKey(const Key('notif-n4')));
      await settleB(t);
      expect(find.byType(NotificationsScreen), findsOneWidget);
    });

    testWidgets('empty state', (t) async {
      await open(t, []);
      expect(find.text('No notifications'), findsOneWidget);
    });

    testWidgets('if the driver turned the system permission down, a banner says how to turn alerts back on (and opens Settings)', (t) async {
      final n = FakeNotifier(permission: false);
      await open(t, sample, notifier: n, prefs: {'notif_asked': true});
      expect(find.byKey(const Key('notify-off')), findsOneWidget);
      await t.tap(find.text('Open Settings'));
      await settleB(t);
      expect(n.settingsOpened, 1);
    });

    testWidgets('no such banner while alerts are on, or before the driver was ever asked', (t) async {
      await open(t, sample, notifier: FakeNotifier(permission: true), prefs: {'notif_asked': true});
      expect(find.byKey(const Key('notify-off')), findsNothing);
      await t.pumpWidget(const SizedBox());
      await open(t, sample, notifier: FakeNotifier(permission: false));
      expect(find.byKey(const Key('notify-off')), findsNothing);
    });

    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang: texts come from the dictionary (no raw keys, no English city keys)', (t) async {
        await open(t, sample, lang: lang);
        final s = strings(lang);
        expect(find.text(s('notif.offer_new', {'ref': 'JR-000042', 'parcels': '12', 'pickupCity': s('city.riyadh'), 'deliveryCity': s('city.jeddah')})), findsOneWidget);
        expect(find.textContaining('notif.'), findsNothing);
      });
    }
  });
}
