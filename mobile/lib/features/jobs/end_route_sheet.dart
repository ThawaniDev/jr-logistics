import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'stop_runner.dart';

/// "End route" (the driver cannot continue): asks for the reason, then ends it on the server — every parcel still on the vehicle becomes a return.
/// Shared by the stops panel (routing on) and the shipments screen (routing off).
Future<void> endRouteFlow(BuildContext context, WidgetRef ref, String offerId) async {
  final r = await showModalBottomSheet<({String reason, String? note})>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => const EndRouteSheet());
  if (r == null || !context.mounted) return;
  await runStopAction(context, ref, offerId, () async { await ref.read(apiProvider).endRoute(offerId, r.reason, note: r.note); }, success: 'ms.end_route_ok', verify: (f) => !f.can('end_route'));
}

class EndRouteSheet extends StatefulWidget {
  const EndRouteSheet({super.key});
  @override
  State<EndRouteSheet> createState() => _EndRouteSheetState();
}

class _EndRouteSheetState extends State<EndRouteSheet> {
  final _reason = TextEditingController(), _note = TextEditingController();
  @override
  void dispose() { _reason.dispose(); _note.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SafeArea(child: SingleChildScrollView(child: Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(t('ms.end_route_title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        Banner2(tone: Tone.warn, text: t('ms.end_route_warn')),
        const SizedBox(height: 12),
        TextField(key: const Key('end-reason'), controller: _reason, onChanged: (_) => setState(() {}), maxLines: 2, decoration: InputDecoration(labelText: t('ms.end_route_reason'))),
        const SizedBox(height: 10),
        TextField(key: const Key('end-note'), controller: _note, maxLines: 2, decoration: InputDecoration(labelText: t('ms.end_route_note'))),
        const SizedBox(height: 16),
        FilledButton(key: const Key('end-submit'), style: FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: _reason.text.trim().length >= 3 ? () => Navigator.pop(context, (reason: _reason.text.trim(), note: _note.text.trim().isEmpty ? null : _note.text.trim())) : null, child: Text(t('ms.end_route'))),
      ]),
    )));
  }
}
