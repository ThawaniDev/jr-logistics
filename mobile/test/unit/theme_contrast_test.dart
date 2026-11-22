import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/theme.dart';
import 'package:jr_driver/features/jobs/route_map_logic.dart' show legPalette;

/// WCAG 2.x contrast ratio between two opaque colours.
double contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// [fg] painted at [alpha] over [bg] (how tinted pills / banners / selected chips are drawn).
Color tint(Color fg, Color bg, double alpha) => Color.alphaBlend(fg.withValues(alpha: alpha), bg);

void main() {
  test('the contrast helper agrees with the WCAG reference values', () {
    expect(contrast(const Color(0xFF000000), const Color(0xFFFFFFFF)), closeTo(21, 0.01));
    expect(contrast(const Color(0xFF777777), const Color(0xFFFFFFFF)), closeTo(4.48, 0.02));
    expect(contrast(const Color(0xFF123456), const Color(0xFF123456)), closeTo(1, 0.0001));
  });

  for (final p in [JrPalette.dark, JrPalette.light]) {
    final name = p.brightness.name;
    group('$name palette', () {
      final surfaces = {'bg': p.bg, 'bg2': p.bg2, 'card': p.card};
      final texts = {'text': p.text, 'muted': p.muted, 'accent': p.accent, 'cyan': p.cyan, 'gold': p.gold, 'danger': p.danger};

      test('every text colour reads at 4.5:1 or better on bg, bg2 and card', () {
        for (final t in texts.entries) {
          for (final s in surfaces.entries) {
            expect(contrast(t.value, s.value), greaterThanOrEqualTo(4.5), reason: '${t.key} on ${s.key}');
          }
        }
      });

      test('text on a fill reads at 4.5:1: accentInk on accent, dangerInk on danger, and the other brand colours under accentInk', () {
        expect(contrast(p.accentInk, p.accent), greaterThanOrEqualTo(4.5), reason: 'accentInk on accent');
        expect(contrast(p.dangerInk, p.danger), greaterThanOrEqualTo(4.5), reason: 'dangerInk on danger');
        for (final f in {'cyan': p.cyan, 'gold': p.gold}.entries) {
          expect(contrast(p.accentInk, f.value), greaterThanOrEqualTo(4.5), reason: 'accentInk on ${f.key} (filled round actions)');
        }
      });

      test('pills, banners and selected chips: the label colour on its own tint over card, bg and bg2', () {
        for (final t in {'accent': p.accent, 'cyan': p.cyan, 'gold': p.gold, 'danger': p.danger, 'muted': p.muted}.entries) {
          for (final s in surfaces.entries) {
            for (final alpha in [0.1, 0.12, 0.14]) {
              expect(contrast(t.value, tint(t.value, s.value, alpha)), greaterThanOrEqualTo(4.5), reason: '${t.key} tint $alpha on ${s.key}');
            }
          }
          // selected filter chips (0.2) sit on the page or on a card
          if (t.key != 'muted') {
            for (final s in [p.bg, p.card]) { expect(contrast(t.value, tint(t.value, s, 0.2)), greaterThanOrEqualTo(4.0), reason: '${t.key} selected chip on a surface'); }
          }
        }
        // chat bubbles / selected filter chips: body text on an accent tint
        for (final alpha in [0.12, 0.18, 0.2]) {
          expect(contrast(p.text, tint(p.accent, p.card, alpha)), greaterThanOrEqualTo(7), reason: 'text on accent tint $alpha');
        }
      });

      test('input fields: the focus ring is 3:1 against the fill and the page; text and hints read on the fill', () {
        for (final s in {'field': p.field, 'bg': p.bg, 'card': p.card}.entries) {
          expect(contrast(p.accent, s.value), greaterThanOrEqualTo(3), reason: 'focus ring on ${s.key}');
        }
        expect(contrast(p.text, p.field), greaterThanOrEqualTo(4.5));
        expect(contrast(p.muted, p.field), greaterThanOrEqualTo(4.5), reason: 'hint / label text');
        expect(contrast(p.danger, p.field), greaterThanOrEqualTo(4.5), reason: 'error text');
      });

      test('the offline strip: text and the amber icon on its background', () {
        expect(contrast(p.text, p.warnBg), greaterThanOrEqualTo(4.5));
        expect(contrast(p.gold, p.warnBg), greaterThanOrEqualTo(4.5));
      });

      test('the decorative hairline is still visible against the surfaces (but is not a text colour)', () {
        for (final s in surfaces.entries) { expect(contrast(p.line, s.value), greaterThan(1.1), reason: 'line on ${s.key}'); }
      });

      test('skeleton blocks are visible on the card and the page but never as loud as the text', () {
        for (final s in [p.card, p.bg]) {
          expect(contrast(p.shimmerBase, s), greaterThan(1.05), reason: 'shimmer base on a surface');
          expect(contrast(p.shimmerBase, s), lessThan(2.2));
        }
        expect(p.shimmerBase, isNot(p.shimmerHi));
      });
    });
  }

  test('light input outlines are a real 3:1 boundary (WCAG 1.4.11); dark keeps its original hairline outline by decision', () {
    const l = JrPalette.light;
    for (final s in [l.field, l.bg, l.card]) { expect(contrast(l.fieldBorder, s), greaterThanOrEqualTo(3)); }
    expect(JrPalette.dark.fieldBorder, JrPalette.dark.line);
    expect(JrPalette.dark.field, JrPalette.dark.bg2);
  });

  test('dark stays exactly the original JR palette (the light mode must not move a single dark pixel)', () {
    const d = JrPalette.dark;
    expect([d.bg, d.bg2, d.card, d.accent, d.accentInk, d.cyan, d.text, d.muted, d.line, d.gold, d.danger],
        const [Color(0xFF0B132B), Color(0xFF111932), Color(0xFF151D34), Color(0xFF05E5A3), Color(0xFF04221A), Color(0xFF00C5D5), Color(0xFFF8FAFC), Color(0xFF94A3B8), Color(0xFF26334D), Color(0xFFF59E0B), Color(0xFFF87171)]);
  });

  test('light keeps the proposed surface / text tokens (only the four semantic colours moved, see JrPalette.light)', () {
    const l = JrPalette.light;
    expect([l.bg, l.bg2, l.card, l.text, l.muted, l.line, l.accentInk],
        const [Color(0xFFF6F8FB), Color(0xFFEDF1F7), Color(0xFFFFFFFF), Color(0xFF0F172A), Color(0xFF526179), Color(0xFFD5DDE9), Color(0xFFFFFFFF)]);
  });

  test('JR.* follows the active palette (getters, not constants) and JR.use is idempotent', () {
    addTearDown(() => JR.use(Brightness.dark));
    JR.use(Brightness.light);
    expect([JR.bg, JR.card, JR.text, JR.accent, JR.isLight], [JrPalette.light.bg, JrPalette.light.card, JrPalette.light.text, JrPalette.light.accent, true]);
    JR.use(Brightness.light);
    expect(JR.palette, same(JrPalette.light));
    JR.use(Brightness.dark);
    expect([JR.bg, JR.card, JR.text, JR.accent, JR.isLight], [JrPalette.dark.bg, JrPalette.dark.card, JrPalette.dark.text, JrPalette.dark.accent, false]);
  });

  test('buildTheme is pure per brightness (does not depend on the active palette) and carries the right scheme', () {
    addTearDown(() => JR.use(Brightness.dark));
    JR.use(Brightness.dark);
    final light = buildTheme(Brightness.light);
    expect(light.brightness, Brightness.light);
    expect(light.scaffoldBackgroundColor, JrPalette.light.bg);
    expect(light.colorScheme.primary, JrPalette.light.accent);
    expect(light.colorScheme.onPrimary, JrPalette.light.accentInk);
    expect(light.colorScheme.surface, JrPalette.light.card);
    expect(light.textTheme.bodyMedium?.color, JrPalette.light.text);
    expect(light.inputDecorationTheme.fillColor, JrPalette.light.field);
    final dark = buildTheme(Brightness.dark);
    expect(dark.brightness, Brightness.dark);
    expect(dark.scaffoldBackgroundColor, JrPalette.dark.bg);
    expect(dark.textTheme.bodyMedium?.color, JrPalette.dark.text);
    expect(identical(buildTheme(Brightness.light), light), isTrue, reason: 'cached');
    expect(buildTheme().brightness, Brightness.dark, reason: 'the argument-less call keeps meaning the original dark theme');
  });

  test('system bars: dark UI gets light icons, light UI gets dark icons (and the iOS bar brightness is the opposite of the icons)', () {
    final d = systemOverlayFor(Brightness.dark), l = systemOverlayFor(Brightness.light);
    expect([d.statusBarIconBrightness, d.statusBarBrightness, d.systemNavigationBarIconBrightness], [Brightness.light, Brightness.dark, Brightness.light]);
    expect([l.statusBarIconBrightness, l.statusBarBrightness, l.systemNavigationBarIconBrightness], [Brightness.dark, Brightness.light, Brightness.dark]);
    expect(l.systemNavigationBarColor, JrPalette.light.bg2);
    expect(systemOverlayFor(Brightness.light, navigationBar: false).systemNavigationBarColor, isNull);
  });

  test('surfaces that look the same in both modes stay readable: the signature paper and the map pins / markers', () {
    expect(contrast(JR.ink, JR.paper), greaterThanOrEqualTo(7), reason: 'signature ink on paper');
    expect(contrast(JR.paperHint, JR.paper), greaterThanOrEqualTo(4.5), reason: '"sign here" hint');
    expect(contrast(JR.mediaFg, JR.mediaBg), greaterThanOrEqualTo(15));
    expect(contrast(JR.mediaAccent, JR.mediaBg), greaterThanOrEqualTo(7), reason: 'scan frame on the camera');
    expect(contrast(JR.mediaGold, JR.mediaBg), greaterThanOrEqualTo(4.5));
    expect(contrast(JR.mapAttrText, Color.alphaBlend(JR.mapAttrBg, JR.mapBg)), greaterThanOrEqualTo(7), reason: 'OSM attribution');
    expect(contrast(JR.mapAccent, JR.mapPin), greaterThanOrEqualTo(7), reason: 'origin pin icon');
    for (final c in legPalette) { expect(contrast(JR.ink, c), greaterThanOrEqualTo(4.5), reason: 'stop number on route colour $c'); }
  });
}
