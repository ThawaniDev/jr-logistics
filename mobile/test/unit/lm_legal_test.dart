import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:jr_driver/core/legal_markdown.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/legal_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/auth/auth_session.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';

/// Update L / M — the legal texts: the markdown subset (safe, no HTML), the models, the re-acceptance state of the session and the router rules around it.
class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  final seen = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async { seen.add(o); return respond(o); }
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

String _plain(List<MdBlock> b) => b.map((x) => switch (x) { MdHeading h => plainText(h.inlines), MdParagraph p => plainText(p.inlines), MdList l => l.items.map(plainText).join('|'), MdRule _ => '---' }).join('\n');

const _pendingJson = {'kind': 'terms_driver', 'version': '2.0', 'title': 'Driver terms', 'effectiveAt': '2026-11-01T00:00:00.000Z', 'changeNote': 'Cash must be handed over within 3 days', 'path': '/terms/driver'};

class _MeApi extends FakeApi {
  List<Json> pending = [];
  Object? error;
  int calls_ = 0;
  @override
  Future<Json> me() async { calls_++; if (error != null) throw error!; return {'user': {'id': 'u1', 'role': 'driver', 'name': 'Omar', 'username': 'omar'}, 'legal': {'pending': pending}}; }
}

void main() {
  group('markdown subset (same rules as the web reader)', () {
    test('headings, paragraphs, bullet and numbered lists, rules, bold, italic', () {
      final b = parseLegalMarkdown('# One\n\n## Two\n\nFirst line\nsecond line\n\n- a\n- b\n\n1. x\n2) y\n\n---\n\n### Three **bold** and *em*');
      expect(b.map((x) => x.runtimeType.toString()), ['MdHeading', 'MdHeading', 'MdParagraph', 'MdList', 'MdList', 'MdRule', 'MdHeading']);
      expect([(b[0] as MdHeading).level, (b[1] as MdHeading).level, (b[6] as MdHeading).level], [1, 2, 3]);
      expect(plainText((b[2] as MdParagraph).inlines), 'First line second line', reason: 'lines of one paragraph join with a space');
      expect([(b[3] as MdList).ordered, (b[4] as MdList).ordered], [false, true]);
      expect(_plain([b[4]]), 'x|y');
      final h3 = (b[6] as MdHeading).inlines;
      expect(h3.whereType<BoldRun>().length, 1);
      expect(h3.whereType<EmRun>().length, 1);
    });

    test('an indented line continues the list item above it', () {
      final l = parseLegalMarkdown('- first item\n  goes on here\n- second')[0] as MdList;
      expect(l.items.map(plainText), ['first item goes on here', 'second']);
    });

    test('links keep their label; a safe target is kept, a dangerous one is dropped (the label stays as text)', () {
      List<Inline> inl(String s) => parseInline(s);
      final ok = inl('see [privacy](https://example.com/p?x=1) and [mail](mailto:a@b.co) and [site](/privacy)').whereType<LinkRun>().toList();
      expect(ok.map((l) => l.href), ['https://example.com/p?x=1', 'mailto:a@b.co', '/privacy']);
      for (final bad in ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', 'vbscript:x', 'https://ex ample.com', 'file:///etc/passwd']) {
        final r = inl('[click me]($bad)');
        expect(r.whereType<LinkRun>(), isEmpty, reason: bad);
        expect(plainText(r), 'click me', reason: bad);
      }
      expect(safeHref('tel:+966500000011'), 'tel:+966500000011');
      expect(safeHref('tel:abc'), isNull);
      expect(safeHref('https://x.y/a_(b)'), 'https://x.y/a_(b)');
    });

    test('raw HTML is just text (nothing is interpreted), and a backslash escapes formatting', () {
      final b = parseLegalMarkdown('<script>alert(1)</script> <b>x</b>\n\n\\*not bold\\* and \\[no link\\](x)');
      expect(plainText((b[0] as MdParagraph).inlines), '<script>alert(1)</script> <b>x</b>');
      expect(plainText((b[1] as MdParagraph).inlines), '*not bold* and [no link](x)');
    });

    test('empty and odd input never throws', () {
      expect(parseLegalMarkdown(''), isEmpty);
      expect(parseLegalMarkdown('\r\n\r\n'), isEmpty);
      expect(() => parseLegalMarkdown('**unclosed [link](broken ((( *x'), returnsNormally);
      expect(_plain(parseLegalMarkdown('**unclosed')), '**unclosed');
      expect(_plain(parseLegalMarkdown('٣. عنوان بالعربية\n\nنص **عريض** عادي')), contains('عريض'));
    });
  });

  group('models', () {
    test('PendingLegal.parse reads /auth/me, skips entries without a kind or version, and survives odd shapes', () {
      final p = PendingLegal.parse({'legal': {'pending': [_pendingJson, {'kind': 'privacy'}, 'x', {'kind': 'privacy', 'version': '1.1', 'title': 'Privacy policy'}]}});
      expect(p.map((x) => '${x.kind}@${x.version}'), ['terms_driver@2.0', 'privacy@1.1']);
      expect([p[0].slug, p[1].slug], ['driver', 'privacy']);
      expect(p[0].changeNote, 'Cash must be handed over within 3 days');
      expect(PendingLegal.parse({}), isEmpty);
      expect(PendingLegal.parse({'legal': 'x'}), isEmpty);
      expect(PendingLegal.parse(null), isEmpty);
    });

    test('LegalDoc reads title, version, date, builtin flag and body', () {
      final d = LegalDoc({'title': 'T', 'version': '1.0', 'effectiveAt': null, 'builtin': true, 'body': '## x'});
      expect([d.title, d.version, d.effectiveAt, d.builtin, d.hasText], ['T', '1.0', null, true, true]);
      expect(LegalDoc(const {}).hasText, isFalse);
    });

    test('LegalApi asks GET /legal/:kind?lang= and posts {items:[{kind,version}], locale}', () async {
      final a = _Adapter((o) => o.method == 'GET' ? _json(200, {'title': 'T', 'version': '1.0', 'body': 'b', 'builtin': false}) : _json(200, {'ok': true, 'pending': []}));
      final api = LegalApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = a, retryDelays: const []));
      final d = await api.doc('driver', 'ar');
      expect(d.title, 'T');
      expect([a.seen.last.path, a.seen.last.queryParameters], ['/legal/driver', {'lang': 'ar'}]);
      await api.doc('privacy', 'ur', version: '1.2');
      expect(a.seen.last.queryParameters, {'lang': 'ur', 'version': '1.2'});
      await api.accept([PendingLegal(_pendingJson), PendingLegal({'kind': 'privacy', 'version': '1.1'})], 'en');
      expect(a.seen.last.path, '/legal/accept');
      expect(a.seen.last.data, {'items': [{'kind': 'terms_driver', 'version': '2.0'}, {'kind': 'privacy', 'version': '1.1'}], 'locale': 'en'});
    });
  });

  group('router rules', () {
    String? go(AuthState? a, String loc, {bool loading = false}) => authRedirect(loading: loading, auth: a, location: loc);
    final pending = [PendingLegal(_pendingJson)];
    AuthState user({bool mustChange = false, List<PendingLegal> legal = const []}) => AuthState(user: {'id': 'u1', 'role': 'driver', 'mustChangePassword': mustChange}, legalPending: legal);

    test('pending terms lock every page but the acceptance page and the readers', () {
      final a = user(legal: pending);
      expect(go(a, '/'), '/legal-accept');
      expect(go(a, '/offers'), '/legal-accept');
      expect(go(a, '/job/o1'), '/legal-accept');
      expect(go(a, '/profile'), '/legal-accept');
      expect(go(a, '/legal-accept'), isNull);
      expect(go(a, '/legal/driver'), isNull);
      expect(go(a, '/legal/privacy'), isNull);
    });

    test('nothing pending: the acceptance page is not a place to stay, the readers stay readable signed in', () {
      final a = user();
      expect(go(a, '/legal-accept'), '/');
      expect(go(a, '/legal/driver'), isNull);
      expect(go(a, '/'), isNull);
      expect(go(a, '/login'), '/');
    });

    test('a temporary password comes first, then the terms', () {
      expect(go(user(mustChange: true, legal: pending), '/'), '/change-password');
      expect(go(user(mustChange: true, legal: pending), '/legal-accept'), '/change-password');
      expect(go(user(legal: pending), '/change-password'), '/legal-accept');
    });

    test('signed out: the readers and registration are open, everything else is the sign-in', () {
      const out = AuthState();
      expect(go(out, '/legal/driver'), isNull);
      expect(go(out, '/legal/privacy'), isNull);
      expect(go(out, '/register'), isNull);
      expect(go(out, '/login'), isNull);
      expect(go(out, '/legal-accept'), '/login');
      expect(go(out, '/'), '/login');
      expect(go(out, '/privacy'), '/login');
    });
  });

  group('the session knows what is pending', () {
    Future<ProviderContainer> container(_MeApi api, {bool token = true}) async {
      final store = MemoryTokenStore();
      if (token) await store.write('tok');
      SharedPreferences.setMockInitialValues({installMarkerKey: '1'});
      final c = ProviderContainer(retry: (_, _) => null, overrides: [prefsProvider.overrideWithValue(await SharedPreferences.getInstance()), apiProvider.overrideWithValue(api), tokenStoreProvider.overrideWithValue(store)]);
      addTearDown(c.dispose);
      return c;
    }

    test('a cold start with a stored session reads legal.pending from /auth/me', () async {
      final api = _MeApi()..pending = [_pendingJson];
      final c = await container(api);
      final s = await c.read(authProvider.future);
      expect(s.signedIn, isTrue);
      expect(s.legalPending.map((p) => p.kind), ['terms_driver']);
    });

    test('signing in asks /auth/me before the first screen, so the acceptance page replaces the home page without a flash', () async {
      final api = _MeApi()..pending = [_pendingJson];
      final c = await container(api, token: false);
      await c.read(authProvider.future);
      await c.read(authProvider.notifier).signIn('tok', {'id': 'u1', 'role': 'driver', 'name': 'Omar', 'language': 'en'});
      expect(c.read(authProvider).value!.legalPending.length, 1);
      expect(api.calls_, 1);
    });

    test('a /auth/me that fails at sign-in never keeps the driver out (nothing pending is assumed; the next resume asks again)', () async {
      final api = _MeApi()..error = ApiException('NETWORK', 'x');
      final c = await container(api, token: false);
      await c.read(authProvider.future);
      await c.read(authProvider.notifier).signIn('tok', {'id': 'u1', 'role': 'driver', 'name': 'Omar'});
      expect(c.read(authProvider).value!.signedIn, isTrue);
      expect(c.read(authProvider).value!.legalPending, isEmpty);
    });

    test('refreshLegal picks up a newly published version; a failure keeps what is known; updateUser keeps the list', () async {
      final api = _MeApi();
      final c = await container(api);
      await c.read(authProvider.future);
      final n = c.read(authProvider.notifier);
      expect(c.read(authProvider).value!.legalPending, isEmpty);
      api.pending = [_pendingJson];
      await n.refreshLegal();
      expect(c.read(authProvider).value!.legalPending.length, 1);
      api.error = ApiException('NETWORK', 'x');
      await n.refreshLegal();
      expect(c.read(authProvider).value!.legalPending.length, 1, reason: 'no signal must neither open nor close the gate');
      n.updateUser({'name': 'Omar T'});
      expect(c.read(authProvider).value!.legalPending.length, 1);
      expect(c.read(authProvider).value!.user!['name'], 'Omar T');
      n.setLegalPending(const []);
      expect(c.read(authProvider).value!.legalPending, isEmpty);
    });

    test('refreshLegal does nothing while signed out', () async {
      final api = _MeApi()..pending = [_pendingJson];
      final c = await container(api, token: false);
      await c.read(authProvider.future);
      await c.read(authProvider.notifier).refreshLegal();
      expect(api.calls_, 0);
    });
  });
}
