import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart' show listOf, mapOf;
import '../../core/theme.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

final documentsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).documents());

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});
  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String? _uploading;
  double? _progress;
  bool _cameraDenied = false;

  Future<void> _upload(String type) async {
    if (_uploading != null) return;
    final src = await showModalBottomSheet<ImageSource>(context: context, useRootNavigator: true, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(16), child: Text(c.tr('m.pick_source'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
      ListTile(minVerticalPadding: 14, leading: Icon(Icons.photo_camera_outlined, color: JR.accent), title: Text(c.tr('m.camera')), onTap: () => Navigator.pop(c, ImageSource.camera)),
      ListTile(minVerticalPadding: 14, leading: Icon(Icons.photo_library_outlined, color: JR.accent), title: Text(c.tr('m.gallery')), onTap: () => Navigator.pop(c, ImageSource.gallery)),
    ])));
    if (src == null) return;
    PickedPhoto? f;
    try {
      f = await pickPhoto(src);
    } on PhotoException catch (e) {
      // Camera/photo permission refused (or the picker failed): say so and, if it is a permission, point to Settings.
      if (mounted) { setState(() => _cameraDenied = e.denied); if (!e.denied) toast(context, context.tr('um.camera_failed'), error: true); }
      return;
    }
    if (f == null || !mounted) return;
    final picked = f;
    setState(() { _uploading = type; _progress = 0; _cameraDenied = false; });
    final ok = await guarded(context, () => ref.read(apiProvider).uploadDocument(type, picked.path, picked.name, onProgress: (p) { if (mounted) setState(() => _progress = p); }), success: 'docs.uploaded', maybeApplied: true);
    ref.invalidate(documentsProvider); // also after a lost answer: the list shows whether the document arrived
    if (ok != null) ref.invalidate(overviewProvider);
    if (mounted) setState(() { _uploading = null; _progress = null; });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final cat = ref.watch(catalogProvider).value;
    final docs = ref.watch(documentsProvider);
    final types = listOf(mapOf(cat?['documents'])?['driver']).whereType<Map>().toList();
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.documents'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(documentsProvider); await ref.read(documentsProvider.future); }, child: AsyncBody(value: docs, onRetry: () => ref.invalidate(documentsProvider), builder: (d) => ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
        Text(t('docs.sub'), style: TextStyle(color: JR.muted, height: 1.4)),
        const SizedBox(height: 14),
        if (cat == null) ...[
          // The list of document types comes from the server; without it there is nothing to upload against.
          if (ref.watch(catalogProvider).hasError) Padding(padding: const EdgeInsets.only(bottom: 14), child: Banner2(tone: Tone.warn, text: t('um.catalog_failed'), action: OutlinedButton.icon(onPressed: () => ref.invalidate(catalogProvider), icon: const Icon(Icons.refresh), label: Text(t('common.retry')))))
          else Padding(padding: EdgeInsets.only(bottom: 14), child: LinearProgressIndicator(color: JR.accent, backgroundColor: JR.line)),
        ],
        if (_cameraDenied) Padding(padding: const EdgeInsets.only(bottom: 14), child: Banner2(key: const Key('camera-denied'), tone: Tone.warn, text: t('um.camera_denied'), action: OutlinedButton.icon(onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings'))))),
        for (final ty in types) Builder(builder: (_) {
          final mine = d.where((x) => x['type'] == ty['key']).toList();
          final latest = mine.isEmpty ? null : mine.first;
          return Padding(padding: const EdgeInsets.only(bottom: 12), child: SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(t.val('doc', ty['key']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))), Pill(ty['required'] == true ? t('docs.required') : t('docs.optional'), tone: ty['required'] == true ? Tone.warn : Tone.neutral)]),
            const SizedBox(height: 10),
            if (latest == null) Text(t('docs.none'), style: TextStyle(color: JR.muted)) else Row(children: [
              Pill(t.val('docstatus', latest['status']), tone: switch (latest['status']) { 'approved' => Tone.success, 'rejected' => Tone.danger, _ => Tone.warn }),
              if (latest['expiresOn'] != null) ...[const SizedBox(width: 10), Text('${t('docs.expires')}: ${latest['expiresOn']}', textDirection: TextDirection.ltr, style: TextStyle(color: JR.muted, fontSize: 12))],
            ]),
            if (latest?['reviewNote'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${latest!['reviewNote']}', style: TextStyle(color: JR.gold, fontSize: 13))),
            const SizedBox(height: 12),
            if (_uploading == ty['key']) Padding(padding: const EdgeInsets.only(bottom: 10), child: LinearProgressIndicator(value: _progress == null || _progress == 0 ? null : _progress, minHeight: 6, color: JR.accent, backgroundColor: JR.line, semanticsLabel: t('um.uploading'))),
            OutlinedButton.icon(onPressed: _uploading != null ? null : () => _upload('${ty['key']}'), icon: _uploading == ty['key'] ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accent)) : const Icon(Icons.upload_file), label: Text(_uploading == ty['key'] ? t('um.uploading') : latest == null ? t('docs.upload') : t('docs.replace'))),
          ])));
        }),
      ]))),
    );
  }
}
