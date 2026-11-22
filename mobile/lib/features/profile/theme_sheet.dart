import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/theme_mode.dart';

String themeModeLabel(BuildContext c, ThemeMode m) => c.tr(switch (m) { ThemeMode.system => 'm.theme_system', ThemeMode.light => 'm.theme_light', ThemeMode.dark => 'm.theme_dark' });

/// Appearance: follow the phone (default), always light, or always dark. Applies at once and is remembered on this device.
Future<void> showThemeSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    builder: (c) => SafeArea(child: Consumer(builder: (c, ref, _) {
      final current = ref.watch(themeModeProvider);
      final options = [
        (ThemeMode.system, Icons.brightness_auto_outlined, 'm.theme_system_hint'),
        (ThemeMode.light, Icons.light_mode_outlined, null),
        (ThemeMode.dark, Icons.dark_mode_outlined, null),
      ];
      return Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.fromLTRB(20, 16, 20, 4), child: Align(alignment: AlignmentDirectional.centerStart, child: Text(c.tr('m.theme_title'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)))),
        for (final (mode, icon, hint) in options)
          Semantics(
            selected: current == mode, inMutuallyExclusiveGroup: true,
            child: ListTile(
              key: Key('theme-opt-${themeModeName(mode)}'), minVerticalPadding: 12,
              leading: Icon(icon, color: current == mode ? JR.accent : JR.muted),
              title: Text(themeModeLabel(c, mode), style: const TextStyle(fontSize: 17)),
              subtitle: hint == null ? null : Text(c.tr(hint), style: TextStyle(color: JR.muted, fontSize: 13)),
              trailing: current == mode ? Icon(Icons.check_circle, color: JR.accent) : null,
              onTap: () async {
                await ref.read(themeModeProvider.notifier).set(mode);
                if (c.mounted) Navigator.pop(c);
              },
            ),
          ),
        const SizedBox(height: 8),
      ]);
    })),
  );
}
