import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../providers.dart';
import '../../services_notify.dart';
import '../../widgets/common.dart';

const _askedKey = 'notif_asked', _dismissedKey = 'notif_prompt_dismissed';

/// A polite, never-blocking offer to turn on new-offer alerts, shown on the home screen — not at app start, and only while the OS has not been asked
/// yet and the driver has not said "Not now". One tap on "Turn on" shows the OS permission prompt (Android 13+, iOS). Hidden when the platform
/// cannot show notifications at all, when they are already on, or once the driver has decided.
class NotifyPromptCard extends ConsumerStatefulWidget {
  const NotifyPromptCard({super.key});
  @override
  ConsumerState<NotifyPromptCard> createState() => _NotifyPromptCardState();
}

class _NotifyPromptCardState extends ConsumerState<NotifyPromptCard> {
  bool _hidden = false, _busy = false;

  Future<void> _turnOn() async {
    if (_busy) return;
    setState(() => _busy = true);
    final prefs = ref.read(prefsProvider);
    await prefs.setBool(_askedKey, true);
    final ok = await ref.read(localNotifierProvider).requestPermission();
    ref.invalidate(notifyGrantedProvider);
    if (!mounted) return;
    setState(() { _busy = false; _hidden = true; });
    if (!ok) toast(context, context.tr('fmb.notify_denied'));
  }

  Future<void> _later() async {
    await ref.read(prefsProvider).setBool(_dismissedKey, true);
    if (mounted) setState(() => _hidden = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_hidden) return const SizedBox.shrink();
    final prefs = ref.watch(prefsProvider);
    if (prefs.getBool(_askedKey) == true || prefs.getBool(_dismissedKey) == true) return const SizedBox.shrink();
    final granted = ref.watch(notifyGrantedProvider).value;
    if (granted != false) return const SizedBox.shrink(); // already on (true) or not supported / unknown (null)
    final t = context.tr;
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: Banner2(
      key: const Key('notify-prompt'), tone: Tone.info,
      title: t('fmb.notify_prompt_title'), text: t('fmb.notify_prompt_body'),
      action: Row(children: [
        Expanded(child: FilledButton(key: const Key('notify-allow'), style: FilledButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: _busy ? null : _turnOn, child: Text(t('fmb.notify_turn_on'), textAlign: TextAlign.center))),
        const SizedBox(width: 10),
        Expanded(child: OutlinedButton(key: const Key('notify-later'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: _busy ? null : _later, child: Text(t('m.not_now'), textAlign: TextAlign.center))),
      ]),
    ));
  }
}

/// Shown on the notifications screen when the driver said no to the OS prompt: how to turn alerts back on.
class NotifyOffBanner extends ConsumerWidget {
  const NotifyOffBanner({super.key, this.padding = const EdgeInsets.only(bottom: 4)});
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asked = ref.watch(prefsProvider).getBool(_askedKey) == true;
    final granted = ref.watch(notifyGrantedProvider).value;
    if (!asked || granted != false) return const SizedBox.shrink();
    final t = context.tr;
    return Padding(padding: padding, child: Banner2(
      key: const Key('notify-off'), tone: Tone.warn, icon: Icons.notifications_off_outlined, text: t('fmb.notify_off_body'),
      action: OutlinedButton.icon(onPressed: () => ref.read(localNotifierProvider).openSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings'))),
    ));
  }
}
