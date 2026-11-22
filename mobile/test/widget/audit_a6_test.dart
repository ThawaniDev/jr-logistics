import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/jobs/chat_screen.dart';
import 'package:jr_driver/features/jobs/jobs_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/widgets/common.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// Audit K / A6 — behaviour fixes of the driver app, in light and in dark (see memory/audit/mobile.md).
Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Strings en() => strings('en');
const _lostAnswer = "No connection. We couldn't confirm that it went through. Check your signal and look at the list before trying again.";

Map<String, dynamic> entry(int n) => {'id': 'e$n', 'kind': 'payout', 'createdAt': '2026-11-20T10:00:00Z', 'availableDeltaCents': 1000 * n, 'heldDeltaCents': 0};
Map<String, dynamic> msg(int n, {String from = 'other'}) => {'id': 'm$n', 'senderId': from, 'senderName': 'Sara', 'senderRole': 'business', 'body': 'Message $n', 'createdAt': '2026-11-20T10:00:00Z'};

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));
      _suite();
    });
  }
}

void _suite() {
  group('older jobs, wallet entries and notifications load on demand (finding 1)', () {
    testWidgets('History: a "Load more" row appears while the server holds more, loads the next page, and goes away at the end', (t) async {
      final api = FakeApi()..historyPageSize = 3..historyJobs = [for (var i = 1; i <= 5; i++) mkJob(status: 'completed', extra: {'offerId': 'h$i', 'ref': 'JR-H$i'})];
      await pumpRouted(t, const JobsScreen(), api: api);
      await settle(t);
      await t.tap(find.text('History'));
      await settle(t);
      final more = find.byKey(const Key('load-more'));
      await t.scrollUntilVisible(more, 300, scrollable: find.byType(Scrollable).last);
      expect(find.textContaining('JR-H4'), findsNothing);
      await t.tap(more);
      await settle(t);
      expect(api.pagesAsked, [1, 2]);
      await t.scrollUntilVisible(find.textContaining('JR-H5'), 300, scrollable: find.byType(Scrollable).last);
      expect(find.byKey(const Key('load-more')), findsNothing, reason: 'all 5 are loaded');
    });

    testWidgets('Wallet: older ledger entries load with "Load more" (page 2), rows already shown are not repeated', (t) async {
      final api = FakeApi()
        ..walletPages = [
          {'availableCents': 20000, 'heldCents': 0, 'entries': [entry(1), entry(2)], 'total': 3, 'page': 1, 'pageSize': 2},
          {'availableCents': 20000, 'heldCents': 0, 'entries': [entry(2), entry(3)], 'total': 3, 'page': 2, 'pageSize': 2},
        ];
      await pumpRouted(t, const WalletScreen(), api: api);
      await settle(t);
      final more = find.byKey(const Key('load-more'));
      await t.scrollUntilVisible(more, 300, scrollable: find.byType(Scrollable).first);
      expect(find.byType(ListTile), findsNWidgets(2));
      await t.tap(more);
      await settle(t);
      expect(api.calls, contains('wallet:2'));
      await t.scrollUntilVisible(find.byType(ListTile).last, 300, scrollable: find.byType(Scrollable).first);
      expect(find.byType(ListTile), findsNWidgets(3), reason: 'entry 2 came twice and is shown once');
      expect(find.byKey(const Key('load-more')), findsNothing);
    });

    testWidgets('Notifications: older ones load with "Load more"', (t) async {
      Map<String, dynamic> n(int i) => {'id': 'n$i', 'type': 'job_completed', 'data': {'ref': 'JR-$i'}, 'readAt': '2026-11-20T10:00:00Z', 'createdAt': '2026-11-20T10:00:00Z'};
      final api = FakeApi()..notificationPages = [{'items': [n(1), n(2)], 'total': 3, 'page': 1, 'pageSize': 2}, {'items': [n(3)], 'total': 3, 'page': 2, 'pageSize': 2}];
      await pumpRouted(t, const NotificationsScreen(), api: api);
      await settle(t);
      final more = find.byKey(const Key('load-more'));
      await t.scrollUntilVisible(more, 300, scrollable: find.byType(Scrollable).first);
      await t.tap(more);
      await settle(t);
      expect(api.calls, contains('notifications:2'));
      expect(find.byKey(const Key('notif-n3'), skipOffstage: false), findsOneWidget);
      expect(find.byKey(const Key('load-more')), findsNothing);
    });
  });

  group('chat (finding 2, 5)', () {
    testWidgets('the 8-second poll does not throw a reader who scrolled up back to the bottom; it follows only when he is at the end', (t) async {
      final api = FakeApi()..chatMessages = [for (var i = 1; i <= 40; i++) msg(i)];
      await pumpScreen(t, const ChatScreen(offerId: 'o1'), api: api);
      await settle(t);
      final list = find.byType(ListView);
      final c = t.widget<ListView>(list).controller!;
      expect(c.offset, c.position.maxScrollExtent, reason: 'first load shows the newest message');
      c.jumpTo(0);
      await t.pump();
      api.chatMessages = [...api.chatMessages, msg(41)];
      await t.pump(const Duration(seconds: 9));
      await t.pump(const Duration(milliseconds: 50));
      expect(c.offset, 0, reason: 'a driver reading an earlier message stays where he is');
      c.jumpTo(c.position.maxScrollExtent);
      await t.pump();
      c.jumpTo(c.position.maxScrollExtent); // the extent of a lazy list is refined while it is scrolled: settle on the real end
      await t.pump();
      api.chatMessages = [...api.chatMessages, msg(42)];
      await t.pump(const Duration(seconds: 9));
      await t.pump(const Duration(milliseconds: 50));
      expect(c.position.maxScrollExtent - c.offset, lessThan(2), reason: 'at the end, a new message pulls the view along');
    });

    testWidgets('a lost answer to Send says "could not confirm", keeps the text and re-reads the conversation', (t) async {
      final api = FakeApi()..chatMessages = [msg(1)];
      await pumpScreen(t, const ChatScreen(offerId: 'o1'), api: api);
      await settle(t);
      final before = api.messageFetches;
      await t.enterText(find.byKey(const Key('chat-input')), 'On my way');
      await t.pump();
      api.errorOnNext = ApiException('NETWORK', 'offline');
      await t.tap(find.byKey(const Key('chat-send')));
      await settle(t);
      expect(find.text(_lostAnswer), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('chat-input'))).controller!.text, 'On my way');
      expect(api.messageFetches, greaterThan(before), reason: 'the list shows whether it arrived');
    });
  });

  group('wallet withdrawal (finding 3, 7)', () {
    Future<FakeApi> openSheet(WidgetTester t, {int min = 10000}) async {
      final api = FakeApi()..minWithdrawalCents = min..walletPages = [{'availableCents': 50000, 'heldCents': 0, 'entries': [], 'total': 0, 'page': 1, 'pageSize': 50}];
      await pumpRouted(t, const WalletScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('withdraw')));
      await settle(t);
      return api;
    }

    bool submitEnabled(WidgetTester t) => t.widget<FilledButton>(find.byKey(const Key('withdraw-submit'))).onPressed != null;

    testWidgets('the sheet states the platform minimum and refuses amounts below it', (t) async {
      await openSheet(t);
      expect(find.textContaining('The minimum withdrawal is SAR 100.00.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('amount')), '50');
      await t.pump();
      expect(submitEnabled(t), isFalse);
      await t.enterText(find.byKey(const Key('amount')), '100');
      await t.pump();
      expect(submitEnabled(t), isTrue);
      await t.enterText(find.byKey(const Key('amount')), '500.01');
      await t.pump();
      expect(submitEnabled(t), isFalse, reason: 'more than the balance');
    });

    testWidgets('a 20-digit amount does not break the sheet', (t) async {
      await openSheet(t);
      await t.enterText(find.byKey(const Key('amount')), '99999999999999999999');
      await t.pump();
      expect(t.takeException(), isNull);
      expect(submitEnabled(t), isFalse);
    });

    testWidgets('when the server answers VALIDATION {min} the toast names the minimum, not "some details are invalid"', (t) async {
      final api = await openSheet(t, min: 0); // the catalog did not know the minimum
      await t.enterText(find.byKey(const Key('amount')), '50');
      await t.pump();
      api.errorOnNext = ApiException('VALIDATION', 'Amount below minimum withdrawal', status: 422, details: {'min': 10000});
      await t.tap(find.byKey(const Key('withdraw-submit')));
      await settle(t);
      expect(find.text('The minimum withdrawal is SAR 100.00.'), findsOneWidget);
      expect(find.text('Some details are missing or invalid.'), findsNothing);
    });

    testWidgets('a balance below the minimum disables the button and says why', (t) async {
      final api = FakeApi()..minWithdrawalCents = 10000..walletPages = [{'availableCents': 5000, 'heldCents': 0, 'entries': [], 'total': 0, 'page': 1, 'pageSize': 50}];
      await pumpRouted(t, const WalletScreen(), api: api);
      await settle(t);
      expect(t.widget<FilledButton>(find.byKey(const Key('withdraw'))).onPressed, isNull);
      expect(find.byKey(const Key('withdraw-min-hint')), findsOneWidget);
    });
  });

  group('writes whose answer may have been lost (finding 5)', () {
    testWidgets('Accept: a network failure says "could not confirm" and refreshes the lists', (t) async {
      final api = FakeApi()..offerList = [mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'recipient': null, 'pickup': null, 'delivery': null})];
      await pumpRouted(t, const OffersScreen(), api: api);
      await settle(t);
      await t.tap(find.byKey(const Key('accept-o1')));
      await settle(t);
      await t.tap(find.byKey(const Key('terms-check')));
      await t.pump();
      api.errorOnNext = ApiException('TIMEOUT', 'slow');
      await t.tap(find.byKey(const Key('confirm-accept')));
      await settle(t);
      expect(find.text(_lostAnswer), findsOneWidget);
      expect(find.text('JOB-PAGE-o1'), findsNothing, reason: 'nothing is known to have been accepted: no navigation');
    });
  });

  group('sign-in and sign-out (D2, finding 6)', () {
    Future<void> signIn(WidgetTester t) async {
      await t.enterText(find.byKey(const Key('username')), 'someone');
      await t.enterText(find.byKey(const Key('password')), 'Secret#Pass2026');
      await t.pump();
      await t.tap(find.byKey(const Key('submit')));
      await settle(t);
    }

    testWidgets('a business account typed into the driver app is refused AND its server session is revoked', (t) async {
      final api = FakeApi()..loginResult = {'token': 'tok-business', 'user': {'id': 'b1', 'role': 'business', 'name': 'Sara', 'username': 'demo.business', 'language': 'en'}};
      await pumpScreen(t, const LoginScreen(), api: api);
      await settle(t);
      await signIn(t);
      expect(t.widget<Text>(find.byKey(const Key('login-error'))).data, en()('m.driver_only'));
      expect(api.calls, contains('revoke:tok-business'));
    });

    testWidgets('a driver with two-step verification (no session yet) has nothing to revoke', (t) async {
      final api = FakeApi()..loginResult = {'mfaRequired': true, 'mfaToken': 'm'};
      await pumpScreen(t, const LoginScreen(), api: api);
      await settle(t);
      await signIn(t);
      expect(find.byKey(const Key('login-error')), findsOneWidget);
      expect(api.calls.where((c) => c.startsWith('revoke')), isEmpty);
    });

    testWidgets('a driver who signs out goes offline (and loses his location) BEFORE the session is ended', (t) async {
      final api = FakeApi();
      await pumpRoutedB(t, const ProfileScreen(), api: api, extraApi: FakeExtraApi());
      await settle(t);
      await t.scrollUntilVisible(find.byIcon(Icons.logout), 300, scrollable: find.byType(Scrollable).first);
      await t.tap(find.byIcon(Icons.logout));
      await settle(t);
      await t.tap(find.widgetWithText(FilledButton, en()('auth.logout')));
      await settle(t);
      expect(api.calls.where((c) => c == 'goOffline' || c == 'logout'), ['goOffline', 'logout']);
    });
  });

  group('a server value this app has no text for (finding 8)', () {
    testWidgets('a status of a newer server reads as its name, never as a raw dictionary key', (t) async {
      await pumpScreen(t, const Scaffold(body: Column(children: [StatusPill('on_hold'), StatusPill('completed')])), api: FakeApi());
      await settle(t);
      expect(find.text('on hold'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      expect(find.textContaining('jobstatus.'), findsNothing);
    });
  });
}
