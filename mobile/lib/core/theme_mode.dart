import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers.dart';
import 'theme.dart';

/// Preference key (shared_preferences) of the chosen appearance: `system` (default), `light` or `dark`. Per device, never synced.
const themeModePrefKey = 'theme';

ThemeMode parseThemeMode(String? v) => switch (v) { 'light' => ThemeMode.light, 'dark' => ThemeMode.dark, _ => ThemeMode.system };
String themeModeName(ThemeMode m) => switch (m) { ThemeMode.light => 'light', ThemeMode.dark => 'dark', ThemeMode.system => 'system' };

/// The brightness the UI actually shows: the choice, or — in `system` mode — what the phone is set to right now.
Brightness resolveBrightness(ThemeMode mode, Brightness platform) => switch (mode) { ThemeMode.light => Brightness.light, ThemeMode.dark => Brightness.dark, ThemeMode.system => platform };

class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => parseThemeMode(ref.read(prefsProvider).getString(themeModePrefKey));

  Future<void> set(ThemeMode mode) async {
    state = mode;
    try { await ref.read(prefsProvider).setString(themeModePrefKey, themeModeName(mode)); } catch (_) {} // a failed write only loses the choice on the next launch
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

/// Sits right under the MaterialApp: makes [JR] read the palette of [brightness], sets the system-bar style, and — when the brightness
/// CHANGES (the driver picked another mode, or the phone switched at sunset in `system` mode) — marks every widget below dirty so
/// each one re-reads the palette on this very frame.
///
/// A `const` widget instance (or one whose parent did not rebuild) would otherwise keep what it painted with the old palette, and
/// re-keying the tree instead would throw away what the driver is typing / the scroll positions / a half-finished delivery.
/// Marking dirty keeps all State, the router location and open sheets; only `build` methods run again.
class PaletteHost extends StatefulWidget {
  const PaletteHost({super.key, required this.brightness, required this.child});
  final Brightness brightness;
  final Widget child;
  @override
  State<PaletteHost> createState() => _PaletteHostState();
}

class _PaletteHostState extends State<PaletteHost> {
  Brightness? _applied;

  @override
  Widget build(BuildContext context) {
    final b = widget.brightness;
    final changed = _applied != null && _applied != b;
    JR.use(b); // before any child builds
    _applied = b;
    if (changed) rebuildAllBelow(context);
    return AnnotatedRegion<SystemUiOverlayStyle>(value: systemOverlayFor(b), child: widget.child);
  }
}

/// Marks every element below [context] dirty (allowed from inside an ancestor's `build`; the build owner then rebuilds them top-down).
void rebuildAllBelow(BuildContext context) {
  void mark(Element e) {
    e.markNeedsBuild();
    e.visitChildren(mark);
  }
  (context as Element).visitChildren(mark);
}
