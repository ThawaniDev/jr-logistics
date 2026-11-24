import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/version_gate.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/features/cash/cash_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/legal/legal_reader.dart';
import 'package:jr_driver/features/privacy/privacy_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/update/update_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../helpers_lm.dart';

/// Update L / M — every new screen and card, in every language, at the largest text size the app allows (1.4x) on a 320 dp wide phone, in light and dark,
/// scrolled top to bottom. Any RenderFlex overflow or other layout exception fails the test.
const _small = Size(640, 1200);

Future<void> _settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<void> _scrollAll(WidgetTester t, String what) async {
  expect(t.takeException(), isNull, reason: '$what (first frame)');
  final list = find.byType(Scrollable);
  if (list.evaluate().isEmpty) return;
  // the biggest scroll view is the page
  var best = list.first;
  var bestExtent = -1.0;
  for (var i = 0; i < list.evaluate().length; i++) {
    final s = list.at(i);
    final extent = t.state<ScrollableState>(s).position.maxScrollExtent;
    if (extent > bestExtent) { bestExtent = extent; best = s; }
  }
  if (bestExtent <= 0) return;
  for (var i = 0; i < 14; i++) { await t.drag(best, const Offset(0, -420)); await t.pump(); expect(t.takeException(), isNull, reason: '$what after scroll $i'); }
}

Json _overview(Json cash, {int available = 12500}) => {...FakeApi().overviewResult.j, 'cash': cash, 'wallet': {'availableCents': available, 'heldCents': 0, 'pendingCents': 0}};

const _longName = 'Prince Mohammed bin Abdulaziz Street, Al Olaya District';

void main() {
  for (final mode in Brightness.values) {
    for (final lang in ['en', 'ar', 'ur']) {
      group('${mode.name} · $lang @ 1.4x text, 320 dp', () {
        setUp(() { useBrightness(mode); });
        tearDown(() => useBrightness(Brightness.dark));

        Future<void> big(WidgetTester t) async {
          t.platformDispatcher.textScaleFactorTestValue = 1.4;
          addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        }

        testWidgets('update page, re-acceptance page, legal reader', (t) async {
          await big(t);
          await pumpRoutedB(t, const UpdateRequiredScreen(info: UpgradeInfo(minVersion: '12.34.567+890', currentVersion: '1.0.0+1', platform: 'ios', storeUrl: 'https://apps.apple.com/app/jr-driver')), api: FakeApi(), lang: lang, size: _small);
          await _scrollAll(t, 'update');
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const UpdateRequiredScreen(info: UpgradeInfo()), api: FakeApi(), lang: lang, size: _small);
          await _scrollAll(t, 'update without a link');
          await t.pumpWidget(const SizedBox());
          final legal = FakeLegalApi()..builtin = true;
          legal.bodies['driver'] = List.generate(12, (i) => '## ${i + 1}. Section $_longName\n\nA paragraph with **bold words**, a [link](https://example.com/some/very/long/address/that/does/not/fit/on/one/line) and enough text to wrap over several lines at a large font size.\n\n- first point of the list that is long enough to wrap onto a second line\n- second point\n\n1. numbered one\n2. numbered two').join('\n\n');
          await pumpRoutedB(t, const LegalReaderScreen(slug: 'driver'), api: FakeApi(), legal: legal, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'legal reader');
          await t.pumpWidget(const SizedBox());
          final api = MeApi(pending: [pendingTerms(note: 'Cash must be handed over within 3 days and the recipient\'s code is now checked at the door'), pendingPrivacy()]);
          await pumpFullApp(t, api: api, lang: lang, size: _small);
          expect(find.byKey(const Key('legal-gate')), findsOneWidget);
          await _scrollAll(t, 'gate');
        });

        testWidgets('registration with the two texts, the privacy page with blockers, the sign-in page with the contact card', (t) async {
          await big(t);
          final capi = FakeApi()..catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}]..catalogVehicles = ['sedan']..catalogServices = [{'key': 'delivery_driver'}];
          await pumpRoutedB(t, const RegisterScreen(), api: capi, lang: lang, size: _small, overrides: [catalogProvider.overrideWith((ref) => capi.catalog())]);
          await _settle(t);
          await _scrollAll(t, 'register');
          await t.pumpWidget(const SizedBox());
          final repo = FakePrivacyRepo()..statusJson = {
            'role': 'driver', 'export': {'available': true, 'lastAt': '2026-11-20T08:00:00.000Z'},
            'deletion': {'supported': true, 'eligible': false, 'canRequest': false, 'blockers': [{'code': 'wallet_funds', 'amountCents': 12500}, {'code': 'open_jobs', 'count': 2}, {'code': 'outstanding_cash', 'count': 3, 'amountCents': 1234500}, {'code': 'pending_withdrawals', 'count': 1}], 'request': null},
            'retention': {'notificationDays': 90, 'recipientPiiMonths': 24, 'closedAccountYears': 5}, 'contact': {'privacyEmail': 'privacy-office@jr-logistics.example', 'phone': null},
          };
          await pumpRoutedB(t, const PrivacyScreen(), api: FakeApi(), privacy: repo, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'privacy');
          await t.pumpWidget(const SizedBox());
          final company = {'supportPhone': '0112345678', 'supportWhatsapp': '966550001111', 'supportEmail': 'support-team@jr-logistics.example', 'supportHoursAr': 'من الأحد إلى الخميس، من ٨ صباحاً حتى ٦ مساءً', 'supportHoursEn': 'Sunday to Thursday, 8 am to 6 pm'};
          await pumpRoutedB(t, const LoginScreen(), api: FakeApi()..catalogCompany = company, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'login');
        });

        testWidgets('Today and Cash with a cash banner (overdue, paused, wallet held back)', (t) async {
          await big(t);
          final cash = mkCashRisk(state: 'overdue', blocks: true, reason: 'overdue', outstanding: 1234500, limit: 3000000, overdue: 900000, lien: 500000, days: 14, maxDays: 3, pct: 41);
          final api = FakeApi()..overviewResult = Overview(_overview(cash, available: 123456789));
          final summary = CashSummary({'collectedCents': 1234500, 'receivedCents': 0, 'outstandingCents': 1234500, 'orders': [for (var i = 1; i <= 3; i++) {'offerId': 'o$i', 'ref': 'JR-00004$i', 'businessName': _longName, 'parcels': 12, 'collectedCents': 400000, 'receivedCents': 0, 'outstandingCents': 400000, 'lastCollectedAt': '2026-11-10T06:00:00Z', 'ageDays': 12}], 'recent': []});
          await pumpRoutedB(t, const TodayScreen(), api: api, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'today');
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const CashScreen(), api: api, extraApi: FakeExtraApi()..cashResult = summary, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'cash');
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const WalletScreen(), api: api, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'wallet');
          await t.pumpWidget(const SizedBox());
          await pumpRoutedB(t, const OffersScreen(), api: api, extraApi: FakeExtraApi()..offers = OffersInfo(cashBlocked: true, cash: CashRisk(cash)), lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'offers paused');
        });

        testWidgets('Profile (blocked invitation, contact, privacy card), notifications of the new types, the deliver form while SMS is off', (t) async {
          await big(t);
          final api = FakeApi()..invitesResult = {'items': [{'id': 'i1', 'officeName': 'Najd Express Courier Services Company'}], 'walletBlock': {'availableCents': 12345600, 'heldCents': 500, 'pendingWithdrawals': 2, 'blocks': true}}
            ..catalogCompany = {'supportPhone': '0112345678', 'supportWhatsapp': '966550001111', 'supportEmail': 'support-team@jr-logistics.example', 'supportHoursAr': 'من الأحد إلى الخميس', 'supportHoursEn': 'Sunday to Thursday'};
          await pumpRoutedB(t, const ProfileScreen(), api: api, lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'profile');
          await t.pumpWidget(const SizedBox());
          final items = [
            mkNotification('a', 'cash_overdue', data: {'amount': '12345.00', 'limit': '30000.00', 'pct': 41, 'days': 14, 'maxDays': 3}), mkNotification('b', 'document_expiring', data: {'docType': 'vehicle_registration', 'days': 7, 'expiresOn': '2026-11-29'}),
            mkNotification('c', 'balance_moved_to_office', data: {'amountCents': 123456, 'office': 'Najd Express Courier Services Company'}), mkNotification('d', 'broadcast', data: {'message': 'The main warehouse in $_longName is closed on Friday because of the national day holiday', 'link': '/driver/jobs'}),
            mkNotification('e', 'parcels_added', data: {'offerId': 'o1', 'ref': 'JR-000042', 'count': 3}), mkNotification('f', 'privacy_request_rejected', data: {'reason': 'You still hold cash that must be handed over to the warehouse first'}),
          ];
          await pumpRoutedB(t, const NotificationsScreen(), api: FakeApi()..notificationPages = [{'items': items, 'unread': 6, 'total': 6}], extraApi: FakeExtraApi(), lang: lang, size: _small);
          await _settle(t);
          await _scrollAll(t, 'notifications');
          await t.pumpWidget(const SizedBox());
          final job = mkManifestJob(stops: [mkStop(1, current: true, extra: {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null, 'needsOtp': false, 'proofMode': 'scan', 'canResend': false, 'otpOffReason': 'sms_off', 'codCents': 12345600, 'needsSignature': true}), mkStop(2)]);
          await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = job, lang: lang);
          t.view.physicalSize = _small;
          await _settle(t);
          await _scrollAll(t, 'deliver form');
        });
      });
    }
  }
}
