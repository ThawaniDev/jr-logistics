import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

final documentsProvider = FutureProvider.autoDispose((ref) => ref.watch(apiProvider).documents());

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});
  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String? _uploading;

  Future<void> _upload(String type) async {
    final src = await showModalBottomSheet<ImageSource>(context: context, useRootNavigator: true, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Padding(padding: const EdgeInsets.all(16), child: Text(c.tr('m.pick_source'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
      ListTile(leading: const Icon(Icons.photo_camera_outlined, color: JR.accent), title: Text(c.tr('m.camera')), onTap: () => Navigator.pop(c, ImageSource.camera)),
      ListTile(leading: const Icon(Icons.photo_library_outlined, color: JR.accent), title: Text(c.tr('m.gallery')), onTap: () => Navigator.pop(c, ImageSource.gallery)),
    ])));
    if (src == null) return;
    final f = await ImagePicker().pickImage(source: src, maxWidth: 2000, imageQuality: 85);
    if (f == null || !mounted) return;
    setState(() => _uploading = type);
    final ok = await guarded(context, () => ref.read(apiProvider).uploadDocument(type, f.path, f.name), success: 'docs.uploaded');
    if (ok != null) { ref.invalidate(documentsProvider); ref.invalidate(overviewProvider); }
    if (mounted) setState(() => _uploading = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final cat = ref.watch(catalogProvider).value;
    final docs = ref.watch(documentsProvider);
    final types = (((cat?['documents'] as Map?)?['driver']) as List?)?.cast<Map>() ?? const [];
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.documents'))),
      body: RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(documentsProvider); await ref.read(documentsProvider.future); }, child: AsyncBody(value: docs, onRetry: () => ref.invalidate(documentsProvider), builder: (d) => ListView(padding: const EdgeInsets.all(16), children: [
        Text(t('docs.sub'), style: const TextStyle(color: JR.muted, height: 1.4)),
        const SizedBox(height: 14),
        for (final ty in types) Builder(builder: (_) {
          final mine = d.where((x) => x['type'] == ty['key']).toList();
          final latest = mine.isEmpty ? null : mine.first;
          return Padding(padding: const EdgeInsets.only(bottom: 12), child: SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(t('doc.${ty['key']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))), Pill(ty['required'] == true ? t('docs.required') : t('docs.optional'), tone: ty['required'] == true ? Tone.warn : Tone.neutral)]),
            const SizedBox(height: 10),
            if (latest == null) Text(t('docs.none'), style: const TextStyle(color: JR.muted)) else Row(children: [
              Pill(t('docstatus.${latest['status']}'), tone: switch (latest['status']) { 'approved' => Tone.success, 'rejected' => Tone.danger, _ => Tone.warn }),
              if (latest['expiresOn'] != null) ...[const SizedBox(width: 10), Text('${t('docs.expires')}: ${latest['expiresOn']}', style: const TextStyle(color: JR.muted, fontSize: 12))],
            ]),
            if (latest?['reviewNote'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${latest!['reviewNote']}', style: const TextStyle(color: JR.gold, fontSize: 13))),
            const SizedBox(height: 12),
            OutlinedButton.icon(onPressed: _uploading != null ? null : () => _upload(ty['key'] as String), icon: _uploading == ty['key'] ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accent)) : const Icon(Icons.upload_file), label: Text(latest == null ? t('docs.upload') : t('docs.replace'))),
          ])));
        }),
      ]))),
    );
  }
}
