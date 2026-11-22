import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/features/auth/change_password_screen.dart';
import 'package:jr_driver/features/auth/login_screen.dart';
import 'package:jr_driver/features/auth/register_screen.dart';
import 'package:jr_driver/features/cash/cash_screen.dart';
import 'package:jr_driver/features/home/today_screen.dart';
import 'package:jr_driver/features/jobs/chat_screen.dart';
import 'package:jr_driver/features/jobs/job_detail_screen.dart';
import 'package:jr_driver/features/jobs/jobs_screen.dart';
import 'package:jr_driver/features/jobs/offers_screen.dart';
import 'package:jr_driver/features/jobs/route_map_screen.dart';
import 'package:jr_driver/widgets/barcode_scanner.dart';
import 'package:jr_driver/widgets/common.dart';
import 'package:jr_driver/data/api_client.dart' show ApiException;
import 'package:jr_driver/features/profile/documents_screen.dart';
import 'package:jr_driver/features/profile/edit_profile_screen.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart';
import 'package:jr_driver/features/profile/profile_screen.dart';
import 'package:jr_driver/features/support/support_screen.dart';
import 'package:jr_driver/features/wallet/wallet_screen.dart';
import 'package:jr_driver/providers.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';
import '../helpers_extra.dart';
import '../widget/mj_shipments_test.dart' as m;

/// Visual QA: renders the key screens offscreen, in light and dark, in English and Arabic, as PNG files.
/// Skipped in a normal `flutter test`. Run:  JR_SHOTS=/some/dir flutter test test/visual/theme_screens_test.dart
/// Fonts (Cairo, Material icons) are loaded for real, so the pictures look like the app.
final _out = Platform.environment['JR_SHOTS'];

Future<void> _loadFonts() async {
  final cairo = FontLoader('Cairo');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
    cairo.addFont(Future.value(ByteData.sublistView(File('assets/fonts/Cairo-$w.ttf').readAsBytesSync())));
  }
  await cairo.load();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '${Platform.environment['HOME']}/flutter';
  final icons = File('$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) {
    final l = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())));
    await l.load();
  }
}

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Future<void> shot(WidgetTester t, String dir, String name) async {
  await settle(t);
  await t.runAsync(() async {
    RenderObject ro = t.element(find.byType(MaterialApp).first).renderObject!;
    while (!ro.isRepaintBoundary) { ro = ro.parent!; }
    final layer = ro.debugLayer! as OffsetLayer;
    final image = await layer.toImage(ro.paintBounds);
    final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!;
    Directory(dir).createSync(recursive: true);
    File('$dir/$name.png').writeAsBytesSync(bytes.buffer.asUint8List());
  });
}

void phone(WidgetTester t, [double h = 844]) { t.view.physicalSize = Size(780, h * 2); t.view.devicePixelRatio = 2; }

class _OfficeApi extends FakeApi {
  _OfficeApi() {
    overviewResult = Overview({'availability': 'available', 'verificationStatus': 'verified', 'newOffers': 0, 'activeJobs': 0, 'jobsCompleted': 3, 'rating': 4.5, 'officeLinked': true, 'wallet': null, 'walletManagedByOffice': true, 'officeName': 'Al Noor Courier Services'});
  }
  @override
  Future<Json> wallet({int page = 1}) async => {'managedByOffice': true, 'availableCents': null, 'reservedCents': null, 'heldCents': null, 'entries': [], 'total': 0, 'page': 1, 'pageSize': 25};
}

final _cash = CashSummary({
  'collectedCents': 987654, 'receivedCents': 500000, 'outstandingCents': 487654,
  'orders': [{'offerId': 'o1', 'ref': 'JR-000042', 'businessName': 'Nakheel Fresh Foods', 'parcels': 9, 'collectedCents': 987654, 'receivedCents': 500000, 'outstandingCents': 487654, 'lastCollectedAt': '2026-12-01T06:00:00.000Z'}],
  'recent': [{'id': 'h1', 'ref': 'JR-000042', 'amountCents': 500000, 'receivedByName': 'Sara', 'receivedByRole': 'business', 'note': 'Handed over at the gate', 'createdAt': '2026-12-01T06:00:00.000Z'}],
});

void main() {
  if (_out == null) { test('visual QA renders (set JR_SHOTS=<dir> to run)', () {}, skip: 'set JR_SHOTS=<dir>'); return; }

  setUpAll(_loadFonts);
  for (final mode in Brightness.values) {
    for (final lang in ['en', 'ar']) {
      testWidgets('${mode.name}-$lang', (t) async {
        useBrightness(mode);
        addTearDown(() => useBrightness(Brightness.dark));
        final dir = '$_out/${mode.name}-$lang';
        final failures = <String>[];
        Future<void> screen(String name, Future<void> Function() body) async {
          try { await body(); } catch (e, st) { failures.add('$name: $e\n$st'); }
          final ex = t.takeException(); if (ex != null) failures.add('$name (layout): $ex');
          await t.pumpWidget(const SizedBox());
        }
        Future<void> tapVisible(Key k) async {
          final f = find.byKey(k);
          if (f.evaluate().isEmpty) await t.scrollUntilVisible(f, 300, scrollable: find.byType(Scrollable).first);
          await Scrollable.ensureVisible(t.element(f), alignment: 0.5);
          await t.pump();
          await t.tap(f);
          await settle(t);
        }

        final offered = mkJob(status: 'offered', actions: ['accept', 'reject'], extra: {'earningHidden': false});
        final cashJob = mkManifestJob(
          stops: [
            mkLegStop(1, current: true, type: 'business', extra: {'arrivedAt': '2026-12-01T07:00:00.000Z', 'waitRemainingSec': null, 'needsSignature': true, 'codCents': 123456, 'canDefer': true, 'notes': 'Second floor, blue door, ask for the manager'}),
            for (var n = 2; n <= 4; n++) mkLegStop(n, extra: {'codCents': n == 3 ? 5000 : 0}),
            mkStop(7, status: 'delivered'), mkStop(8, status: 'failed', extra: {'failReason': 'refused'}),
          ],
          summary: {'total': 6, 'pending': 0, 'loaded': 4, 'delivered': 1, 'failed': 1, 'returned': 0, 'missing': 0},
          extra: {'route': mkRoute(provider: 'manual', extra: {'canReorder': true, 'manual': true}), 'policy': mkPolicy(), 'cod': mkCod(toCollect: 1234560, collected: 400000, parcels: 9), 'ops': mkOps(signature: true)},
        );
        final active = [
          mkJob(status: 'accepted', actions: ['checkin', 'cancel']),
          cashJob,
          mkJob(status: 'completed', actions: [], extra: {'finalUnits': 18}),
        ];

        await screen('01-login', () async { await pumpScreen(t, const LoginScreen(), api: FakeApi(), lang: lang); phone(t); await shot(t, dir, '01-login'); });
        await screen('02-register', () async {
          final api = FakeApi()..catalogCities = [{'key': 'riyadh', 'ar': 'الرياض', 'en': 'Riyadh', 'ur': 'ریاض'}]..catalogVehicles = ['sedan', 'van']..catalogServices = [{'key': 'delivery_driver'}, {'key': 'warehouse_loader'}];
          await pumpScreen(t, const RegisterScreen(), api: api, lang: lang, extra: [catalogProvider.overrideWith((ref) => api.catalog())]); phone(t, 1500);
          await shot(t, dir, '02-register');
        });
        await screen('03-today', () async {
          final api = FakeApi()..activeJobs = active..offerList = [offered]..overviewResult = Overview({'availability': 'available', 'verificationStatus': 'verified', 'newOffers': 1, 'activeJobs': 3, 'jobsCompleted': 120, 'rating': 4.5, 'officeLinked': false, 'wallet': {'availableCents': 123456, 'heldCents': 0, 'pendingCents': 4000}});
          await pumpScreen(t, const TodayScreen(), api: api, lang: lang, location: FakeLocation()); phone(t, 1000); await shot(t, dir, '03-today');
        });
        await screen('04-jobs-list', () async {
          final api = FakeApi()..activeJobs = active;
          await pumpScreen(t, const JobsScreen(), api: api, lang: lang); phone(t, 1500); await shot(t, dir, '04-jobs-list');
        });
        await screen('05-order-cards-stats', () async {
          Job mk(String status, {Json? summary, Json? extra}) => mkManifestJob(status: status, actions: [], stops: [], summary: summary ?? {'total': 0, 'pending': 0, 'loaded': 0, 'delivered': 0, 'failed': 0, 'returned': 0, 'missing': 0}, extra: {'expectedUnits': 120, 'stops': null, 'loadedUnits': null, ...?extra});
          final cards = [
            mk('offered'), mk('accepted', extra: {'cod': mkCod(toCollect: 1234500, collected: 0, parcels: 3)}),
            mk('attendance_confirmed', summary: {'total': 20, 'pending': 0, 'loaded': 9, 'delivered': 8, 'failed': 2, 'returned': 1, 'missing': 0}, extra: {'cod': mkCod(toCollect: 1234500, collected: 400000, parcels: 9)}),
            mk('completed', summary: {'total': 20, 'pending': 0, 'loaded': 0, 'delivered': 17, 'failed': 2, 'returned': 1, 'missing': 0}, extra: {'cod': {'toCollectCents': 0, 'collectedCents': 98765, 'handedOverCents': 98765, 'parcels': 9}}),
          ];
          await pumpScreen(t, Scaffold(body: ListView(padding: const EdgeInsets.all(16), children: [for (final c in cards) Padding(padding: const EdgeInsets.only(bottom: 12), child: JobCard(job: c, lang: lang))])), api: FakeApi(), lang: lang);
          phone(t, 1800); await shot(t, dir, '05-order-cards-stats');
        });
        await screen('06-offers', () async {
          final api = FakeApi()..offerList = [offered, mkManifestJob(status: 'offered', actions: ['accept', 'reject'], extra: {'allowPartial': false})];
          await pumpScreen(t, const OffersScreen(), api: api, lang: lang); phone(t, 1400); await shot(t, dir, '06-offers');
        });
        await screen('07-job-accepted', () async {
          await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = mkJob(status: 'accepted', actions: ['checkin', 'cancel'], extra: {'arrival': mkArrival(lat: 24.7028, lng: 46.7), 'ops': mkOps()}), lang: lang);
          phone(t, 1300); await shot(t, dir, '07-job-accepted');
        });
        await screen('08-run-sheet', () async {
          final job = m.drsJob([
            m.ship(1, current: true, extra: {'recipientName': 'Abdulrahman Al-Qahtani', 'address': 'Prince Sultan Road, Al Olaya, Building 4', 'codCents': 5000, 'paymentMode': 'cod', 'notes': 'Second floor, blue door', 'contents': 'Frozen food and dairy products'}),
            m.ship(2), m.ship(3, status: 'delivered'), m.ship(4, status: 'failed', extra: {'failReason': 'refused'}), m.ship(5, status: 'returned'), m.ship(6, extra: {'deferCount': 1}),
          ], extra: {'cod': {'toCollectCents': 123450, 'collectedCents': 40000, 'parcels': 9}});
          await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = job, lang: lang); phone(t, 1900); await shot(t, dir, '08-run-sheet');
          await tapVisible(const Key('drs-next'));
          phone(t, 900); await shot(t, dir, '09-shipment-sheet');
        });
        await screen('10-wallet', () async {
          await pumpScreen(t, const WalletScreen(), api: FakeApi(), lang: lang); phone(t, 1000); await shot(t, dir, '10-wallet');
        });
        await screen('11-wallet-office', () async {
          await pumpScreen(t, const WalletScreen(), api: _OfficeApi(), lang: lang, extra: extraOverrides(api: FakeExtraApi()..cashResult = _cash)); phone(t, 1000); await shot(t, dir, '11-wallet-office');
        });
        await screen('12-cash', () async {
          await pumpScreen(t, const CashScreen(), api: FakeApi(), lang: lang, extra: extraOverrides(api: FakeExtraApi()..cashResult = _cash)); phone(t, 1100); await shot(t, dir, '12-cash');
        });
        await screen('13-profile', () async {
          await pumpScreen(t, const ProfileScreen(), api: FakeApi(), lang: lang); phone(t, 1100); await shot(t, dir, '13-profile');
          await t.tap(find.byKey(const Key('profile-theme')));
          await settle(t);
          phone(t, 1100); await shot(t, dir, '14-theme-sheet');
        });
        await screen('15-stop-form', () async {
          await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = cashJob, lang: lang); phone(t, 1900); await shot(t, dir, '15-stop-working');
          await tapVisible(const Key('cant-deliver'));
          phone(t, 900); await shot(t, dir, '16-fail-sheet');
          await tapVisible(const Key('fail-damaged'));
          await shot(t, dir, '17-fail-sheet-selected');
          await t.tapAt(const Offset(5, 5)); await settle(t);
          await tapVisible(const Key('postpone'));
          await t.enterText(find.byKey(const Key('postpone-note')), 'The shop is closed until six in the evening');
          await t.pump();
          await shot(t, dir, '18-postpone-sheet');
        });
        await screen('19-change-password', () async {
          await pumpScreen(t, const ChangePasswordScreen(), api: FakeApi(), lang: lang); phone(t, 900); await shot(t, dir, '19-change-password');
        });
        await screen('20-misc', () async {
          await pumpScreen(t, const ChatScreen(offerId: 'o1'), api: FakeApi(), lang: lang); phone(t, 800); await shot(t, dir, '20-chat');
          await t.pumpWidget(const SizedBox());
          await pumpScreen(t, const SupportScreen(), api: FakeApi(), lang: lang, extra: extraOverrides(api: FakeExtraApi()..ticketList = [Ticket(mkTicketRow('t1', ref: 'TK-000007', status: 'open')), Ticket(mkTicketRow('t2', ref: 'TK-000008', status: 'resolved', subject: 'Cash does not match'))])); phone(t, 800); await shot(t, dir, '21-support');
          await t.pumpWidget(const SizedBox());
          await pumpScreen(t, const DocumentsScreen(), api: FakeApi(), lang: lang); phone(t, 800); await shot(t, dir, '22-documents');
          await t.pumpWidget(const SizedBox());
          await pumpScreen(t, const EditProfileScreen(), api: FakeApi(), lang: lang); phone(t, 1400); await shot(t, dir, '23-edit-profile');
          await t.pumpWidget(const SizedBox());
          await pumpScreen(t, const NotificationsScreen(), api: FakeApi(), lang: lang); phone(t, 800); await shot(t, dir, '24-notifications');
        });
        await screen('30-map', () async {
          final job = mkManifestJob(stops: [mkLegStop(1, current: true, extra: {'codCents': 5000, 'canDefer': true}), mkLegStop(2), mkLegStop(3, extra: {'status': 'delivered'}), mkStop(4)], extra: {'route': mkRoute(extra: {'canReorder': true})});
          final api = FakeApi()..jobResult = job;
          final ex = FakeExtraApi()..geometry = RouteGeometry.fromJson({'origin': {'lat': 24.70, 'lng': 46.60}, 'legs': [
            {'stopId': 's1', 'order': 1, 'from': {'lat': 24.70, 'lng': 46.60}, 'to': {'lat': 24.71, 'lng': 46.61}, 'distanceM': 20200, 'durationS': 1620},
            {'stopId': 's2', 'order': 2, 'from': {'lat': 24.71, 'lng': 46.61}, 'to': {'lat': 24.72, 'lng': 46.62}, 'distanceM': 5200, 'durationS': 720},
          ]});
          await pumpRoutedB(t, const RouteMapScreen(offerId: 'o1'), api: api, extraApi: ex, actions: FakeMapActions(), lang: lang, size: const Size(780, 1688));
          await settleB(t);
          await shot(t, dir, '30-map');
        });
        await screen('31-scan-error', () async {
          await pumpScreen(t, Scaffold(body: ScanErrorView(denied: true, onType: () {})), api: FakeApi(), lang: lang); phone(t, 700); await shot(t, dir, '31-scan-error');
        });
        await screen('32-signature', () async {
          await pumpScreen(t, const JobDetailScreen(offerId: 'o1'), api: FakeApi()..jobResult = cashJob, lang: lang); phone(t, 1900);
          final pad = find.byKey(const Key('signature-pad'));
          await t.scrollUntilVisible(pad, 300, scrollable: find.byType(Scrollable).first);
          await Scrollable.ensureVisible(t.element(pad), alignment: 0.5);
          await t.pump();
          final c = t.getCenter(pad);
          final g = await t.startGesture(c + const Offset(-80, 0));
          for (var i = 0; i < 12; i++) { await g.moveBy(Offset(14, i.isEven ? -18 : 18)); await t.pump(); }
          await g.up();
          await shot(t, dir, '32-signature');
        });
        await screen('33-gallery', () async {
          await pumpScreen(t, Scaffold(
            appBar: AppBar(title: const Text('Gallery')),
            body: ListView(padding: const EdgeInsets.all(16), children: [
              const Wrap(spacing: 8, runSpacing: 8, children: [Pill('Success', tone: Tone.success), Pill('Info', tone: Tone.info), Pill('Warn', tone: Tone.warn), Pill('Danger', tone: Tone.danger), Pill('Neutral')]),
              const SizedBox(height: 12),
              const Banner2(text: 'Success banner body text', tone: Tone.success, title: 'Success'),
              const SizedBox(height: 8),
              const Banner2(text: 'Info banner body text', title: 'Info', icon: Icons.info_outline),
              const SizedBox(height: 8),
              const Banner2(text: 'Warning banner body text', tone: Tone.warn, title: 'Warning'),
              const SizedBox(height: 8),
              const Banner2(text: 'Danger banner body text', tone: Tone.danger, title: 'Danger'),
              const SizedBox(height: 12),
              ClipRRect(borderRadius: BorderRadius.circular(12), child: Column(children: [StaleStrip(error: ApiException('NETWORK', 'x', status: 0), onRetry: () {}), ConnectionBanner(onRetry: () {})])),
              const SizedBox(height: 12),
              SectionCard(border: JR.cyan, child: Text('Section card, cyan border', style: TextStyle(color: JR.muted))),
              const SizedBox(height: 12),
              Row(children: [Expanded(child: FilledButton(onPressed: () {}, child: const Text('Filled'))), const SizedBox(width: 8), Expanded(child: OutlinedButton(onPressed: () {}, child: const Text('Outlined'))), const SizedBox(width: 8), TextButton(onPressed: () {}, child: const Text('Text'))]),
              const SizedBox(height: 12),
              Row(children: [Expanded(child: FilledButton(style: FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: () {}, child: const Text('Danger action'))), const SizedBox(width: 8), const Expanded(child: FilledButton(onPressed: null, child: Text('Disabled')))]),
              const SizedBox(height: 12),
              TextField(decoration: InputDecoration(labelText: 'Label', hintText: 'Hint', errorText: 'Error text')),
              const SizedBox(height: 12),
              const SizedBox(height: 260, child: EmptyView(title: 'Nothing here', hint: 'A hint line under the title')),
              const SizedBox(height: 12),
              SizedBox(height: 260, child: ErrorView(error: ApiException('NETWORK', 'x', status: 0), onRetry: () {})),
              const SizedBox(height: 12),
              Align(alignment: AlignmentDirectional.centerStart, child: FilterChip(label: const Text('Selected chip'), selected: true, onSelected: (_) {})),
              Align(alignment: AlignmentDirectional.centerStart, child: FilterChip(label: const Text('Plain chip'), selected: false, onSelected: (_) {})),
              const CheckboxListTile(value: true, onChanged: null, title: Text('Checked, disabled')),
              CheckboxListTile(value: true, onChanged: (_) {}, activeColor: JR.accent, checkColor: JR.accentInk, title: const Text('Checked')),
              const LinearProgressIndicator(value: 0.5),
              const SizedBox(height: 12),
              const Center(child: CircularProgressIndicator()),
            ]),
          ), api: FakeApi(), lang: lang);
          phone(t, 2600); await shot(t, dir, '33-gallery');
        });
        await screen('34-dialog-toast', () async {
          await pumpScreen(t, Builder(builder: (c) => Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
            FilledButton(key: const Key('open-dialog'), onPressed: () => showDialog<bool>(context: c, builder: (d) => AlertDialog(title: const Text('Decline this offer?'), content: const Text('You will not see it again.'), actions: [TextButton(onPressed: () {}, child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(110, 48), backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: () {}, child: const Text('Decline'))])), child: const Text('Open')),
          ])))), api: FakeApi(), lang: lang);
          phone(t, 700);
          await t.tap(find.byKey(const Key('open-dialog')));
          await settle(t);
          await shot(t, dir, '34-dialog');
          await t.tapAt(const Offset(5, 5)); await settle(t);
          toast(t.element(find.byType(Scaffold).first), 'Saved successfully');
          await settle(t);
          await shot(t, dir, '35-toast-ok');
          toast(t.element(find.byType(Scaffold).first), 'Something went wrong, please try again', error: true);
          await settle(t);
          await shot(t, dir, '36-toast-error');
          await t.pump(const Duration(seconds: 7));
        });
        expect(failures, isEmpty);
      });
    }
  }
}
