import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';

Future<void> showLanguageSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet(
    context: context,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const SizedBox(height: 12),
        for (final code in supportedCodes)
          ListTile(
            title: Text(langNames[code]!, style: const TextStyle(fontSize: 17)),
            trailing: ref.read(localeProvider) == code ? const Icon(Icons.check_circle, color: JR.accent) : null,
            onTap: () async {
              await ref.read(localeProvider.notifier).set(code);
              // persist for signed-in drivers so web and mobile stay in sync (failure is harmless)
              if (ref.read(authProvider).value?.signedIn == true) { try { await ref.read(apiProvider).updateProfile({'language': code}); } catch (_) {} }
              if (c.mounted) Navigator.pop(c);
            },
          ),
        const SizedBox(height: 8),
      ]),
    ),
  );
}
