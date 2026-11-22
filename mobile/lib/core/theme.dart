import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;

/// One complete set of brand colours. Dark is the original JR look (identical to the web tokens); light is the WCAG-AA companion.
/// Text colours (`text`, `muted`, `accent`, `cyan`, `gold`, `danger`) reach 4.5:1 on `bg`, `bg2` and `card` in both palettes,
/// `accentInk` reaches 4.5:1 on `accent`, and `fieldBorder` / `accent` reach 3:1 on the input fill (test/unit/theme_contrast_test.dart).
/// `line` is a decorative hairline (card edges, dividers), so it is deliberately subtle in both modes.
@immutable
class JrPalette {
  const JrPalette({
    required this.brightness, required this.bg, required this.bg2, required this.card, required this.accent, required this.accentInk,
    required this.cyan, required this.text, required this.muted, required this.line, required this.gold, required this.danger, required this.dangerInk,
    required this.field, required this.fieldBorder, required this.warnBg, required this.shimmerBase, required this.shimmerHi,
  });
  final Brightness brightness;
  final Color bg, bg2, card, accent, accentInk, cyan, text, muted, line, gold, danger, dangerInk;
  /// Text-field fill and its (stronger, 3:1) outline.
  final Color field, fieldBorder;
  /// Background of the amber "no connection" strip.
  final Color warnBg;
  /// Skeleton / placeholder block colours.
  final Color shimmerBase, shimmerHi;

  static const dark = JrPalette(
    brightness: Brightness.dark,
    bg: Color(0xFF0B132B), bg2: Color(0xFF111932), card: Color(0xFF151D34), accent: Color(0xFF05E5A3), accentInk: Color(0xFF04221A),
    cyan: Color(0xFF00C5D5), text: Color(0xFFF8FAFC), muted: Color(0xFF94A3B8), line: Color(0xFF26334D), gold: Color(0xFFF59E0B), danger: Color(0xFFF87171), dangerInk: Color(0xFF0B132B),
    field: Color(0xFF111932), fieldBorder: Color(0xFF26334D), warnBg: Color(0xFF3A2A06), shimmerBase: Color(0xFF1B2540), shimmerHi: Color(0xFF26334D),
  );

  /// Brief values (bg `#f6f8fb`, bg2 `#edf1f7`, card `#fff`, text `#0f172a`, muted `#526179`, line `#d5dde9`) with the four semantic colours one or two
  /// steps darker than proposed (accent `#047857`→`#046e50`, cyan `#0e7490`→`#0d6882`, gold `#b45309`→`#9c4708`, danger `#dc2626`→`#b51e1e`): the proposed
  /// ones do not reach 4.5:1 as a label on their own 12–14% tint (pills, banners) or, for gold/danger, on `bg2`.
  static const light = JrPalette(
    brightness: Brightness.light,
    bg: Color(0xFFF6F8FB), bg2: Color(0xFFEDF1F7), card: Color(0xFFFFFFFF), accent: Color(0xFF046E50), accentInk: Color(0xFFFFFFFF),
    cyan: Color(0xFF0D6882), text: Color(0xFF0F172A), muted: Color(0xFF526179), line: Color(0xFFD5DDE9), gold: Color(0xFF9C4708), danger: Color(0xFFB51E1E), dangerInk: Color(0xFFFFFFFF),
    field: Color(0xFFFFFFFF), fieldBorder: Color(0xFF7A889D), warnBg: Color(0xFFFCEBC4), shimmerBase: Color(0xFFE3E9F2), shimmerHi: Color(0xFFF1F4F9),
  );

  static JrPalette of(Brightness b) => b == Brightness.dark ? dark : light;
}

/// JR Logistics brand tokens. Never hardcode colors in widgets: every colour is a getter over the ACTIVE palette, so a widget reads the
/// current mode every time it builds. The root ([JrApp]) calls [JR.use] with the effective brightness and then rebuilds the whole tree
/// (see `PaletteHost`), which is why none of these may be captured in a `const`, a `static final` or a `late final` field.
class JR {
  static JrPalette _p = JrPalette.dark;
  /// Switches the active palette (idempotent). Called by the app root and by tests; nothing else should call it.
  static void use(Brightness b) => _p = JrPalette.of(b);
  static JrPalette get palette => _p;
  static bool get isLight => _p.brightness == Brightness.light;

  static Color get bg => _p.bg;
  static Color get bg2 => _p.bg2;
  static Color get card => _p.card;
  static Color get accent => _p.accent;
  static Color get accentInk => _p.accentInk;
  static Color get cyan => _p.cyan;
  static Color get text => _p.text;
  static Color get muted => _p.muted;
  static Color get line => _p.line;
  static Color get gold => _p.gold;
  static Color get danger => _p.danger;
  /// Text / icon colour on a `danger` fill.
  static Color get dangerInk => _p.dangerInk;
  static Color get field => _p.field;
  static Color get fieldBorder => _p.fieldBorder;
  static Color get warnBg => _p.warnBg;
  static Color get shimmerBase => _p.shimmerBase;
  static Color get shimmerHi => _p.shimmerHi;
  static const radius = 14.0;

  // ── surfaces that look the same in both modes ──
  /// The signature pad is white paper with dark ink in light and dark mode alike (what the driver sees is what is uploaded).
  static const paper = Color(0xFFFFFFFF);
  static const ink = Color(0xFF0B132B);
  static const paperHint = Color(0xFF64748B);
  static const paperRule = Color(0xFFCBD5E1);
  /// Camera / full-screen photo surfaces are black with white controls in both modes.
  static const mediaBg = Color(0xFF000000);
  static const mediaFg = Color(0xFFFFFFFF);
  static const mediaFgSoft = Color(0xB3FFFFFF);
  static const mediaFgFaint = Color(0x8AFFFFFF);
  static const mediaScrim = Color(0x8A000000);
  /// Brand mint / amber that stay bright on the black camera surface (the light-mode accent is too dark there).
  static const mediaAccent = Color(0xFF05E5A3);
  static const mediaGold = Color(0xFFF59E0B);
  static const mapAccent = Color(0xFF05E5A3);
  /// Map tiles are OpenStreetMap's light style in both modes, so everything drawn on them is tuned for a light map.
  static const mapBg = Color(0xFFE5E3DF);
  static const mapCasing = Color(0xCC0B132B);
  static const mapPin = Color(0xFF0B132B);
  static const mapRing = Color(0xFFFFFFFF);
  static const mapYou = Color(0xFF2563EB);
  static const mapYouGlow = Color(0x662563EB);
  static const mapShadow = Color(0x59000000);
  static const mapAttrBg = Color(0xD9FFFFFF);
  static const mapAttrText = Color(0xFF1F2937);
}

/// Status-bar / navigation-bar styling per brightness (dark UI gets light icons and the other way round; iOS reads `statusBarBrightness`).
SystemUiOverlayStyle systemOverlayFor(Brightness b, {bool navigationBar = true}) {
  final darkUi = b == Brightness.dark;
  final icons = darkUi ? Brightness.light : Brightness.dark;
  return SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: icons,
    statusBarBrightness: darkUi ? Brightness.dark : Brightness.light,
    systemNavigationBarColor: navigationBar ? JrPalette.of(b).bg2 : null,
    systemNavigationBarIconBrightness: navigationBar ? icons : null,
    systemNavigationBarDividerColor: navigationBar ? Colors.transparent : null,
    systemNavigationBarContrastEnforced: navigationBar ? false : null,
  );
}

/// Cairo is bundled (assets/fonts); the fallbacks only matter for glyphs Cairo lacks.
const _family = 'Cairo';
const _fallback = ['IBM Plex Sans Arabic', 'Tajawal', 'Noto Sans Arabic', 'Arial'];

final _themes = <Brightness, ThemeData>{};

/// The app theme for [brightness]. It is built from the palette passed in (not from the active one), so it is pure and cached.
ThemeData buildTheme([Brightness brightness = Brightness.dark]) => _themes.putIfAbsent(brightness, () => _build(JrPalette.of(brightness)));

// Button, snack-bar and navigation-bar styles REPLACE the theme's text style (they do not merge with it), so the family has to be repeated
// in them or those labels fall back to the platform font instead of Cairo.
ThemeData _build(JrPalette p) {
  final scheme = ColorScheme.fromSeed(
    seedColor: p.accent, brightness: p.brightness,
    surface: p.card, primary: p.accent, onPrimary: p.accentInk, secondary: p.cyan, error: p.danger,
  ).copyWith(surface: p.card, onSurface: p.text);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius));
  // Material 3 tints raised surfaces with the primary colour; on the white light card that reads as a green cast, so it is switched off there.
  final tint = p.brightness == Brightness.light ? Colors.transparent : null;
  OutlineInputBorder outline(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(JR.radius), borderSide: BorderSide(color: c, width: w));
  return ThemeData(
    useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: p.bg, canvasColor: p.bg2,
    appBarTheme: AppBarTheme(backgroundColor: p.bg, foregroundColor: p.text, elevation: 0, centerTitle: false, scrolledUnderElevation: 0, systemOverlayStyle: systemOverlayFor(p.brightness, navigationBar: false)),
    cardTheme: CardThemeData(color: p.card, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius), side: BorderSide(color: p.line))),
    dividerColor: p.line,
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(backgroundColor: p.accent, foregroundColor: p.accentInk, minimumSize: const Size.fromHeight(54), shape: shape, textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, fontFamily: _family, fontFamilyFallback: _fallback))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(foregroundColor: p.text, minimumSize: const Size.fromHeight(54), side: BorderSide(color: p.fieldBorder), shape: shape, textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, fontFamily: _family, fontFamilyFallback: _fallback))),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: p.cyan)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: p.field, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: outline(p.fieldBorder), enabledBorder: outline(p.fieldBorder), focusedBorder: outline(p.accent, 1.5), errorBorder: outline(p.danger),
      labelStyle: TextStyle(color: p.muted), hintStyle: TextStyle(color: p.muted),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: p.bg2, indicatorColor: p.accent.withValues(alpha: 0.15), height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontFamily: _family, fontFamilyFallback: _fallback, fontSize: 12, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? p.accent : p.muted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? p.accent : p.muted)),
    ),
    snackBarTheme: SnackBarThemeData(backgroundColor: p.card, contentTextStyle: TextStyle(color: p.text, fontFamily: _family, fontFamilyFallback: _fallback), behavior: SnackBarBehavior.floating, shape: shape),
    dialogTheme: DialogThemeData(backgroundColor: p.card, surfaceTintColor: tint, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: p.line))),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: p.card, surfaceTintColor: tint, shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24)))),
    // `Typography.whiteMountainView` carries its own family (Roboto), which wins over ThemeData.fontFamily — so Cairo is applied to the text theme itself.
    textTheme: (p.brightness == Brightness.dark ? Typography.whiteMountainView : Typography.blackMountainView).apply(fontFamily: _family, fontFamilyFallback: _fallback, bodyColor: p.text, displayColor: p.text),
    fontFamily: _family,
    fontFamilyFallback: _fallback,
  );
}
