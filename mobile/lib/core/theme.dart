import 'package:flutter/material.dart';

/// JR Logistics brand tokens — identical to the web design tokens. Never hardcode colors in widgets.
class JR {
  static const bg = Color(0xFF0B132B);
  static const bg2 = Color(0xFF111932);
  static const card = Color(0xFF151D34);
  static const accent = Color(0xFF05E5A3);
  static const accentInk = Color(0xFF04221A);
  static const cyan = Color(0xFF00C5D5);
  static const text = Color(0xFFF8FAFC);
  static const muted = Color(0xFF94A3B8);
  static const line = Color(0xFF26334D);
  static const gold = Color(0xFFF59E0B);
  static const danger = Color(0xFFF87171);
  static const radius = 14.0;
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: JR.accent, brightness: Brightness.dark,
    surface: JR.card, primary: JR.accent, onPrimary: JR.accentInk, secondary: JR.cyan, error: JR.danger,
  ).copyWith(surface: JR.card, onSurface: JR.text);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius));
  return ThemeData(
    useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: JR.bg, canvasColor: JR.bg2,
    appBarTheme: const AppBarTheme(backgroundColor: JR.bg, foregroundColor: JR.text, elevation: 0, centerTitle: false, scrolledUnderElevation: 0),
    cardTheme: CardThemeData(color: JR.card, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JR.radius), side: const BorderSide(color: JR.line))),
    dividerColor: JR.line,
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(backgroundColor: JR.accent, foregroundColor: JR.accentInk, minimumSize: const Size.fromHeight(54), shape: shape, textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(foregroundColor: JR.text, minimumSize: const Size.fromHeight(54), side: const BorderSide(color: JR.line), shape: shape, textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: JR.cyan)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: JR.bg2, contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(JR.radius), borderSide: const BorderSide(color: JR.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(JR.radius), borderSide: const BorderSide(color: JR.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(JR.radius), borderSide: const BorderSide(color: JR.accent, width: 1.5)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(JR.radius), borderSide: const BorderSide(color: JR.danger)),
      labelStyle: const TextStyle(color: JR.muted), hintStyle: const TextStyle(color: JR.muted),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: JR.bg2, indicatorColor: JR.accent.withValues(alpha: 0.15), height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? JR.accent : JR.muted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? JR.accent : JR.muted)),
    ),
    snackBarTheme: SnackBarThemeData(backgroundColor: JR.card, contentTextStyle: const TextStyle(color: JR.text), behavior: SnackBarBehavior.floating, shape: shape),
    dialogTheme: DialogThemeData(backgroundColor: JR.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: JR.line))),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: JR.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24)))),
    textTheme: Typography.whiteMountainView.apply(bodyColor: JR.text, displayColor: JR.text),
    fontFamilyFallback: const ['IBM Plex Sans Arabic', 'Tajawal', 'Noto Sans Arabic', 'Arial'],
  );
}
