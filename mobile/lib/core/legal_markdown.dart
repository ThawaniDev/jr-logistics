/// A deliberately tiny, safe markdown reader for the legal texts — the same subset and the same rules as the web's `lib/legal-markdown.ts`: headings
/// (`#` / `##` / `###`), paragraphs, bullet (`-`) and numbered (`1.`) lists, rules (`---`), `**bold**`, `*italic*` and `[text](https://…)`.
/// It produces a plain data tree (no widgets, no HTML): raw HTML in a text is just shown as text, and a link may only point at https / http / mailto / tel
/// or a path of the platform's own site, so a `javascript:` or `data:` target is dropped (the label stays). Pure, so it is unit-tested without Flutter.
sealed class Inline { const Inline(); }

class TextRun extends Inline { const TextRun(this.text); final String text; }
class BoldRun extends Inline { const BoldRun(this.children); final List<Inline> children; }
class EmRun extends Inline { const EmRun(this.children); final List<Inline> children; }
class LinkRun extends Inline { const LinkRun(this.href, this.children); final String href; final List<Inline> children; }

sealed class MdBlock { const MdBlock(); }

class MdHeading extends MdBlock { const MdHeading(this.level, this.inlines); final int level; final List<Inline> inlines; }
class MdParagraph extends MdBlock { const MdParagraph(this.inlines); final List<Inline> inlines; }
class MdList extends MdBlock { const MdList({required this.ordered, required this.items}); final bool ordered; final List<List<Inline>> items; }
class MdRule extends MdBlock { const MdRule(); }

const _escapable = r'\*_[]()<>`#-.!+{}|~';

/// The address a link may point to, or null (anything else — `javascript:`, `data:`, a protocol-relative `//host`, control characters — is dropped, the text stays).
String? safeHref(String raw) {
  final u = raw.trim();
  if (u.isEmpty || u.length > 600 || RegExp('[\u0000-\u001f\u007f\\s<>"\'`\\\\]').hasMatch(u)) return null;
  if (RegExp(r'^https?://[^/\s]+', caseSensitive: false).hasMatch(u)) return u;
  if (RegExp(r'^mailto:[^@\s]+@[^@\s]+$', caseSensitive: false).hasMatch(u)) return u;
  if (RegExp(r'^tel:\+?[0-9]{5,20}$', caseSensitive: false).hasMatch(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return null;
}

/// Index of the first unescaped [needle] at or after [from] (a backslash protects the next character), or -1.
int _findClose(String s, String needle, int from) {
  for (var i = from; i < s.length; i++) {
    if (s[i] == r'\') { i++; continue; }
    if (s.startsWith(needle, i)) return i;
  }
  return -1;
}

/// The `)` that closes a link target opened just before [from]; parentheses inside the target must balance.
int _findCloseParen(String s, int from) {
  var depth = 0;
  for (var i = from; i < s.length; i++) {
    if (s[i] == r'\') { i++; continue; }
    if (s[i] == '(') { depth++; }
    else if (s[i] == ')') { if (depth == 0) return i; depth--; }
  }
  return -1;
}

List<Inline> parseInline(String s) {
  final out = <Inline>[];
  final buf = StringBuffer();
  void flush() { if (buf.isNotEmpty) { out.add(TextRun(buf.toString())); buf.clear(); } }
  for (var i = 0; i < s.length; i++) {
    final ch = s[i];
    final next = i + 1 < s.length ? s[i + 1] : null;
    if (ch == r'\' && next != null && _escapable.contains(next)) { buf.write(next); i++; continue; }
    if (ch == '*' && next == '*') {
      final j = _findClose(s, '**', i + 2);
      if (j > i + 2) { flush(); out.add(BoldRun(parseInline(s.substring(i + 2, j)))); i = j + 1; continue; }
    }
    if (ch == '*' && next != null && next != ' ' && next != '*') {
      final j = _findClose(s, '*', i + 1);
      if (j > i + 1 && s[j - 1] != ' ') { flush(); out.add(EmRun(parseInline(s.substring(i + 1, j)))); i = j; continue; }
    }
    if (ch == '[') {
      final close = _findClose(s, ']', i + 1);
      if (close > i && close + 1 < s.length && s[close + 1] == '(') {
        final end = _findCloseParen(s, close + 2);
        if (end > close) {
          final label = parseInline(s.substring(i + 1, close));
          final href = safeHref(s.substring(close + 2, end));
          flush();
          if (href != null) { out.add(LinkRun(href, label)); } else { out.addAll(label); }
          i = end;
          continue;
        }
      }
    }
    buf.write(ch);
  }
  flush();
  return out;
}

/// The text of [inlines] without any formatting (for tests and for accessibility labels).
String plainText(List<Inline> inlines) => inlines.map((x) => switch (x) { TextRun t => t.text, BoldRun b => plainText(b.children), EmRun e => plainText(e.children), LinkRun l => plainText(l.children) }).join();

final _heading = RegExp(r'^(#{1,3})\s+(.+?)\s*#*\s*$');
final _bullet = RegExp(r'^\s{0,3}[-*•]\s+(.*)$');
final _ordered = RegExp(r'^\s{0,3}\d{1,3}[.)]\s+(.*)$');
final _rule = RegExp(r'^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$');

List<MdBlock> parseLegalMarkdown(String src) {
  final lines = src.replaceAll(RegExp(r'\r\n?'), '\n').split('\n');
  final blocks = <MdBlock>[];
  var para = <String>[];
  bool? listOrdered;
  var items = <String>[];
  void endPara() { if (para.isNotEmpty) { blocks.add(MdParagraph(parseInline(para.join(' ')))); para = <String>[]; } }
  void endList() { if (listOrdered != null) { blocks.add(MdList(ordered: listOrdered!, items: [for (final i in items) parseInline(i)])); listOrdered = null; items = <String>[]; } }
  for (final raw in lines) {
    final line = raw.trimRight();
    if (line.trim().isEmpty) { endPara(); endList(); continue; }
    final h = _heading.firstMatch(line);
    if (h != null) { endPara(); endList(); blocks.add(MdHeading(h.group(1)!.length, parseInline(h.group(2)!))); continue; }
    if (_rule.hasMatch(line)) { endPara(); endList(); blocks.add(const MdRule()); continue; }
    final b = _bullet.firstMatch(line);
    final o = b == null ? _ordered.firstMatch(line) : null;
    if (b != null || o != null) {
      endPara();
      final ordered = b == null;
      if (listOrdered != null && listOrdered != ordered) endList();
      listOrdered ??= ordered;
      items.add((b ?? o)!.group(1)!);
      continue;
    }
    if (listOrdered != null && RegExp(r'^\s{2,}\S').hasMatch(raw)) { items[items.length - 1] = '${items.last} ${line.trim()}'; continue; } // an indented line continues the item above
    endList();
    para.add(line.trim());
  }
  endPara();
  endList();
  return blocks;
}
