import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import '../../core/legal_markdown.dart';
import '../../core/theme.dart';

/// Draws the blocks of [parseLegalMarkdown] with the app's theme: no HTML, no web view. A link calls [onLink] with its (already vetted) address.
/// Text follows the reading direction of the surrounding app (Arabic / Urdu right-to-left) and scales with the system font up to the app's limit.
class LegalMarkdownView extends StatefulWidget {
  const LegalMarkdownView({super.key, required this.source, required this.onLink});
  final String source;
  final void Function(String href) onLink;
  @override
  State<LegalMarkdownView> createState() => _LegalMarkdownViewState();
}

class _LegalMarkdownViewState extends State<LegalMarkdownView> {
  final _recognizers = <TapGestureRecognizer>[];
  late List<MdBlock> _blocks = parseLegalMarkdown(widget.source);

  @override
  void didUpdateWidget(LegalMarkdownView old) {
    super.didUpdateWidget(old);
    if (old.source != widget.source) _blocks = parseLegalMarkdown(widget.source);
  }

  @override
  void dispose() { for (final r in _recognizers) { r.dispose(); } super.dispose(); }

  /// A link's recognizer belongs to the TEXT spans of its label (a recognizer on a span that only has children never fires), so it travels down as [rec].
  List<InlineSpan> _spans(List<Inline> inlines, TextStyle base, [TapGestureRecognizer? rec]) => [
        for (final i in inlines)
          switch (i) {
            TextRun t => TextSpan(text: t.text, style: base, recognizer: rec),
            BoldRun b => TextSpan(children: _spans(b.children, base.copyWith(fontWeight: FontWeight.w800), rec)),
            EmRun e => TextSpan(children: _spans(e.children, base.copyWith(fontStyle: FontStyle.italic), rec)),
            LinkRun l => TextSpan(children: _spans(l.children, base.copyWith(color: JR.cyan, decoration: TextDecoration.underline, decorationColor: JR.cyan, fontWeight: FontWeight.w600), _tap(l.href))),
          },
      ];

  TapGestureRecognizer _tap(String href) {
    final r = TapGestureRecognizer()..onTap = () => widget.onLink(href);
    _recognizers.add(r);
    return r;
  }

  @override
  Widget build(BuildContext context) {
    // Recognizers belong to the spans built in this pass: the previous pass's are released first (a rebuild must not leak one per link).
    for (final r in _recognizers) { r.dispose(); }
    _recognizers.clear();
    final body = TextStyle(color: JR.text, fontSize: 14.5, height: 1.6);
    final children = <Widget>[];
    for (final b in _blocks) {
      switch (b) {
        case MdHeading h:
          final size = h.level == 1 ? 21.0 : h.level == 2 ? 17.5 : 15.5;
          children.add(Padding(padding: EdgeInsets.only(top: children.isEmpty ? 0 : 18, bottom: 6), child: Semantics(header: true, child: Text.rich(TextSpan(children: _spans(h.inlines, body.copyWith(fontSize: size, fontWeight: FontWeight.w800, height: 1.35)))))));
        case MdParagraph p:
          children.add(Padding(padding: const EdgeInsets.only(bottom: 10), child: Text.rich(TextSpan(children: _spans(p.inlines, body)))));
        case MdList l:
          children.add(Padding(padding: const EdgeInsets.only(bottom: 10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (var i = 0; i < l.items.length; i++)
              Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 26, child: Text(l.ordered ? '${i + 1}.' : '•', textDirection: TextDirection.ltr, textAlign: TextAlign.center, style: body.copyWith(color: JR.muted))),
                Expanded(child: Text.rich(TextSpan(children: _spans(l.items[i], body)))),
              ])),
          ])));
        case MdRule _:
          children.add(Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: Divider(height: 1, color: JR.line)));
      }
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }
}
