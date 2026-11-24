import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

/// Update L / M — (1) the new notification types in the notification list (text, icon, where a tap goes), (2) the "Contact support" card.
Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Map<String, dynamic> _n(String type, Map<String, Object?> data) => mkNotification('n-$type', type, data: data);

/// type → (data, text in English, icon, where a tap goes)
final _cases = <String, ({Map<String, Object?> data, String text, IconData icon, String? route})>{
  'cash_limit_warning': (data: {'amount': '2400.00', 'limit': '3000.00', 'pct': 80, 'days': 1, 'maxDays': 3}, text: 'You hold SAR 2400.00 in cash — 80% of your SAR 3000.00 limit. Hand it over to the warehouse to keep receiving jobs.', icon: Icons.payments_outlined, route: '/cash'),
  'cash_overdue': (data: {'amount': '2400.00', 'limit': '3000.00', 'pct': 80, 'days': 4, 'maxDays': 3}, text: 'Overdue cash: SAR 2400.00 has been with you for 4 days (the maximum is 3). Hand it over to the warehouse now.', icon: Icons.warning_amber_rounded, route: '/cash'),
  'cash_blocked': (data: {'amount': '3100.00', 'limit': '3000.00', 'pct': 103, 'days': 1, 'maxDays': 3}, text: 'New jobs are paused: you hold SAR 3100.00 in cash, over your SAR 3000.00 limit. Hand it over to the warehouse to receive offers again.', icon: Icons.warning_amber_rounded, route: '/cash'),
  'document_expiring': (data: {'documentId': 'd1', 'docType': 'driving_license', 'days': 7, 'expiresOn': '2026-11-29', 'threshold': 7}, text: 'Your Driving license expires on 2026-11-29 — 7 day(s) left. Upload the renewed document in time so your account is not interrupted.', icon: Icons.event_busy_outlined, route: '/documents'),
  'balance_moved_to_office': (data: {'amountCents': 12550, 'office': 'Najd Express'}, text: 'Your remaining wallet balance of 125.50 SAR was moved to your office Najd Express.', icon: Icons.account_balance_wallet_outlined, route: '/wallet'),
  'stop_marked_delivered': (data: {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'}, text: 'JR-000042: operations marked parcel JR-000042-003 as delivered for you', icon: Icons.fact_check_outlined, route: '/job/o1'),
  'stop_marked_failed': (data: {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'}, text: 'JR-000042: operations marked parcel JR-000042-003 as not delivered for you', icon: Icons.fact_check_outlined, route: '/job/o1'),
  'parcels_added': (data: {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'count': 3}, text: 'JR-000042: 3 parcel(s) were added to your job — the warehouse will hand them over', icon: Icons.inventory_2_outlined, route: '/job/o1'),
  'recipient_corrected': (data: {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'}, text: 'JR-000042: recipient details of parcel JR-000042-003 were corrected — check the stop', icon: Icons.edit_location_alt_outlined, route: '/job/o1'),
  'offer_rescheduled': (data: {'requestId': 'r1', 'ref': 'JR-000042'}, text: 'JR-000042: the time or pickup address of this job changed — check it before you accept', icon: Icons.update, route: '/offers'),
  'broadcast': (data: {'message': 'The warehouse is closed on Friday', 'broadcastId': 'b1', 'link': '/driver/opportunities'}, text: 'The warehouse is closed on Friday', icon: Icons.campaign_outlined, route: '/offers'),
  'privacy_request_rejected': (data: {'reason': 'You still hold cash'}, text: 'Your account-erasure request was declined: You still hold cash', icon: Icons.privacy_tip_outlined, route: '/privacy'),
};

void main() {
  for (final mode in Brightness.values) {
    group('${mode.name} mode', () {
      setUp(() => useBrightness(mode));
      tearDown(() => useBrightness(Brightness.dark));

      group('new notification types', () {
        for (final e in _cases.entries) {
          testWidgets('${e.key}: text, icon and where a tap goes', (t) async {
            final api = FakeApi()..notificationPages = [{'items': [_n(e.key, e.value.data)], 'unread': 1, 'total': 1}];
            await pumpRoutedB(t, const NotificationsScreen(), api: api, extraApi: FakeExtraApi());
            await _settle(t);
            final card = find.byKey(Key('notif-n-${e.key}'));
            expect(card, findsOneWidget);
            expect(find.descendant(of: card, matching: find.text(e.value.text)), findsOneWidget, reason: e.key);
            expect(find.descendant(of: card, matching: find.byIcon(e.value.icon)), findsOneWidget, reason: '${e.key} icon');
            expect(find.descendant(of: card, matching: find.byIcon(Icons.chevron_right)), e.value.route == null ? findsNothing : findsOneWidget);
            if (e.value.route != null) {
              await t.tap(card);
              await _settle(t);
              final expected = e.value.route!.startsWith('/job/') ? 'JOB-PAGE-${e.value.route!.substring(5)}' : 'PAGE:${e.value.route}';
              expect(find.text(expected), findsOneWidget, reason: e.key);
            }
          });
        }

        testWidgets('a broadcast with no link (or a link the app does not have) is read-only text', (t) async {
          final api = FakeApi()..notificationPages = [{'items': [_n('broadcast', {'message': 'Hello drivers', 'broadcastId': 'b1'}), mkNotification('n2', 'broadcast', data: {'message': 'Admin only', 'link': '/admin/secret'}, readAt: '2026-12-01T07:00:00.000Z')], 'unread': 1, 'total': 2}];
          await pumpRoutedB(t, const NotificationsScreen(), api: api, extraApi: FakeExtraApi());
          await _settle(t);
          expect(find.text('Hello drivers'), findsOneWidget);
          expect(find.text('Admin only'), findsOneWidget);
          expect(find.byIcon(Icons.chevron_right), findsNothing);
        });

        testWidgets('Arabic: cash and document texts in Arabic with the document name localized', (t) async {
          final api = FakeApi()..notificationPages = [{'items': [_n('document_expiring', _cases['document_expiring']!.data), _n('cash_blocked', _cases['cash_blocked']!.data)], 'unread': 2, 'total': 2}];
          await pumpRoutedB(t, const NotificationsScreen(), api: api, extraApi: FakeExtraApi(), lang: 'ar');
          await _settle(t);
          expect(find.textContaining('رخصة القيادة'), findsOneWidget);
          expect(find.textContaining('3100.00'), findsOneWidget);
          expect(find.textContaining('{'), findsNothing);
          expect(find.textContaining('driving_license'), findsNothing);
        });
      });

      group('Contact support', () {
        const company = {'supportPhone': '0112345678', 'supportWhatsapp': '966550001111', 'supportEmail': 'help@jr.test', 'supportHoursAr': 'من ٩ ص إلى ٥ م', 'supportHoursEn': '9 am to 5 pm', 'legalNameEn': 'JR Logistics'};

        testWidgets('the sign-in page shows call, WhatsApp and e-mail, and the hours; each button opens the right thing', (t) async {
          final api = FakeApi()..catalogCompany = company;
          final links = FakeLinks();
          await pumpRoutedB(t, const LoginScreen(), api: api, links: links);
          await _settle(t);
          await t.ensureVisible(find.byKey(const Key('support-contact')));
          await t.pump();
          expect(find.text('Contact support'), findsOneWidget);
          expect(find.text('Support hours: 9 am to 5 pm'), findsOneWidget);
          await t.tap(find.byKey(const Key('contact-call')));
          await t.pump();
          expect(links.called, ['0112345678']);
          await t.tap(find.byKey(const Key('contact-whatsapp')));
          await t.pump();
          await t.tap(find.byKey(const Key('contact-email')));
          await t.pump();
          expect(links.opened.map((u) => u.toString()), ['https://wa.me/966550001111', 'mailto:help@jr.test']);
        });

        testWidgets('Profile shows the same card', (t) async {
          await pumpRoutedB(t, const ProfileScreen(), api: FakeApi()..catalogCompany = company);
          await _settle(t);
          await t.ensureVisible(find.byKey(const Key('support-contact')));
          await t.pump();
          expect(find.byKey(const Key('contact-call')), findsOneWidget);
        });

        testWidgets('only the channels that are filled in get a button', (t) async {
          await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogCompany = {'supportEmail': 'help@jr.test', 'supportPhone': '', 'supportWhatsapp': ' '});
          await _settle(t);
          await t.ensureVisible(find.byKey(const Key('support-contact')));
          await t.pump();
          expect(find.byKey(const Key('contact-email')), findsOneWidget);
          expect(find.byKey(const Key('contact-call')), findsNothing);
          expect(find.byKey(const Key('contact-whatsapp')), findsNothing);
          expect(find.byKey(const Key('support-hours')), findsNothing);
        });

        testWidgets('hidden while nothing is published (no company, empty channels, hours only) — on the sign-in page and in Profile', (t) async {
          for (final c in [null, <String, Object?>{}, {'supportPhone': '', 'supportWhatsapp': '', 'supportEmail': '', 'supportHoursEn': '9 to 5'}]) {
            await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogCompany = c);
            await _settle(t);
            expect(find.byKey(const Key('support-contact')), findsNothing, reason: '$c');
            await t.pumpWidget(const SizedBox());
            await pumpRoutedB(t, const ProfileScreen(), api: FakeApi()..catalogCompany = c);
            await _settle(t);
            expect(find.byKey(const Key('support-contact')), findsNothing, reason: '$c');
            await t.pumpWidget(const SizedBox());
          }
        });

        testWidgets('a catalog that fails to load hides the card; the sign-in page still works', (t) async {
          await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogError = Exception('down'));
          await _settle(t);
          expect(find.byKey(const Key('support-contact')), findsNothing);
          expect(find.byKey(const Key('submit')), findsOneWidget);
        });

        testWidgets('a link that cannot be opened shows the number to dial instead of failing silently', (t) async {
          final links = FakeLinks()..succeed = false;
          await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogCompany = company, links: links);
          await _settle(t);
          await t.ensureVisible(find.byKey(const Key('contact-call')));
          await t.pump();
          await t.tap(find.byKey(const Key('contact-call')));
          await _settle(t);
          expect(find.text('It could not be opened. Reach us at: 0112345678'), findsOneWidget);
        });

        for (final lang in ['ar', 'ur']) {
          testWidgets('$lang: the card, the hours of the language, right-to-left, and no overflow at 1.4x', (t) async {
            t.platformDispatcher.textScaleFactorTestValue = 1.4;
            addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
            await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogCompany = company, lang: lang, size: const Size(640, 1400));
            await _settle(t);
            await t.ensureVisible(find.byKey(const Key('support-contact')));
            await t.pump();
            expect(Directionality.of(t.element(find.byKey(const Key('support-contact')))), TextDirection.rtl);
            expect(find.text(lang == 'ar' ? 'تواصل مع الدعم' : 'سپورٹ سے رابطہ کریں'), findsOneWidget);
            expect(find.textContaining(lang == 'ar' ? 'من ٩ ص إلى ٥ م' : '9 am to 5 pm'), findsOneWidget, reason: 'Arabic hours for ar; the English hours for the others');
            expect(find.textContaining('{'), findsNothing);
            expect(t.takeException(), isNull);
          });
        }
      });
    });
  }
}
