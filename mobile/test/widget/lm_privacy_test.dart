import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show ApiException;
import 'package:jr_driver/features/privacy/privacy_screen.dart';
import 'package:jr_driver/features/privacy/privacy_widgets.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../helpers_lm.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:jr_driver/providers.dart';

/// Update L / M — Profile › Privacy & data: the card, the data download (share sheet) and the account-deletion request (blockers up-front, withdraw).
/// Scrolls [f] into view and lets the frame land (a tap uses the positions of the last frame).
Future<void> _show(WidgetTester t, Finder f) async { await t.ensureVisible(f); await t.pump(); }
Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Map<String, dynamic> _status({List<Map<String, Object?>> blockers = const [], Map<String, Object?>? request, bool supported = true, String? lastExport, bool canRequest = true}) => {
      'role': 'driver', 'export': {'available': true, 'lastAt': lastExport},
      'deletion': {'supported': supported, 'eligible': blockers.isEmpty, 'canRequest': canRequest && blockers.isEmpty && request?['status'] != 'requested', 'blockers': blockers, 'request': request},
      'retention': {'notificationDays': 90, 'recipientPiiMonths': 24, 'closedAccountYears': 5}, 'contact': {'privacyEmail': 'privacy@jr.test', 'phone': null},
    };

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('the Profile card', () {
        testWidgets('is there with download, delete and the privacy policy', (t) async {
          await pumpRoutedB(t, const ProfileScreen(), api: FakeApi());
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-card')));
          expect(find.text('Privacy & data'), findsOneWidget);
          expect(find.text('See what we keep about you, download a copy, or ask us to erase your account.'), findsOneWidget);
          expect(find.byKey(const Key('privacy-export')), findsOneWidget);
          expect(find.text('Delete my account'), findsOneWidget);
          await _show(t, find.byKey(const Key('privacy-open-delete')));
          await t.tap(find.byKey(const Key('privacy-open-delete')));
          await _settle(t);
          expect(find.text('PAGE:/privacy'), findsOneWidget);
        });

        testWidgets('the policy link opens the reader', (t) async {
          await pumpRoutedB(t, const ProfileScreen(), api: FakeApi());
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-policy-link')));
          await t.tap(find.byKey(const Key('privacy-policy-link')));
          await _settle(t);
          expect(find.text('PAGE:/legal/privacy'), findsOneWidget);
        });
      });

      group('download my data', () {
        testWidgets('fetches the file and hands it to the share sheet: name jr-my-data-<date>.json, JSON, the exact bytes', (t) async {
          final repo = FakePrivacyRepo(), sharer = FakeSharer();
          await pumpRoutedB(t, const Scaffold(body: Center(child: ExportDataButton())), api: FakeApi(), privacy: repo, sharer: sharer);
          await t.tap(find.byKey(const Key('privacy-export')));
          await _settle(t);
          expect(repo.calls, contains('export'));
          expect(sharer.shared.length, 1);
          expect(sharer.shared.single.filename, matches(RegExp(r'^jr-my-data-\d{4}-\d{2}-\d{2}\.json$')));
          expect(sharer.shared.single.mime, 'application/json');
          expect(sharer.shared.single.subject, 'My JR Logistics data');
          expect(utf8.decode(sharer.lastBytes!), '{"profile":{"name":"Omar"}}');
          expect(find.text('Your data file was downloaded.'), findsOneWidget);
        });

        testWidgets('one request at a time: while it runs the button shows progress and a second tap does nothing', (t) async {
          final repo = FakePrivacyRepo()..exportGate = Completer<void>(), sharer = FakeSharer();
          await pumpRoutedB(t, const Scaffold(body: Center(child: ExportDataButton())), api: FakeApi(), privacy: repo, sharer: sharer);
          await t.tap(find.byKey(const Key('privacy-export')));
          await t.pump();
          expect(find.text('Preparing your file…'), findsOneWidget);
          await t.tap(find.byKey(const Key('privacy-export')), warnIfMissed: false);
          await t.pump();
          repo.exportGate!.complete();
          await _settle(t);
          expect(repo.calls.where((c) => c == 'export').length, 1);
          expect(sharer.shared.length, 1);
          expect(find.text('Download my data'), findsOneWidget, reason: 'the button is back');
        });

        testWidgets('the rate limit (5 an hour) and a lost signal are plain messages; nothing is shared', (t) async {
          final repo = FakePrivacyRepo()..exportError = ApiException('RATE_LIMITED', 'x', status: 429), sharer = FakeSharer();
          await pumpRoutedB(t, const Scaffold(body: Center(child: ExportDataButton())), api: FakeApi(), privacy: repo, sharer: sharer);
          await t.tap(find.byKey(const Key('privacy-export')));
          await _settle(t);
          expect(find.textContaining('Too many'), findsOneWidget);
          expect(sharer.shared, isEmpty);
          repo.exportError = ApiException('NETWORK', 'x');
          await t.pump(const Duration(seconds: 7));
          await t.tap(find.byKey(const Key('privacy-export')));
          await _settle(t);
          expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
        });

        testWidgets('a share sheet that cannot open says the file was made but could not be shared', (t) async {
          final sharer = FakeSharer()..succeed = false;
          await pumpRoutedB(t, const Scaffold(body: Center(child: ExportDataButton())), api: FakeApi(), sharer: sharer);
          await t.tap(find.byKey(const Key('privacy-export')));
          await _settle(t);
          expect(find.text('The file was created but the share sheet could not be opened.'), findsOneWidget);
        });
      });

      group('the privacy page', () {
        testWidgets('shows the download, the retention periods, the contact and the policy link', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status(lastExport: '2026-11-20T08:00:00.000Z');
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          expect(find.text('Download my data'), findsWidgets);
          expect(find.text('Last downloaded 20 Nov 2026 · 11:00'), findsOneWidget);
          await _show(t, find.byKey(const Key('privacy-retention')));
          expect(find.textContaining('read notifications 90 days'), findsOneWidget);
          expect(find.text('Privacy questions: privacy@jr.test'), findsOneWidget);
          await _show(t, find.byKey(const Key('privacy-policy-link')));
          await t.tap(find.byKey(const Key('privacy-policy-link')));
          await _settle(t);
          expect(find.text('PAGE:/legal/privacy'), findsOneWidget);
        });

        testWidgets('what blocks the deletion is listed up-front (money, open jobs, cash) and the request button is off', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status(blockers: [{'code': 'wallet_funds', 'amountCents': 12500}, {'code': 'open_jobs', 'count': 2}, {'code': 'outstanding_cash', 'count': 1, 'amountCents': 80000}, {'code': 'brand_new_code'}]);
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-blockers')));
          expect(find.text('Not possible yet'), findsOneWidget);
          final text = t.widget<Text>(find.descendant(of: find.byKey(const Key('privacy-blockers')), matching: find.textContaining('Settle these first'))).data!;
          expect(text, contains('SAR 125.00 in your wallet'));
          expect(text, contains('2 job(s) in progress'));
          expect(text, contains('SAR 800.00 of cash on delivery not handed over yet (1 order(s))'));
          expect(text, contains('Something else must be settled first.'), reason: 'a blocker this app has no text for yet is still explained, never shown as a raw code');
          expect(text, isNot(contains('brand_new_code')));
          await _show(t, find.byKey(const Key('privacy-delete')));
          expect(t.widget<FilledButton>(find.byKey(const Key('privacy-delete'))).onPressed, isNull);
        });

        testWidgets('request: reason, then a confirmation; "Cancel" sends nothing; confirming sends the reason and shows the open request', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status();
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-reason')));
          await t.enterText(find.byKey(const Key('privacy-reason')), '  Changing jobs  ');
          await _show(t, find.byKey(const Key('privacy-delete')));
          await t.tap(find.byKey(const Key('privacy-delete')));
          await _settle(t);
          expect(find.text('Send the deletion request?'), findsOneWidget);
          await t.tap(find.text('Cancel'));
          await _settle(t);
          expect(repo.calls.where((c) => c.startsWith('delete')), isEmpty);
          await t.tap(find.byKey(const Key('privacy-delete')));
          await _settle(t);
          await t.tap(find.byKey(const Key('privacy-confirm')));
          await _settle(t);
          expect(repo.calls.where((c) => c.startsWith('delete')), ['delete:Changing jobs']);
          expect(find.text('Request sent'), findsOneWidget);
          await _show(t, find.byKey(const Key('privacy-request-open')));
          expect(find.text('Your deletion request is with our team'), findsOneWidget);
          expect(find.byKey(const Key('privacy-delete')), findsNothing, reason: 'one open request at a time');
        });

        testWidgets('an open request can be withdrawn', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status(request: {'id': 'pr1', 'status': 'requested', 'requestedAt': '2026-11-21T08:00:00.000Z'});
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-cancel-request')));
          expect(find.byKey(const Key('privacy-request-open')), findsOneWidget);
          await t.tap(find.byKey(const Key('privacy-cancel-request')));
          await _settle(t);
          expect(repo.calls, contains('cancel'));
          expect(find.text('Request withdrawn'), findsOneWidget);
          await _show(t, find.byKey(const Key('privacy-delete')));
          expect(find.byKey(const Key('privacy-request-open')), findsNothing);
          expect(t.widget<FilledButton>(find.byKey(const Key('privacy-delete'))).onPressed, isNotNull);
        });

        testWidgets('the server refusing (409 ERASURE_BLOCKED: something changed since the page loaded) is a message, and the page reloads', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status()..deleteError = ApiException('ERASURE_BLOCKED', 'x', status: 409, details: {'blockers': [{'code': 'open_jobs', 'count': 1}]});
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-delete')));
          await t.tap(find.byKey(const Key('privacy-delete')));
          await _settle(t);
          await t.tap(find.byKey(const Key('privacy-confirm')));
          await _settle(t);
          expect(find.textContaining('cannot be erased'), findsOneWidget);
          expect(repo.calls.where((c) => c == 'status').length, 2, reason: 'status was read again');
        });

        testWidgets('a declined request shows the team\'s reason, and he can ask again', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status(request: {'id': 'pr1', 'status': 'rejected', 'decisionNote': 'You still hold cash', 'requestedAt': '2026-11-01T08:00:00.000Z'});
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-request-rejected')));
          expect(find.text('Your last request was declined'), findsOneWidget);
          expect(find.text('You still hold cash'), findsOneWidget);
          expect(t.widget<FilledButton>(find.byKey(const Key('privacy-delete'))).onPressed, isNotNull);
        });

        testWidgets('an account this tool does not erase (staff) says so instead of offering a button', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status(supported: false);
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          await _show(t, find.byKey(const Key('privacy-unsupported')));
          expect(find.byKey(const Key('privacy-delete')), findsNothing);
        });

        testWidgets('a status that cannot be loaded has Retry', (t) async {
          final repo = FakePrivacyRepo()..statusError = ApiException('NETWORK', 'x');
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
          repo.statusError = null;
          await t.tap(find.byKey(const Key('retry')));
          await _settle(t);
          expect(find.byKey(const Key('privacy-delete-card')), findsOneWidget);
        });

        testWidgets('the app remembers an open request (so a session that ends afterwards can say "probably approved"), and forgets it when withdrawn', (t) async {
          final repo = FakePrivacyRepo()..statusJson = _status();
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo);
          await _settle(t);
          final c = ProviderScope.containerOf(t.element(find.byType(PrivacyScreen)));
          expect(c.read(prefsProvider).containsKey(deletionRequestKey), isFalse);
          await _show(t, find.byKey(const Key('privacy-delete')));
          await t.tap(find.byKey(const Key('privacy-delete')));
          await _settle(t);
          await t.tap(find.byKey(const Key('privacy-confirm')));
          await _settle(t);
          expect(c.read(prefsProvider).getBool(deletionRequestKey), isTrue);
          await _show(t, find.byKey(const Key('privacy-cancel-request')));
          await t.tap(find.byKey(const Key('privacy-cancel-request')));
          await _settle(t);
          expect(c.read(prefsProvider).containsKey(deletionRequestKey), isFalse);
        });

        testWidgets('the team approved it: the next call answers 401 and the sign-in page says the account may have been erased (not just "session expired")', (t) async {
          final c = await pumpFullApp(t, api: FakeApi(), prefs: {deletionRequestKey: true});
          expect(find.byKey(const Key('toggle')), findsOneWidget);
          c.read(authProvider.notifier).expire();
          await _settle(t);
          expect(find.byKey(const Key('session-ended-after-request')), findsOneWidget);
          expect(find.textContaining('your account has been erased'), findsOneWidget);
          expect(find.byKey(const Key('submit')), findsOneWidget);
        });

        testWidgets('a session that simply expired keeps the usual message', (t) async {
          final c = await pumpFullApp(t, api: FakeApi());
          c.read(authProvider.notifier).expire();
          await _settle(t);
          expect(find.byKey(const Key('session-ended-after-request')), findsNothing);
          expect(find.byKey(const Key('submit')), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: translated, right-to-left, no overflow at 1.4x', (t) async {
            t.platformDispatcher.textScaleFactorTestValue = 1.4;
            addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
            final repo = FakePrivacyRepo()..statusJson = _status(blockers: [{'code': 'wallet_funds', 'amountCents': 12500}, {'code': 'open_jobs', 'count': 2}]);
            await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo, lang: lang, size: const Size(640, 1400));
            await _settle(t);
            expect(Directionality.of(t.element(find.byKey(const Key('privacy-export-card')))), TextDirection.rtl);
            expect(find.text(lang == 'ar' ? 'تنزيل بياناتي' : 'میرا ڈیٹا ڈاؤن لوڈ کریں'), findsWidgets);
            for (var i = 0; i < 6; i++) { await t.drag(find.byType(Scrollable).first, const Offset(0, -400)); await t.pump(); }
            expect(t.takeException(), isNull);
          });
        }
      });
    });
  }
}
