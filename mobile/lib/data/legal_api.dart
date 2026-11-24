import 'api_client.dart';

String? _s(Object? v) => v is String ? v : null;

/// The kinds of legal text the driver app shows, by the slug `GET /legal/:kind` takes: the driver terms and the privacy policy.
const legalDriverSlug = 'driver';
const legalPrivacySlug = 'privacy';

/// `GET /legal/:kind?lang=` — one text in one language. [body] is the markdown subset of `core/legal_markdown.dart`; [builtin] = the platform's own draft,
/// not yet reviewed and published by the operator (the readers say so).
class LegalDoc {
  LegalDoc(this.j);
  final Json j;
  String get kind => _s(j['kind']) ?? '';
  String get title => _s(j['title']) ?? '';
  String get version => _s(j['version']) ?? '';
  /// ISO time the version came into force; null for the built-in text.
  String? get effectiveAt => _s(j['effectiveAt']);
  String get body => _s(j['body']) ?? '';
  bool get builtin => j['builtin'] == true;
  bool get hasText => body.trim().isNotEmpty;
}

/// One entry of `GET /auth/me` → `legal.pending`: a text the person has to accept again before going on.
class PendingLegal {
  PendingLegal(this.j);
  final Json j;
  /// `terms_driver` | `privacy` (what `POST /legal/accept` takes back).
  String get kind => _s(j['kind']) ?? '';
  String get version => _s(j['version']) ?? '';
  String get title => _s(j['title']) ?? '';
  String? get effectiveAt => _s(j['effectiveAt']);
  String? get changeNote => _s(j['changeNote']);
  /// The slug the reader route takes (`driver` | `privacy`).
  String get slug => kind == 'privacy' ? legalPrivacySlug : legalDriverSlug;
  bool get valid => kind.isNotEmpty && version.isNotEmpty;

  /// From the answer of `GET /auth/me` (`{legal: {pending: [...]}}`).
  static List<PendingLegal> parse(Object? me) {
    final legal = me is Map ? me['legal'] : null;
    return parseList(legal is Map ? legal['pending'] : null);
  }

  /// From the list itself (`pending` of `GET /auth/me` and of `POST /legal/accept`).
  static List<PendingLegal> parseList(Object? raw) =>
      raw is List ? [for (final e in raw) if (e is Map) PendingLegal(e.cast<String, dynamic>())].where((p) => p.valid).toList() : const [];
}

/// The legal endpoints: reading a text (public) and accepting the versions in force (signed in).
class LegalApi {
  LegalApi(this.c);
  final ApiClient c;

  Future<LegalDoc> doc(String slug, String lang, {String? version}) async => LegalDoc(await c.get('/legal/$slug', query: {'lang': lang, 'version': ?version}));

  /// `409 CONFLICT details.field=version` = a newer version is in force (the screen reloads `/auth/me`); `403 FORBIDDEN` = nothing to accept for this account.
  Future<Json> accept(List<PendingLegal> items, String locale) => c.post('/legal/accept', {'items': [for (final i in items) {'kind': i.kind, 'version': i.version}], 'locale': locale});
}
