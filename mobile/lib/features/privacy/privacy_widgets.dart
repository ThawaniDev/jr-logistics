import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers_extra.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// "Download my data": fetches the JSON file of everything the platform holds about the driver (`GET /privacy/export`) and hands it to the share sheet
/// (save to Files, AirDrop, mail…). One tap, one request at a time; a rate limit or a lost signal is a localized message, never a raw error.
class ExportDataButton extends ConsumerStatefulWidget {
  const ExportDataButton({super.key, this.filled = false});
  final bool filled;
  @override
  ConsumerState<ExportDataButton> createState() => _ExportDataButtonState();
}

class _ExportDataButtonState extends ConsumerState<ExportDataButton> {
  bool _busy = false;

  String _fileName() {
    final n = DateTime.now();
    String two(int v) => v.toString().padLeft(2, '0');
    return 'jr-my-data-${n.year}-${two(n.month)}-${two(n.day)}.json';
  }

  Future<void> _export() async {
    if (_busy) return;
    final box = context.findRenderObject();
    final origin = box is RenderBox && box.hasSize ? box.localToGlobal(Offset.zero) & box.size : null; // where the share popover points on an iPad
    setState(() => _busy = true);
    try {
      final bytes = await ref.read(privacyRepoProvider).exportData();
      if (!mounted) return;
      final ok = await ref.read(fileSharerProvider).shareFile(bytes: bytes, filename: _fileName(), mime: 'application/json', subject: context.tr('lm.export_share_subject'), origin: origin);
      if (!mounted) return;
      toast(context, context.tr(ok ? 'pv.export_done' : 'lm.export_share_failed'), error: !ok);
      ref.invalidate(privacyStatusProvider); // "last downloaded" moves
    } catch (e) {
      if (mounted) toast(context, errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final label = Text(_busy ? t('lm.export_preparing') : t('pv.export_btn'), textAlign: TextAlign.center);
    return widget.filled
        ? FilledButton.icon(key: const Key('privacy-export'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : _export, icon: busyIcon(_busy, Icons.download_outlined), label: label)
        : OutlinedButton.icon(key: const Key('privacy-export'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)), onPressed: _busy ? null : _export, icon: busyIcon(_busy, Icons.download_outlined, color: JR.accent), label: label);
  }
}

/// The "Privacy & data" card of the Profile page: what we keep, a one-tap data download, the way to the deletion page and the privacy policy.
class PrivacyCard extends StatelessWidget {
  const PrivacyCard({super.key});
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(key: const Key('privacy-card'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.privacy_tip_outlined, color: JR.cyan),
        const SizedBox(width: 12),
        Expanded(child: Text(t('pv.card_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5, height: 1.3))),
      ]),
      const SizedBox(height: 6),
      Text(t('pv.card_sub'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.45)),
      const SizedBox(height: 14),
      const ExportDataButton(),
      const SizedBox(height: 8),
      OutlinedButton.icon(key: const Key('privacy-open-delete'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50), foregroundColor: JR.danger, side: BorderSide(color: JR.danger.withValues(alpha: 0.5))), onPressed: () => context.push('/privacy'), icon: const Icon(Icons.person_remove_outlined), label: Text(t('pv.delete_title'), textAlign: TextAlign.center)),
      const SizedBox(height: 4),
      TextButton(key: const Key('privacy-policy-link'), style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: () => context.push('/legal/privacy'), child: Text(t('pv.policy_link'), textAlign: TextAlign.center)),
    ]));
  }
}
