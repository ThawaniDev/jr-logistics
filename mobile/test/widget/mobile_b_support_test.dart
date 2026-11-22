import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/features/support/new_ticket_screen.dart';
import 'package:jr_driver/features/support/support_screen.dart';
import 'package:jr_driver/features/support/ticket_screen.dart';
import '../helpers.dart';
import '../helpers_extra.dart';

class _CatalogApi extends FakeApi {
  @override
  Future<Json> catalog() async => {...await super.catalog(), 'ticketCategories': {'business': ['other'], 'driver': ['cod_issue', 'app_problem'], 'office': ['other']}};
}

List<RouteBase> _supportRoutes() => [
      GoRoute(path: '/support/new', builder: (_, _) => const Scaffold(body: Text('PAGE:/support/new'))),
      GoRoute(path: '/support/:id', builder: (_, s) => Scaffold(body: Text('PAGE:/support/${s.pathParameters['id']}'))),
    ];

String _daysAgo(int d) => DateTime.now().toUtc().subtract(Duration(days: d)).toIso8601String();

void main() {
  group('Support — ticket list', () {
    final rows = [
      mkTicketRow('t1', ref: 'TK-000007', status: 'open', category: 'cod_issue', subject: 'Cash does not match'),
      mkTicketRow('t2', ref: 'TK-000006', status: 'in_review', priority: 'urgent', category: 'business_not_ready', subject: 'Warehouse closed when I arrived'),
      mkTicketRow('t3', ref: 'TK-000005', status: 'resolved', category: 'payment_issue', subject: 'Payment is late'),
    ];

    testWidgets('status badges (open / in review / resolved), the urgent flag, category and subject for each ticket', (t) async {
      final ex = FakeExtraApi()..ticketList = [for (final r in rows) Ticket(r)];
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: ex, routes: _supportRoutes());
      await settleB(t);
      Finder badge(String id, String text) => find.descendant(of: find.byKey(Key('ticket-status-$id')), matching: find.text(text));
      expect(badge('t1', 'Open'), findsOneWidget);
      expect(badge('t2', 'In review'), findsOneWidget);
      expect(badge('t3', 'Resolved'), findsOneWidget);
      expect(find.byKey(const Key('ticket-urgent-t2')), findsOneWidget);
      expect(find.byKey(const Key('ticket-urgent-t1')), findsNothing);
      expect(find.text('Cash does not match'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('ticket-t1')), matching: find.text('Cash on delivery problem')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('ticket-t2')), matching: find.text('TK-000006')), findsOneWidget);
    });

    testWidgets('a dot marks tickets with news (unread reply / resolution notifications), not the others', (t) async {
      final ex = FakeExtraApi()
        ..ticketList = [for (final r in rows) Ticket(r)]
        ..unread = [AppNotification(mkNotification('n1', 'ticket_reply', data: {'ref': 'TK-000006'})), AppNotification(mkNotification('n2', 'offer_new', data: {'ref': 'TK-000007'}))];
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: ex, routes: _supportRoutes());
      await settleB(t);
      expect(find.byKey(const Key('ticket-unread-t2')), findsOneWidget);
      expect(find.byKey(const Key('ticket-unread-t1')), findsNothing, reason: 'an offer notification is not ticket news');
      expect(find.byKey(const Key('ticket-unread-t3')), findsNothing);
    });

    testWidgets('empty state invites to open a ticket; the new-ticket button is always there', (t) async {
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: FakeExtraApi(), routes: _supportRoutes());
      await settleB(t);
      expect(find.byKey(const Key('tickets-empty')), findsOneWidget);
      expect(find.text('No tickets yet'), findsOneWidget);
      await t.tap(find.byKey(const Key('new-ticket')));
      await settleB(t);
      expect(find.text('PAGE:/support/new'), findsOneWidget);
    });

    testWidgets('tapping a ticket opens it', (t) async {
      final ex = FakeExtraApi()..ticketList = [for (final r in rows) Ticket(r)];
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: ex, routes: _supportRoutes());
      await settleB(t);
      await t.tap(find.byKey(const Key('ticket-t2')));
      await settleB(t);
      expect(find.text('PAGE:/support/t2'), findsOneWidget);
    });

    testWidgets('pull to refresh reloads; a failure shows the localized error with Retry', (t) async {
      final ex = FakeExtraApi()..ticketList = [for (final r in rows) Ticket(r)];
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: ex, routes: _supportRoutes());
      await settleB(t);
      final before = ex.calls.where((c) => c == 'tickets').length;
      await t.fling(find.byType(ListView).first, const Offset(0, 400), 1500);
      await settleB(t);
      await t.pump(const Duration(seconds: 1));
      expect(ex.calls.where((c) => c == 'tickets').length, before + 1);
      await t.pumpWidget(const SizedBox());
      final bad = FakeExtraApi()..errorOnNext = ApiException('NETWORK', 'x');
      await pumpRoutedB(t, const SupportScreen(), api: FakeApi(), extraApi: bad, routes: _supportRoutes());
      await settleB(t);
      expect(find.text('No internet connection. Check your signal and try again.'), findsOneWidget);
      await t.tap(find.byKey(const Key('retry')));
      await settleB(t);
      expect(find.byKey(const Key('tickets-empty')), findsOneWidget);
    });
  });

  group('Support — new ticket', () {
    Future<({FakeExtraApi ex, FakeAttachmentPicker picker})> open(WidgetTester t, {FakeApi? api, FakeExtraApi? extraApi, String lang = 'en', Size size = const Size(900, 2200)}) async {
      final ex = extraApi ?? FakeExtraApi();
      final picker = FakeAttachmentPicker();
      await pumpRoutedB(t, const NewTicketScreen(), api: api ?? FakeApi(), extraApi: ex, picker: picker, routes: _supportRoutes(), lang: lang, size: size);
      await settleB(t);
      return (ex: ex, picker: picker);
    }

    Future<void> pickCategory(WidgetTester t, String label) async {
      await t.tap(find.byKey(const Key('ticket-category')));
      await settleB(t);
      await t.tap(find.text(label).last);
      await settleB(t);
    }

    Future<void> fill(WidgetTester t, {String category = 'App problem', String subject = 'Scanner will not open', String body = 'The camera stays black on the delivery screen.'}) async {
      await pickCategory(t, category);
      await t.enterText(find.byKey(const Key('ticket-subject')), subject);
      await t.enterText(find.byKey(const Key('ticket-body')), body);
      await t.pump();
    }

    Future<void> addPhoto(WidgetTester t, {bool camera = true}) async {
      await t.ensureVisible(find.byKey(const Key('att-add')));
      await t.tap(find.byKey(const Key('att-add')));
      await settleB(t);
      await t.tap(find.byKey(Key(camera ? 'att-source-camera' : 'att-source-gallery')));
      await settleB(t);
    }

    bool submitEnabled(WidgetTester t) => t.widget<FilledButton>(find.byKey(const Key('ticket-submit'))).onPressed != null;

    testWidgets('categories come from the catalog (ticketCategories.driver), labelled with ticket_cat.*', (t) async {
      await open(t, api: _CatalogApi());
      await t.tap(find.byKey(const Key('ticket-category')));
      await settleB(t);
      expect(find.text('Cash on delivery problem'), findsOneWidget);
      expect(find.text('App problem'), findsOneWidget);
      expect(find.text('Payment issue'), findsNothing, reason: 'not in the catalog list');
    });

    testWidgets('without a catalog the built-in driver categories still allow asking for help', (t) async {
      await open(t);
      await t.tap(find.byKey(const Key('ticket-category')));
      await settleB(t);
      expect(find.text('App problem'), findsOneWidget);
      expect(find.text('Payment issue'), findsOneWidget);
    });

    testWidgets('Submit stays disabled until category, a subject (3+ chars) and a message are filled', (t) async {
      await open(t);
      expect(submitEnabled(t), isFalse);
      await pickCategory(t, 'App problem');
      await t.enterText(find.byKey(const Key('ticket-subject')), 'ab');
      await t.enterText(find.byKey(const Key('ticket-body')), 'text');
      await t.pump();
      expect(submitEnabled(t), isFalse, reason: 'subject too short');
      await t.enterText(find.byKey(const Key('ticket-subject')), 'abc');
      await t.enterText(find.byKey(const Key('ticket-body')), '   ');
      await t.pump();
      expect(submitEnabled(t), isFalse, reason: 'blank message');
      await t.enterText(find.byKey(const Key('ticket-body')), 'text');
      await t.pump();
      expect(submitEnabled(t), isTrue);
    });

    testWidgets('sends category, subject and message, then opens the new ticket', (t) async {
      final r = await open(t);
      await fill(t);
      await t.ensureVisible(find.byKey(const Key('ticket-submit')));
      await t.tap(find.byKey(const Key('ticket-submit')));
      await settleB(t);
      expect(r.ex.calls.where((c) => c.startsWith('create:')).single, 'create:app_problem|Scanner will not open|The camera stays black on the delivery screen.||');
      expect(find.text('PAGE:/support/tk-new'), findsOneWidget);
    });

    testWidgets('up to 3 photos: each is uploaded at once, shown as a thumbnail, removable; the 4th is refused; their ids go with the ticket', (t) async {
      final r = await open(t);
      await fill(t);
      await addPhoto(t); await addPhoto(t, camera: false); await addPhoto(t);
      expect(r.picker.picked.map((s) => s.name), ['camera', 'gallery', 'camera']);
      expect(r.ex.calls.where((c) => c.startsWith('upload:')).length, 3);
      expect(find.byKey(const Key('att-draft-ticket-1.jpg')), findsOneWidget);
      expect(find.byKey(const Key('att-draft-ticket-3.jpg')), findsOneWidget);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('att-add'))).onPressed, isNull, reason: 'limit of 3 reached');
      // remove the 2nd; a new one can be added again
      await t.tap(find.byKey(const Key('att-remove-ticket-2.jpg')));
      await t.pump();
      expect(find.byKey(const Key('att-draft-ticket-2.jpg')), findsNothing);
      expect(t.widget<OutlinedButton>(find.byKey(const Key('att-add'))).onPressed, isNotNull);
      await t.ensureVisible(find.byKey(const Key('ticket-submit')));
      await t.tap(find.byKey(const Key('ticket-submit')));
      await settleB(t);
      expect(r.ex.calls.where((c) => c.startsWith('create:')).single, endsWith('|up-1,up-3'));
    });

    testWidgets('a photo that fails to upload blocks sending, says so, and can be retried', (t) async {
      final r = await open(t);
      await fill(t);
      r.ex.errorOnNext = ApiException('NETWORK', 'x');
      await addPhoto(t);
      expect(find.byKey(const Key('att-failed-note')), findsOneWidget);
      expect(submitEnabled(t), isFalse);
      await t.tap(find.byKey(const Key('att-retry-ticket-1.jpg')));
      await settleB(t);
      expect(find.byKey(const Key('att-failed-note')), findsNothing);
      expect(submitEnabled(t), isTrue);
      expect(r.ex.calls.where((c) => c.startsWith('upload:')).length, 2);
    });

    testWidgets('a photo that is still uploading blocks sending (so no photo is silently left out)', (t) async {
      final r = await open(t);
      await fill(t);
      r.ex.gate = Completer<void>();
      await addPhoto(t);
      expect(submitEnabled(t), isFalse);
      r.ex.gate!.complete();
      await settleB(t);
      expect(submitEnabled(t), isTrue);
    });

    testWidgets('a related job can be linked (the driver\'s own jobs); its offerId is sent', (t) async {
      final api = FakeApi()..activeJobs = [mkJob()];
      final r = await open(t, api: api);
      await fill(t);
      await t.ensureVisible(find.byKey(const Key('ticket-job')));
      await t.tap(find.byKey(const Key('ticket-job')));
      await settleB(t);
      await t.tap(find.text('JR-000042 · Nakheel Fresh Foods').last);
      await settleB(t);
      await t.ensureVisible(find.byKey(const Key('ticket-submit')));
      await t.tap(find.byKey(const Key('ticket-submit')));
      await settleB(t);
      expect(r.ex.calls.where((c) => c.startsWith('create:')).single, 'create:app_problem|Scanner will not open|The camera stays black on the delivery screen.|o1|');
    });

    testWidgets('a double tap sends one ticket', (t) async {
      final r = await open(t);
      await fill(t);
      r.ex.gate = Completer<void>();
      await t.ensureVisible(find.byKey(const Key('ticket-submit')));
      await t.tap(find.byKey(const Key('ticket-submit')));
      await t.pump();
      await t.tap(find.byKey(const Key('ticket-submit')), warnIfMissed: false);
      await t.pump();
      expect(submitEnabled(t), isFalse);
      r.ex.gate!.complete();
      await settleB(t);
      expect(r.ex.calls.where((c) => c.startsWith('create:')).length, 1);
    });

    testWidgets('a failure keeps the form (and what was typed) and shows the localized error', (t) async {
      final r = await open(t);
      await fill(t);
      r.ex.errorOnNext = ApiException('VALIDATION', 'bad', status: 422, details: {'field': 'category'});
      await t.ensureVisible(find.byKey(const Key('ticket-submit')));
      await t.tap(find.byKey(const Key('ticket-submit')));
      await settleB(t);
      expect(find.text('Some details are missing or invalid.'), findsOneWidget);
      expect(find.byType(NewTicketScreen), findsOneWidget);
      expect(find.text('Scanner will not open'), findsOneWidget);
      expect(submitEnabled(t), isTrue);
    });

    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang: the form lays out at 320 dp / 1.4x text', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        await open(t, lang: lang, size: const Size(640, 1400), api: FakeApi()..activeJobs = [mkJob()]);
        await fill(t, category: strings(lang)('ticket_cat.app_problem'));
        expect(t.takeException(), isNull);
      });
    }
  });

  group('Support — ticket thread', () {
    Future<FakeExtraApi> open(WidgetTester t, TicketThread th, {String lang = 'en', FakeExtraApi? extraApi, FakeAttachmentPicker? picker, Size size = const Size(900, 1900)}) async {
      final ex = extraApi ?? FakeExtraApi();
      ex.threads[th.ticket.id] = th;
      await pumpRoutedB(t, TicketScreen(ticketId: th.ticket.id), api: FakeApi(), extraApi: ex, picker: picker ?? FakeAttachmentPicker(), routes: _supportRoutes(), lang: lang, size: size);
      await settleB(t);
      return ex;
    }

    testWidgets('header (status, subject, category) and the conversation: role badges, text and attachments', (t) async {
      await open(t, mkThread());
      expect(find.descendant(of: find.byKey(const Key('ticket-status')), matching: find.text('Open')), findsOneWidget);
      expect(find.text('Cash does not match'), findsOneWidget);
      expect(find.textContaining('Cash on delivery problem'), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('role-r1')), matching: find.text('You')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('role-r2')), matching: find.text('Support')), findsOneWidget);
      expect(find.text('I collected 50 but the system says 60'), findsOneWidget);
      expect(find.text('Thanks, we are checking with the warehouse.'), findsOneWidget);
      // attachments: the photo is a thumbnail fetched with the auth header, the PDF a file chip
      expect(find.byKey(const Key('att-a1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('att-a1')), matching: find.byType(Image)), findsOneWidget);
      expect(find.byKey(const Key('att-file-a2')), findsOneWidget);
      expect(find.text('statement.pdf'), findsOneWidget);
    });

    testWidgets('the urgent flag shows in the header', (t) async {
      await open(t, mkThread(priority: 'urgent'));
      expect(find.byKey(const Key('ticket-urgent')), findsOneWidget);
    });

    testWidgets('tapping a photo opens it full screen', (t) async {
      await open(t, mkThread());
      await t.tap(find.byKey(const Key('att-a1')));
      await settleB(t);
      expect(find.byKey(const Key('att-viewer')), findsOneWidget);
      expect(find.byType(InteractiveViewer), findsOneWidget);
    });

    testWidgets('opening the ticket reads its notifications (the dot in the list goes away)', (t) async {
      final ex = FakeExtraApi()..unread = [
        AppNotification(mkNotification('n9', 'ticket_reply', data: {'ref': 'TK-000007'})),
        AppNotification(mkNotification('n8', 'ticket_resolved', data: {'ref': 'TK-000099'})),
        AppNotification(mkNotification('n7', 'offer_new', data: {'ref': 'TK-000007'})),
      ];
      await open(t, mkThread(), extraApi: ex);
      expect(ex.calls, contains('markRead:n9'));
      expect(ex.calls.where((c) => c.startsWith('markRead')).length, 1, reason: 'only this ticket\'s ticket_* notifications');
    });

    testWidgets('reply: needs text; sends text + attached photo ids; clears the box and reloads the thread', (t) async {
      final picker = FakeAttachmentPicker();
      final ex = await open(t, mkThread(), picker: picker);
      bool canSend() => t.widget<FilledButton>(find.byKey(const Key('reply-send'))).onPressed != null;
      expect(canSend(), isFalse);
      await t.enterText(find.byKey(const Key('reply-body')), 'Attached the receipt');
      await t.pump();
      expect(canSend(), isTrue);
      await t.tap(find.byKey(const Key('att-add')));
      await settleB(t);
      await t.tap(find.byKey(const Key('att-source-camera')));
      await settleB(t);
      expect(ex.calls, contains('upload:ticket-1.jpg'));
      final loads = ex.calls.where((c) => c == 'ticket:tk1').length;
      await t.tap(find.byKey(const Key('reply-send')));
      await settleB(t);
      expect(ex.calls, contains('reply:tk1|Attached the receipt|up-1'));
      expect(t.widget<TextField>(find.byKey(const Key('reply-body'))).controller!.text, isEmpty);
      expect(ex.calls.where((c) => c == 'ticket:tk1').length, greaterThan(loads), reason: 'thread reloaded');
      expect(canSend(), isFalse);
    });

    testWidgets('a double tap on Send sends once', (t) async {
      final ex = await open(t, mkThread());
      await t.enterText(find.byKey(const Key('reply-body')), 'Hello');
      await t.pump();
      ex.gate = Completer<void>();
      await t.tap(find.byKey(const Key('reply-send')));
      await t.pump();
      await t.tap(find.byKey(const Key('reply-send')), warnIfMissed: false);
      await t.pump();
      ex.gate!.complete();
      await settleB(t);
      expect(ex.calls.where((c) => c.startsWith('reply:')).length, 1);
    });

    testWidgets('a failed reply keeps the typed text and says why', (t) async {
      final ex = await open(t, mkThread());
      await t.enterText(find.byKey(const Key('reply-body')), 'Hello there');
      await t.pump();
      ex.errorOnNext = ApiException('NETWORK', 'x');
      await t.tap(find.byKey(const Key('reply-send')));
      await settleB(t);
      // a lost answer may mean the reply arrived: the text says so (and the thread was re-read) instead of inviting a blind retry that would post it twice
      expect(find.text("No connection. We couldn't confirm that it went through. Check your signal and look at the list before trying again."), findsOneWidget);
      expect(t.widget<TextField>(find.byKey(const Key('reply-body'))).controller!.text, 'Hello there');
    });

    testWidgets('"Mark as resolved" asks first, then resolves and reloads', (t) async {
      final ex = await open(t, mkThread());
      await t.tap(find.byKey(const Key('ticket-resolve')));
      await settleB(t);
      expect(find.text('Mark this ticket as resolved? You can reopen it for 14 days.'), findsOneWidget);
      await t.tap(find.text('Cancel'));
      await settleB(t);
      expect(ex.calls.where((c) => c.startsWith('resolve')), isEmpty);
      await t.tap(find.byKey(const Key('ticket-resolve')));
      await settleB(t);
      ex.threads['tk1'] = mkThread(status: 'resolved', resolvedAt: _daysAgo(0));
      await t.tap(find.byKey(const Key('resolve-confirm')));
      await settleB(t);
      expect(ex.calls, contains('resolve:tk1'));
      expect(find.byKey(const Key('ticket-reopen')), findsOneWidget, reason: 'now resolved: the page moved on');
    });

    testWidgets('resolved within 14 days: no reply box, a Reopen button (with an optional message)', (t) async {
      final ex = await open(t, mkThread(status: 'resolved', resolvedAt: _daysAgo(3)));
      expect(find.byKey(const Key('reply-body')), findsNothing);
      expect(find.byKey(const Key('ticket-resolve')), findsNothing);
      expect(find.byKey(const Key('ticket-resolved-note')), findsOneWidget);
      expect(find.byKey(const Key('ticket-new-instead')), findsNothing);
      await t.tap(find.byKey(const Key('ticket-reopen')));
      await settleB(t);
      await t.enterText(find.byKey(const Key('reopen-body')), 'The cash is still wrong');
      ex.threads['tk1'] = mkThread(status: 'open');
      await t.tap(find.byKey(const Key('reopen-confirm')));
      await settleB(t);
      expect(ex.calls, contains('reopen:tk1|The cash is still wrong'));
      expect(find.byKey(const Key('reply-body')), findsOneWidget, reason: 'open again: the reply box is back');
      expect(find.byKey(const Key('ticket-reopen')), findsNothing);
    });

    testWidgets('reopen without a message is allowed', (t) async {
      final ex = await open(t, mkThread(status: 'resolved', resolvedAt: _daysAgo(1)));
      await t.tap(find.byKey(const Key('ticket-reopen')));
      await settleB(t);
      await t.tap(find.byKey(const Key('reopen-confirm')));
      await settleB(t);
      expect(ex.calls, contains('reopen:tk1|'));
    });

    testWidgets('resolved more than 14 days ago: cannot be reopened — open a new ticket instead', (t) async {
      await open(t, mkThread(status: 'resolved', resolvedAt: _daysAgo(20)));
      expect(find.byKey(const Key('ticket-reopen')), findsNothing);
      expect(find.byKey(const Key('ticket-new-instead')), findsOneWidget);
      expect(find.textContaining('can no longer be reopened'), findsOneWidget);
      await t.tap(find.byKey(const Key('ticket-new-instead')));
      await settleB(t);
      expect(find.text('PAGE:/support/new'), findsOneWidget);
    });

    testWidgets('a server refusal to reopen (too late for the server) is shown, the page stays', (t) async {
      final ex = await open(t, mkThread(status: 'resolved', resolvedAt: _daysAgo(13)));
      ex.errorOnNext = ApiException('INVALID_TRANSITION', 'late', status: 409);
      await t.tap(find.byKey(const Key('ticket-reopen')));
      await settleB(t);
      await t.tap(find.byKey(const Key('reopen-confirm')));
      await settleB(t);
      expect(find.byType(TicketScreen), findsOneWidget);
      expect(find.text('That action isn\'t available in the current state.'), findsOneWidget);
    });

    testWidgets('a ticket that does not exist shows the not-found message with Retry', (t) async {
      final ex = FakeExtraApi();
      await pumpRoutedB(t, const TicketScreen(ticketId: 'nope'), api: FakeApi(), extraApi: ex, routes: _supportRoutes());
      await settleB(t);
      expect(find.text('We couldn\'t find what you were looking for.'), findsOneWidget);
      expect(find.byKey(const Key('retry')), findsOneWidget);
    });

    for (final lang in ['ar', 'ur']) {
      testWidgets('$lang: thread and reply box lay out at 320 dp / 1.4x text', (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 1.4;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        await open(t, mkThread(), lang: lang, size: const Size(640, 1400));
        expect(t.takeException(), isNull);
        expect(find.byKey(const Key('reply-body')), findsOneWidget);
      });
    }
  });
}
