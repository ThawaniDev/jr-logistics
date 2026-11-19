import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;
import 'package:path_provider/path_provider.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../providers_extra.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// Picks a photo from the camera or the gallery. Tests substitute a fake (no real camera / gallery in widget tests).
abstract class AttachmentPicker {
  Future<PickedPhoto?> pick(ImageSource source);
}

class DeviceAttachmentPicker implements AttachmentPicker {
  @override
  Future<PickedPhoto?> pick(ImageSource source) => pickPhoto(source);
}

final attachmentPickerProvider = Provider<AttachmentPicker>((_) => DeviceAttachmentPicker());

/// One photo of a draft ticket / reply: picked, then uploaded straight away (`POST /uploads/ticket`) so the send button only waits for the slow part once.
class AttachmentItem {
  AttachmentItem({required this.name, required this.path});
  final String name, path;
  double progress = 0;
  /// The server id once uploaded — this is what goes into `attachmentIds`.
  String? id;
  Object? error;
  bool get uploading => id == null && error == null;
}

/// State of the attachments of ONE draft (up to [max] photos). The screen owns it and reads [ids] when it sends.
class AttachmentsController extends ChangeNotifier {
  AttachmentsController({this.max = 3});
  final int max;
  final items = <AttachmentItem>[];
  bool get canAdd => items.length < max;
  bool get uploading => items.any((i) => i.uploading);
  bool get hasFailed => items.any((i) => i.error != null);
  List<String> get ids => [for (final i in items) if (i.id != null) i.id!];
  void changed() => notifyListeners();
  void add(AttachmentItem i) { items.add(i); notifyListeners(); }
  void remove(AttachmentItem i) { items.remove(i); notifyListeners(); }
  void clear() { items.clear(); notifyListeners(); }
}

/// The "add photos" row: thumbnails with a remove button (and retry when an upload failed), and an "Add photo" button until the limit is reached.
class AttachmentsEditor extends ConsumerStatefulWidget {
  const AttachmentsEditor({super.key, required this.controller, this.compact = false});
  final AttachmentsController controller;
  /// Just the icon button (reply bar), without the caption text.
  final bool compact;
  @override
  ConsumerState<AttachmentsEditor> createState() => _AttachmentsEditorState();
}

class _AttachmentsEditorState extends ConsumerState<AttachmentsEditor> {
  AttachmentsController get c => widget.controller;
  bool _picking = false;

  @override
  void initState() { super.initState(); c.addListener(_rebuild); }
  @override
  void didUpdateWidget(AttachmentsEditor old) { super.didUpdateWidget(old); if (old.controller != c) { old.controller.removeListener(_rebuild); c.addListener(_rebuild); } }
  @override
  void dispose() { c.removeListener(_rebuild); super.dispose(); }
  void _rebuild() { if (mounted) setState(() {}); }

  Future<void> _add() async {
    if (_picking || !c.canAdd) return;
    _picking = true;
    try {
      final src = await showModalBottomSheet<ImageSource>(context: context, useRootNavigator: true, builder: (b) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.all(16), child: Text(b.tr('m.pick_source'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
        ListTile(key: const Key('att-source-camera'), minVerticalPadding: 14, leading: const Icon(Icons.photo_camera_outlined, color: JR.accent), title: Text(b.tr('m.camera')), onTap: () => Navigator.pop(b, ImageSource.camera)),
        ListTile(key: const Key('att-source-gallery'), minVerticalPadding: 14, leading: const Icon(Icons.photo_library_outlined, color: JR.accent), title: Text(b.tr('m.gallery')), onTap: () => Navigator.pop(b, ImageSource.gallery)),
      ])));
      if (src == null || !mounted) return;
      PickedPhoto? f;
      try {
        f = await ref.read(attachmentPickerProvider).pick(src);
      } on PhotoException catch (e) {
        if (mounted) toast(context, context.tr(e.denied ? 'um.camera_denied' : 'um.camera_failed'), error: true);
        return;
      }
      if (f == null || !mounted || !c.canAdd) return;
      final item = AttachmentItem(name: f.name, path: f.path);
      c.add(item);
      await _upload(item);
    } finally {
      _picking = false;
    }
  }

  Future<void> _upload(AttachmentItem item) async {
    item..error = null..progress = 0..id = null;
    c.changed();
    try {
      final up = await ref.read(extraApiProvider).uploadTicketFile(item.path, item.name, onProgress: (p) { item.progress = p; c.changed(); });
      item.id = up.id;
    } catch (e) {
      item.error = e;
      if (mounted) toast(context, errMessage(context, e), error: true);
    }
    c.changed();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final add = Semantics(button: true, label: t('fmb.att_add'), child: OutlinedButton.icon(
      key: const Key('att-add'), onPressed: c.canAdd ? _add : null, style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
      icon: const Icon(Icons.add_a_photo_outlined), label: Text(widget.compact ? '${c.items.length}/${c.max}' : t('fmb.att_add_n', {'n': c.items.length, 'max': c.max})),
    ));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (c.items.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Wrap(spacing: 8, runSpacing: 8, children: [for (final i in c.items) _Draft(item: i, onRemove: () => c.remove(i), onRetry: () => _upload(i))])),
      add,
    ]);
  }
}

class _Draft extends StatelessWidget {
  const _Draft({required this.item, required this.onRemove, required this.onRetry});
  final AttachmentItem item;
  final VoidCallback onRemove, onRetry;
  @override
  Widget build(BuildContext context) {
    final failed = item.error != null;
    return SizedBox(key: Key('att-draft-${item.name}'), width: 76, height: 76, child: Stack(clipBehavior: Clip.none, children: [
      Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(10), child: Container(
        decoration: BoxDecoration(color: JR.bg2, border: Border.all(color: failed ? JR.danger : JR.line), borderRadius: BorderRadius.circular(10)),
        child: Stack(fit: StackFit.expand, children: [
          Image.file(File(item.path), fit: BoxFit.cover, errorBuilder: (_, _, _) => const Center(child: Icon(Icons.image_outlined, color: JR.muted))),
          if (item.uploading) ColoredBox(color: Colors.black54, child: Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 3, color: JR.accent, value: item.progress > 0 && item.progress < 1 ? item.progress : null)))),
          if (failed) ColoredBox(color: Colors.black54, child: Center(child: IconButton(key: Key('att-retry-${item.name}'), tooltip: context.tr('common.retry'), onPressed: onRetry, icon: const Icon(Icons.refresh, color: JR.danger)))),
        ]),
      ))),
      PositionedDirectional(top: -8, end: -8, child: Material(color: JR.bg, shape: const CircleBorder(side: BorderSide(color: JR.line)), child: InkWell(
        key: Key('att-remove-${item.name}'), customBorder: const CircleBorder(), onTap: onRemove,
        child: Padding(padding: const EdgeInsets.all(5), child: Icon(Icons.close, size: 16, color: JR.text, semanticLabel: context.tr('common.cancel'))),
      ))),
    ]));
  }
}

/// A received attachment: image thumbnail (fetched with the auth header) that opens full screen, or a file chip for a PDF.
class AttachmentThumb extends ConsumerWidget {
  const AttachmentThumb({super.key, required this.attachment});
  final TicketAttachment attachment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = attachment;
    final t = context.tr;
    if (!a.isImage) {
      return Material(key: Key('att-file-${a.id}'), color: JR.bg2, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: JR.line)), child: InkWell(
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)), onTap: () => _openFile(context, ref),
        child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 48, maxWidth: 220), child: Padding(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(a.isPdf ? Icons.picture_as_pdf_outlined : Icons.attach_file, color: JR.cyan, size: 20), const SizedBox(width: 8),
          Flexible(child: Text(a.name.isEmpty ? t('fmb.att_file') : a.name, maxLines: 1, overflow: TextOverflow.ellipsis, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 13))),
        ]))),
      ));
    }
    final bytes = ref.watch(attachmentBytesProvider(a.id));
    return SizedBox(key: Key('att-${a.id}'), width: 84, height: 84, child: ClipRRect(borderRadius: BorderRadius.circular(10), child: bytes.when(
      data: (b) => InkWell(onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => AttachmentViewer(name: a.name, bytes: b))), child: Image.memory(b, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Center(child: Icon(Icons.broken_image_outlined, color: JR.muted)))),
      loading: () => const ColoredBox(color: JR.bg2, child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accent)))),
      error: (_, _) => InkWell(key: Key('att-reload-${a.id}'), onTap: () => ref.invalidate(attachmentBytesProvider(a.id)), child: const ColoredBox(color: JR.bg2, child: Center(child: Icon(Icons.refresh, color: JR.muted)))),
    )));
  }

  /// Non-image files are saved to the temporary folder and handed to the system viewer.
  Future<void> _openFile(BuildContext context, WidgetRef ref) async {
    final t = context.tr;
    try {
      final bytes = await ref.read(attachmentBytesProvider(attachment.id).future);
      final dir = await getTemporaryDirectory();
      final safe = attachment.name.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
      final f = File('${dir.path}/${attachment.id}_${safe.isEmpty ? 'file' : safe}');
      await f.writeAsBytes(bytes, flush: true);
      final ok = await ref.read(linkOpenerProvider).open(Uri.file(f.path));
      if (!ok && context.mounted) toast(context, t('fmb.att_cannot_open'), error: true);
    } catch (e) {
      if (context.mounted) toast(context, errMessage(context, e), error: true);
    }
  }
}

class AttachmentViewer extends StatelessWidget {
  const AttachmentViewer({super.key, required this.name, required this.bytes});
  final String name;
  final Uint8List bytes;
  @override
  Widget build(BuildContext context) => Scaffold(
        key: const Key('att-viewer'), backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, title: Text(name, textDirection: TextDirection.ltr, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15))),
        body: Center(child: InteractiveViewer(minScale: 0.8, maxScale: 5, child: Image.memory(bytes, fit: BoxFit.contain, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, color: JR.muted, size: 48)))),
      );
}
