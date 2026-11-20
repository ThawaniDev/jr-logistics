import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart' show Json;
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/features/jobs/jobs_screen.dart';
import 'package:jr_driver/widgets/job_card.dart';
import '../helpers.dart';

// Platform update J, worker MJ (J5) — every order card shows the stat cards: shipments · to deliver · delivered · not delivered, cash to collect / collected,
// and for a finished job its final result. Offers show the expected parcels with nothing delivered yet.

Future<void> settle(WidgetTester t) async { await t.pump(); await t.pump(const Duration(milliseconds: 300)); await t.pump(const Duration(milliseconds: 300)); }

Json sum(int total, {int pending = 0, int loaded = 0, int delivered = 0, int failed = 0, int returned = 0, int missing = 0}) => {'total': total, 'pending': pending, 'loaded': loaded, 'delivered': delivered, 'failed': failed, 'returned': returned, 'missing': missing};

Job card(String status, {Json? summary, Json? extra, int expected = 6}) => mkManifestJob(status: status, actions: status == 'offered' ? ['accept'] : [], stops: [], summary: summary ?? sum(0), extra: {'expectedUnits': expected, 'stops': null, 'loadedUnits': null, ...?extra});

Future<void> show(WidgetTester t, Job j, {String lang = 'en'}) async {
  await pumpScreen(t, Scaffold(body: SingleChildScrollView(child: JobCard(job: j, lang: lang))), api: FakeApi(), lang: lang);
}

String val(WidgetTester t, String k) => t.widget<Text>(find.byKey(Key('card-stat-$k-value'))).data!;
List<String> four(WidgetTester t) => [val(t, 'total'), val(t, 'to-deliver'), val(t, 'delivered'), val(t, 'not-delivered')];

void main() {
  group('the stat cards in an order card, state by state', () {
    testWidgets('offer: the expected parcels, nothing delivered; no cash tiles without cash parcels', (t) async {
      await show(t, card('offered', expected: 25));
      expect(find.byKey(const Key('job-card-stats')), findsOneWidget);
      expect(four(t), ['25', '25', '0', '0']);
      expect(find.byKey(const Key('card-stat-cash')), findsNothing);
      expect(find.byKey(const Key('card-stat-collected')), findsNothing);
      expect(find.text('Shipments'), findsOneWidget);
      expect(find.text('To deliver'), findsOneWidget);
      expect(find.text('Delivered'), findsOneWidget);
      expect(find.text('Not delivered'), findsOneWidget);
    });

    testWidgets('accepted / arrived / waiting for the hand-over: still the plan, with the cash to collect when the job has COD', (t) async {
      await show(t, card('accepted', extra: {'cod': mkCod(toCollect: 250000, collected: 0, parcels: 4)}));
      expect(four(t), ['6', '6', '0', '0']);
      expect(val(t, 'cash'), 'SAR 2,500.00');
      expect(val(t, 'collected'), 'SAR 0.00');
      await t.pumpWidget(const SizedBox());
      await show(t, card('attendance_confirmed', summary: sum(5, pending: 5)));
      expect(four(t), ['5', '5', '0', '0']);
    });

    testWidgets('under way: from the stops summary, cash to collect and collected', (t) async {
      await show(t, card('attendance_confirmed', summary: sum(10, loaded: 4, delivered: 3, failed: 1, returned: 1, missing: 1), extra: {'cod': mkCod(toCollect: 120000, collected: 40000, parcels: 5)}));
      expect(four(t), ['10', '4', '3', '3']);
      expect(val(t, 'cash'), 'SAR 1,200.00');
      expect(val(t, 'collected'), 'SAR 400.00');
      expect(find.byKey(const Key('card-stat-handed')), findsNothing);
    });

    testWidgets('finished (history): the final result — delivered / not delivered, cash collected and handed over; nothing left to collect', (t) async {
      await show(t, card('completed', summary: sum(10, delivered: 8, failed: 1, returned: 1), extra: {'cod': {'toCollectCents': 0, 'collectedCents': 80000, 'handedOverCents': 80000, 'parcels': 6}}));
      expect(four(t), ['10', '0', '8', '2']);
      expect(find.byKey(const Key('card-stat-cash')), findsNothing, reason: 'nothing left to collect on a finished job');
      expect(val(t, 'collected'), 'SAR 800.00');
      expect(val(t, 'handed'), 'SAR 800.00');
    });

    testWidgets('finished with cash still open: the amount left is shown too', (t) async {
      await show(t, card('completed', summary: sum(4, delivered: 3, failed: 1), extra: {'cod': mkCod(toCollect: 5000, collected: 30000, parcels: 3)}));
      expect(val(t, 'cash'), 'SAR 50.00');
      expect(val(t, 'collected'), 'SAR 300.00');
    });

    testWidgets('a count-based delivery job (no per-parcel list): loaded / delivered / final units', (t) async {
      await show(t, mkJob(status: 'accepted'));
      expect(four(t), ['20', '20', '0', '0']);
      await t.pumpWidget(const SizedBox());
      await show(t, mkJob(status: 'completed', actions: [], extra: {'loadedUnits': 18, 'finalUnits': 15}));
      expect(four(t), ['18', '0', '15', '3']);
    });

    testWidgets('no stat cards for a vehicle-days job, a declined offer or a job cancelled before any parcel was handled', (t) async {
      await show(t, mkJob(service: 'car_with_driver', status: 'accepted'));
      expect(find.byKey(const Key('job-card-stats')), findsNothing);
      for (final st in ['rejected', 'expired', 'cancelled', 'no_show']) {
        await t.pumpWidget(const SizedBox());
        await show(t, card(st));
        expect(find.byKey(const Key('job-card-stats')), findsNothing, reason: st);
      }
      await t.pumpWidget(const SizedBox());
      await show(t, card('cancelled', summary: sum(4, loaded: 1, delivered: 2, failed: 1)));
      expect(four(t), ['4', '1', '2', '1'], reason: 'a job ended early keeps what was done');
    });

    for (final (lang, labels) in const [('ar', ['الشحنات', 'للتسليم', 'تم تسليمها', 'لم تُسلَّم']), ('ur', ['کل پارسل', 'ڈیلیور کرنے ہیں', 'ڈیلیور ہو گئے', 'ڈیلیور نہیں ہوئے'])]) {
      testWidgets('$lang labels and Latin digits', (t) async {
        await show(t, card('attendance_confirmed', summary: sum(12, loaded: 7, delivered: 4, failed: 1)), lang: lang);
        for (final l in labels) { expect(find.text(l), findsOneWidget, reason: l); }
        expect(four(t), ['12', '7', '4', '1']);
      });
    }

    testWidgets('an office driver\'s card: stat cards stay, earnings do not ("paid via your office")', (t) async {
      await show(t, card('accepted', extra: {'earningHidden': true, 'expectedEarningCents': null}));
      expect(find.byKey(const Key('job-card-stats')), findsOneWidget);
      expect(find.text('Paid via your office'), findsOneWidget);
      expect(find.text('Expected earning'), findsNothing);
    });
  });

  group('the My jobs page', () {
    testWidgets('every card of the active tab and of the history tab carries its stat cards', (t) async {
      final api = _JobsApi()
        ..activeJobs = [
          card('accepted'), // same offerId on purpose: the keys below are per card, so use distinct refs
          card('attendance_confirmed', summary: sum(8, loaded: 5, delivered: 3), extra: {'offerId': 'o2', 'ref': 'JR-000043'}),
        ]
        ..history = [card('completed', summary: sum(10, delivered: 9, failed: 1), extra: {'offerId': 'o3', 'ref': 'JR-000044', 'cod': {'toCollectCents': 0, 'collectedCents': 90000, 'handedOverCents': 90000, 'parcels': 7}})];
      await pumpScreen(t, const JobsScreen(), api: api);
      await settle(t);
      expect(find.byKey(const Key('job-card-stats')), findsNWidgets(2));
      expect(find.byKey(const Key('card-stat-total')), findsNWidgets(2));
      await t.tap(find.text('History'));
      await settle(t);
      expect(find.byKey(const Key('job-card-stats')), findsOneWidget);
      expect(four(t), ['10', '0', '9', '1']);
      expect(val(t, 'handed'), 'SAR 900.00');
    });
  });
}

class _JobsApi extends FakeApi {
  List<Job> history = [];
  @override
  Future<List<Job>> jobs({required bool active}) async => active ? activeJobs : history;
}
