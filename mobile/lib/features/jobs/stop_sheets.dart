import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import '../../widgets/evidence_photo.dart';
import 'stop_runner.dart';

/// "Can't deliver": every reason is selectable at any time (no arrival, wait or note gating) unless the platform runs strict rules
/// (`policy.failStrict`; an old server without `policy` is treated as strict). An optional photo can be attached to any reason.
/// The sheet does the whole action — upload, send, retry — so a failure keeps what the driver entered. Pops `true` once the stop is marked.
class FailSheet extends ConsumerStatefulWidget {
  const FailSheet({super.key, required this.job, required this.stop});
  final Job job;
  final Stop stop;
  @override
  ConsumerState<FailSheet> createState() => _FailSheetState();
}

class _FailSheetState extends ConsumerState<FailSheet> {
  String? _reason, _error, _photoError, _mediaId, _mediaPath;
  final _note = TextEditingController();
  PickedPhoto? _photo;
  bool _busy = false;
  double? _progress;
  late final DateTime? _waitDeadline = widget.stop.waitRemainingSec == null || !widget.job.showsStopWait ? null : DateTime.now().add(Duration(seconds: widget.stop.waitRemainingSec!));

  bool get _strict => widget.job.failStrict;
  Stop get _s => widget.stop;

  @override
  void dispose() { _note.dispose(); super.dispose(); }

  bool _available(FailReason r, int waitLeft) {
    if (!_strict) return true;
    if (r.needsArrival && !_s.arrived) return false;
    if (r.key == 'unreachable' && waitLeft > 0) return false;
    return true;
  }

  Future<void> _submit() async {
    final reason = _reason;
    if (reason == null || _busy) return;
    final sure = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
      title: Text(d.tr('ms.fail_confirm_title')), content: Text('${d.tr('stopfail.$reason')}\n\n${d.tr('ms.fail_confirm_body')}'),
      actions: [TextButton(key: const Key('fail-cancel'), style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))), FilledButton(key: const Key('fail-confirm'), style: FilledButton.styleFrom(minimumSize: const Size(120, 48), backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('ms.fail_confirm')))],
    ));
    if (sure != true || !mounted) return;
    setState(() { _busy = true; _error = null; _photoError = null; });
    final note = _note.text.trim().isEmpty ? null : _note.text.trim();
    final stopId = _s.id, offerId = widget.job.offerId;
    final where = await stopWhere(ref.read(locationServiceProvider));
    if (!mounted) return;
    final ok = await runStopAction(context, ref, offerId, () async {
      final api = ref.read(apiProvider);
      String? mediaId;
      final photo = _photo;
      if (photo != null) {
        if (_mediaId != null && _mediaPath == photo.path) {
          mediaId = _mediaId; // already uploaded: a retry after a failed send needs no second upload
        } else {
          if (mounted) setState(() => _progress = 0);
          final up = await api.uploadStopMedia(offerId, stopId, kind: 'fail', path: photo.path, filename: photo.name, onProgress: (p) { if (mounted) setState(() => _progress = p); });
          mediaId = up['id'] is String ? up['id'] as String : null;
          _mediaId = mediaId; _mediaPath = photo.path;
        }
      }
      await api.failStop(offerId, stopId, reason, note: note, mediaId: mediaId, lat: where.lat, lng: where.lng);
    },
        success: 'ms.failed_ok',
        verify: (f) { final x = stopIn(f, stopId); return x != null && x.resolved && x.status != 'delivered'; },
        handle: (e) { if (!(e is ApiException && e.isTransient)) { _mediaId = null; _mediaPath = null; } return false; },
        onError: (m) { if (mounted) setState(() => _error = m); });
    if (!mounted) return;
    if (ok) { Navigator.pop(context, true); return; }
    setState(() { _busy = false; _progress = null; });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    Widget body(int waitLeft) {
      final sel = failReasons.where((r) => r.key == _reason).firstOrNull;
      final selOk = sel != null && _available(sel, waitLeft);
      final noteRequired = _strict && sel != null && sel.needsNote;
      final noteOk = !noteRequired || _note.text.trim().length >= 3;
      return SafeArea(child: SingleChildScrollView(child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(t('ms.fail_title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final r in failReasons) Builder(builder: (_) {
            final ok = _available(r, waitLeft);
            final sub = !ok ? (r.needsArrival && !_s.arrived ? t('ms.fail_need_arrival') : t('ms.unreachable_wait', {'time': fmtCountdown(waitLeft)})) : null;
            return ListTile(
              key: Key('fail-${r.key}'), enabled: ok && !_busy, selected: _reason == r.key, selectedColor: JR.accent, contentPadding: EdgeInsets.zero, minVerticalPadding: 12,
              leading: Icon(_reason == r.key ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: ok ? JR.accent : JR.muted),
              title: Text(t.val('stopfail', r.key)), subtitle: sub == null ? null : Text(sub, style: const TextStyle(fontSize: 12)),
              onTap: ok && !_busy ? () { haptic(HapticKind.select); setState(() => _reason = r.key); } : null,
            );
          }),
          if (sel != null) ...[
            const SizedBox(height: 4),
            TextField(key: const Key('fail-note'), controller: _note, enabled: !_busy, onChanged: (_) => setState(() {}), maxLines: 2, decoration: InputDecoration(labelText: noteRequired ? t('ms.fail_note_required') : t('ms.fail_note'))),
            const SizedBox(height: 12),
            EvidencePhotoField(keyPrefix: 'fail-photo', photo: _photo, enabled: !_busy, error: _photoError, onChanged: (p) => setState(() { _photo = p; _photoError = null; })),
          ],
          if (_busy && _progress != null) Padding(padding: const EdgeInsets.only(top: 10), child: LinearProgressIndicator(key: const Key('fail-upload-progress'), value: _progress == 0 ? null : _progress, minHeight: 6, color: JR.accent, backgroundColor: JR.line, semanticsLabel: t('um.uploading'))),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Banner2(key: const Key('fail-error'), tone: Tone.danger, text: _error!)),
          const SizedBox(height: 14),
          FilledButton.icon(key: const Key('fail-submit'), style: FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: selOk && noteOk && !_busy ? _submit : null, icon: busyIcon(_busy, Icons.report_gmailerrorred, color: JR.bg), label: Text(t('ms.cant_deliver'))),
        ]),
      )));
    }
    final d = _waitDeadline;
    if (!_strict || d == null) return body(0);
    return DeadlineBuilder(deadline: d, builder: (context, waitLeft) => body(waitLeft));
  }
}

/// Postpone ("reschedule") a stop: the platform may require a written reason and/or a photo as evidence (`policy.rescheduleEvidenceText/Photo`; the
/// server's `EVIDENCE_REQUIRED` can add to that). Both are stored and shown to the warehouse. Pops `true` once the stop was postponed.
class PostponeSheet extends ConsumerStatefulWidget {
  const PostponeSheet({super.key, required this.job, required this.stop});
  final Job job;
  final Stop stop;
  @override
  ConsumerState<PostponeSheet> createState() => _PostponeSheetState();
}

class _PostponeSheetState extends ConsumerState<PostponeSheet> {
  final _note = TextEditingController();
  PickedPhoto? _photo;
  String? _error, _mediaId, _mediaPath;
  bool _busy = false, _serverNote = false, _serverPhoto = false;
  double? _progress;

  bool get _needNote => (widget.job.policy?.rescheduleEvidenceText ?? false) || _serverNote;
  bool get _needPhoto => (widget.job.policy?.rescheduleEvidencePhoto ?? false) || _serverPhoto;
  bool get _noteOk => !_needNote || _note.text.trim().length >= 3;
  bool get _photoOk => !_needPhoto || _photo != null;

  @override
  void dispose() { _note.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_busy || !_noteOk || !_photoOk) return;
    setState(() { _busy = true; _error = null; });
    final note = _note.text.trim().isEmpty ? null : _note.text.trim();
    final stopId = widget.stop.id, offerId = widget.job.offerId, defersBefore = widget.stop.deferCount, routing = widget.job.routingEnabled;
    final ok = await runStopAction(context, ref, offerId, () async {
      final api = ref.read(apiProvider);
      String? mediaId;
      final photo = _photo;
      if (photo != null) {
        if (_mediaId != null && _mediaPath == photo.path) {
          mediaId = _mediaId;
        } else {
          if (mounted) setState(() => _progress = 0);
          final up = await api.uploadStopMedia(offerId, stopId, kind: 'defer', path: photo.path, filename: photo.name, onProgress: (p) { if (mounted) setState(() => _progress = p); });
          mediaId = up['id'] is String ? up['id'] as String : null;
          _mediaId = mediaId; _mediaPath = photo.path;
        }
      }
      await api.deferStop(offerId, stopId, note: note, mediaId: mediaId);
    },
        success: 'ms.postponed_ok',
        verify: (f) { final x = stopIn(f, stopId); return x != null && (x.deferCount > defersBefore || (routing && !x.current)); }, // routing off: any stop can be postponed and may stay first, only the counter tells
        handle: (e) {
          if (!(e is ApiException && e.isTransient)) { _mediaId = null; _mediaPath = null; }
          if (e is ApiException && e.code == 'EVIDENCE_REQUIRED' && mounted) {
            // The platform wants more than this app knew about: mark the missing parts as required and say which.
            setState(() { _serverNote = _serverNote || e.details['note'] == true; _serverPhoto = _serverPhoto || e.details['photo'] == true; _error = stopErrMessage(context, e); });
            return true;
          }
          return false;
        },
        onError: (m) { if (mounted) setState(() => _error = m); });
    if (!mounted) return;
    if (ok) { Navigator.pop(context, true); return; }
    setState(() { _busy = false; _progress = null; });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final missing = !_noteOk ? t('fma.missing_reason') : !_photoOk ? t('fma.missing_evidence_photo') : null;
    return SafeArea(child: SingleChildScrollView(child: Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(t('ms.postpone'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(t('ms.postpone_hint'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.4)),
        if (_needNote || _needPhoto) ...[const SizedBox(height: 10), Banner2(key: const Key('postpone-evidence-note'), text: t('fma.postpone_evidence_note'))],
        const SizedBox(height: 12),
        TextField(key: const Key('postpone-note'), controller: _note, enabled: !_busy, onChanged: (_) => setState(() {}), maxLines: 3, decoration: InputDecoration(labelText: t(_needNote ? 'fma.postpone_reason_required' : 'fma.postpone_reason_optional'))),
        const SizedBox(height: 12),
        EvidencePhotoField(keyPrefix: 'postpone-photo', photo: _photo, required: _needPhoto, enabled: !_busy, onChanged: (p) => setState(() => _photo = p)),
        if (_busy && _progress != null) Padding(padding: const EdgeInsets.only(top: 10), child: LinearProgressIndicator(key: const Key('postpone-upload-progress'), value: _progress == 0 ? null : _progress, minHeight: 6, color: JR.accent, backgroundColor: JR.line, semanticsLabel: t('um.uploading'))),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Banner2(key: const Key('postpone-error'), tone: Tone.danger, text: _error!)),
        const SizedBox(height: 14),
        FilledButton.icon(key: const Key('postpone-submit'), onPressed: _busy || !_noteOk || !_photoOk ? null : _submit, icon: busyIcon(_busy, Icons.schedule), label: Text(t('ms.postpone'))),
        if (missing != null && !_busy) Padding(padding: const EdgeInsets.only(top: 8), child: Text(missing, key: const Key('postpone-hint'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
      ]),
    )));
  }
}
