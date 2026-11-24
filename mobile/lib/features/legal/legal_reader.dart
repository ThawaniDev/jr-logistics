import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/legal_api.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import 'legal_markdown_view.dart';

/// The title the app gives a legal text of this slug (the document's own title is shown inside).
String legalScreenTitle(Strings t, String slug) => t(slug == legalPrivacySlug ? 'lm.privacy_policy_title' : 'lm.terms_title');

/// Opens a link of a legal text. A path of the platform's own site that has an in-app page (`/privacy`, `/terms/driver`) opens that page; other paths and
/// https / mailto / tel links go to the system. A link that cannot be opened says so (never a silent tap).
Future<void> openLegalLink(BuildContext context, WidgetRef ref, String href) async {
  String? inApp;
  final path = href.split('?').first.split('#').first.replaceAll(RegExp(r'/+$'), '');
  if (path == '/privacy') inApp = '/legal/$legalPrivacySlug';
  if (path == '/terms/driver') inApp = '/legal/$legalDriverSlug';
  if (inApp != null) { context.push(inApp); return; }
  final uri = Uri.tryParse(href.startsWith('/') ? '${AppConfig.baseUrl}$href' : href);
  final ok = uri != null && await ref.read(linkOpenerProvider).open(uri);
  if (!ok && context.mounted) toast(context, context.tr('lm.legal_link_failed'), error: true);
}

/// One legal text: title, version and date, a note while it is only the platform's draft, and the text itself. Loads (and retries) by itself.
class LegalDocView extends ConsumerWidget {
  const LegalDocView({super.key, required this.slug, this.showTitle = true});
  final String slug;
  final bool showTitle;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final key = (slug: slug, lang: lang);
    return ref.watch(legalDocProvider(key)).when(
      loading: () => Padding(key: const Key('legal-loading'), padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: JR.accent))),
      error: (e, _) => Padding(padding: const EdgeInsets.all(8), child: Banner2(key: const Key('legal-error'), tone: Tone.warn, text: t('lm.legal_load_failed'), action: OutlinedButton.icon(key: const Key('legal-retry'), onPressed: () => ref.invalidate(legalDocProvider(key)), icon: const Icon(Icons.refresh), label: Text(t('common.retry'))))),
      data: (d) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (showTitle && d.title.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(d.title, key: const Key('legal-title'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, height: 1.3))),
        Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(
          [if (d.version.isNotEmpty) t('lg.version', {'v': d.version}), if (d.effectiveAt != null) t('lg.effective', {'date': fmtDateTime(d.effectiveAt, lang).split(' · ').first})].join(' · '),
          key: const Key('legal-version'), style: TextStyle(color: JR.muted, fontSize: 13),
        )),
        if (d.builtin) Padding(padding: const EdgeInsets.only(bottom: 12), child: Banner2(key: const Key('legal-builtin'), tone: Tone.warn, text: t('lg.builtin_notice'))),
        if (d.hasText) LegalMarkdownView(key: Key('legal-body-$slug'), source: d.body, onLink: (h) => openLegalLink(context, ref, h)) else Text(t('lm.legal_load_failed'), style: TextStyle(color: JR.muted)),
      ]),
    );
  }
}

/// `/legal/:kind` — the full-screen reader (Profile, registration, the re-acceptance screen). Public: a driver who is not signed in reads the same text.
class LegalReaderScreen extends ConsumerWidget {
  const LegalReaderScreen({super.key, required this.slug});
  final String slug;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final safe = slug == legalPrivacySlug ? legalPrivacySlug : legalDriverSlug;
    return Scaffold(
      appBar: AppBar(title: Text(legalScreenTitle(t, safe))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(legalDocProvider((slug: safe, lang: lang))); await ref.read(legalDocProvider((slug: safe, lang: lang)).future).catchError((_) => LegalDoc(const {})); },
        child: SafeArea(child: ListView(key: Key('legal-reader-$safe'), physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(20), children: [LegalDocView(slug: safe)]))),
    );
  }
}

/// A legal text inside another page (registration): the opening of the text in a clipped, fading window (it does NOT scroll by itself — a scroll box inside a
/// scrolling form traps the driver's thumb), and a button for the full screen. Tapping the window opens the full screen too.
class LegalInline extends ConsumerWidget {
  const LegalInline({super.key, required this.slug, required this.heading});
  final String slug;
  final String heading;
  static const _window = 150.0;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    return SectionCard(key: Key('legal-inline-$slug'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(heading, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
      const SizedBox(height: 8),
      InkWell(
        borderRadius: BorderRadius.circular(12), onTap: () => context.push('/legal/$slug'),
        child: Container(
          constraints: const BoxConstraints(maxHeight: _window), padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(12)),
          child: ClipRect(child: Stack(children: [
            SingleChildScrollView(physics: const NeverScrollableScrollPhysics(), child: LegalDocView(slug: slug, showTitle: false)),
            Positioned(left: 0, right: 0, bottom: 0, height: 36, child: IgnorePointer(child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [JR.bg2.withValues(alpha: 0), JR.bg2]))))),
          ])),
        ),
      ),
      const SizedBox(height: 6),
      Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(key: Key('legal-open-$slug'), style: TextButton.styleFrom(minimumSize: const Size(48, 48)), onPressed: () => context.push('/legal/$slug'), icon: const Icon(Icons.open_in_full, size: 18), label: Text(t('lm.legal_open_full'), textAlign: TextAlign.start))),
    ]));
  }
}
