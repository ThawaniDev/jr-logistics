import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../services.dart';
import 'common.dart';

/// Camera / gallery for the evidence photos of a postponed or failed stop (E7, E14). Pictures are shrunk on the device (longest side ≤ 1600 px,
/// JPEG quality ~80) so a photo on a weak signal is a few hundred KB, not several MB. Abstracted so widget tests never open a camera or gallery.
abstract class EvidencePhotos {
  /// null = the driver cancelled; throws [PhotoException] when the camera/gallery cannot be used ([PhotoException.denied] = permission refused).
  Future<PickedPhoto?> pick(ImageSource source);
}

const evidenceMaxSide = 1600.0;
const evidenceQuality = 80;

class DeviceEvidencePhotos implements EvidencePhotos {
  @override
  Future<PickedPhoto?> pick(ImageSource source) async {
    try {
      final f = await ImagePicker().pickImage(source: source, maxWidth: evidenceMaxSide, maxHeight: evidenceMaxSide, imageQuality: evidenceQuality);
      return f == null ? null : (path: f.path, name: f.name);
    } on PlatformException catch (e) {
      throw PhotoException(denied: e.code.contains('access_denied') || e.code.contains('permission'));
    } catch (_) {
      throw PhotoException(denied: false);
    }
  }
}

final evidencePhotosProvider = Provider<EvidencePhotos>((_) => DeviceEvidencePhotos());

/// "Photo" block of the evidence forms: preview, take photo, choose from gallery, remove. The photo is only held here — the caller uploads it with the action.
/// Keys: `<keyPrefix>-camera`, `<keyPrefix>-gallery`, `<keyPrefix>-remove`, `<keyPrefix>-preview`, `<keyPrefix>-denied`.
class EvidencePhotoField extends ConsumerStatefulWidget {
  const EvidencePhotoField({super.key, required this.photo, required this.onChanged, this.enabled = true, this.required = false, this.keyPrefix = 'evidence', this.error});
  final PickedPhoto? photo;
  final ValueChanged<PickedPhoto?> onChanged;
  final bool enabled, required;
  final String keyPrefix;
  /// A problem with the photo (e.g. the upload failed): shown under the preview.
  final String? error;
  @override
  ConsumerState<EvidencePhotoField> createState() => _EvidencePhotoFieldState();
}

class _EvidencePhotoFieldState extends ConsumerState<EvidencePhotoField> {
  bool _denied = false;

  Future<void> _pick(ImageSource source) async {
    if (!widget.enabled) return;
    try {
      final p = await ref.read(evidencePhotosProvider).pick(source);
      if (p == null || !mounted) return;
      setState(() => _denied = false);
      widget.onChanged(p);
    } on PhotoException catch (e) {
      if (!mounted) return;
      setState(() => _denied = e.denied);
      if (!e.denied) toast(context, context.tr('um.camera_failed'), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final k = widget.keyPrefix;
    final photo = widget.photo;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t(widget.required ? 'fma.photo_required' : 'fma.photo_optional'), style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      if (photo != null) ...[
        Stack(children: [
          ClipRRect(borderRadius: BorderRadius.circular(12), child: SizedBox(height: 160, width: double.infinity, child: Image.file(File(photo.path), key: Key('$k-preview'), fit: BoxFit.cover, cacheWidth: 900, errorBuilder: (_, _, _) => Container(color: JR.bg2, alignment: Alignment.center, child: Icon(Icons.image_outlined, size: 48, color: JR.muted))))),
          PositionedDirectional(top: 6, end: 6, child: IconButton.filled(key: Key('$k-remove'), tooltip: t('fma.photo_remove'), style: IconButton.styleFrom(backgroundColor: JR.bg.withValues(alpha: 0.8), foregroundColor: JR.text, minimumSize: const Size(44, 44)), onPressed: widget.enabled ? () => widget.onChanged(null) : null, icon: const Icon(Icons.close))),
        ]),
        const SizedBox(height: 8),
      ],
      if (widget.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Banner2(key: Key('$k-error'), tone: Tone.danger, text: widget.error!)),
      if (_denied) Padding(padding: const EdgeInsets.only(bottom: 8), child: Banner2(
        key: Key('$k-denied'), tone: Tone.warn, text: t('um.camera_denied'),
        action: OutlinedButton.icon(onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings'))),
      )),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: OutlinedButton.icon(key: Key('$k-camera'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 8)), onPressed: widget.enabled ? () => _pick(ImageSource.camera) : null, icon: const Icon(Icons.photo_camera_outlined), label: Text(t(photo == null ? 'ms.take_photo' : 'ms.retake_photo'), textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis))),
        const SizedBox(width: 8),
        Expanded(child: OutlinedButton.icon(key: Key('$k-gallery'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 8)), onPressed: widget.enabled ? () => _pick(ImageSource.gallery) : null, icon: const Icon(Icons.photo_library_outlined), label: Text(t('fma.photo_gallery'), textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis))),
      ]),
    ]);
  }
}
