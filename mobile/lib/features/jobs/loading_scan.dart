import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../widgets/barcode_scanner.dart';
import '../../widgets/common.dart';
import 'stop_runner.dart';

/// Loading by scanning (E3/E4): after the warehouse confirmed the driver's arrival the driver scans each parcel onto the vehicle — with the camera
/// (continuous: it stays open and beeps for every parcel) or by typing a parcel code / order reference / manifest number — sees the checklist fill up,
/// can undo a mistaken scan, and taps "Finish loading". Parcels that were not scanned go back to the warehouse pool; the route is planned and the
/// driver reviews it next. Shown for `loading.mode == driver_scan` while the route is not approved; the old warehouse hand-over UI stays for `warehouse` mode.
class LoadingScanPanel extends ConsumerStatefulWidget {
  const LoadingScanPanel({super.key, required this.job});
  final Job job;
  @override
  ConsumerState<LoadingScanPanel> createState() => _LoadingScanPanelState();
}

class _LoadingScanPanelState extends ConsumerState<LoadingScanPanel> {
  static const _limit = 40; // rows shown per list before "Show all" (a route may hold up to 2000 parcels)
  final _manual = TextEditingController();
  final _focus = FocusNode(); // the field is disabled while a scan is in flight (which drops focus): give it back so the next parcel can be typed / wedge-scanned straight away
  /// stop id → scanned? Mirrors the driver's own scans/undos so the checklist answers instantly, without waiting for the next job refresh.
  final _overlay = <String, bool>{};
  ({bool ok, bool warning, String text, String? code})? _last;
  bool _busy = false, _showAllPending = false, _showAllScanned = false;
  int? _scannedNow, _assignedNow; // last numbers the server sent, used when the stops list is not available

  Job get j => widget.job;

  @override
  void dispose() { _manual.dispose(); _focus.dispose(); super.dispose(); }

  @override
  void didUpdateWidget(LoadingScanPanel old) {
    super.didUpdateWidget(old);
    // Entries the server now agrees with are no longer needed; the ones it still disagrees with are my newer actions (a refresh may be older than them).
    _overlay.removeWhere((id, v) { final s = stopIn(j, id); return s == null || s.scanned == v; });
  }

  bool _isScanned(Stop s) => _overlay[s.id] ?? s.scanned;
  List<Stop> get _stops => j.stops;
  int get _assigned => _stops.isNotEmpty ? _stops.length : (_assignedNow ?? j.loading.assigned);
  int get _scanned => _stops.isNotEmpty ? _stops.where(_isScanned).length : (_scannedNow ?? j.loading.scanned);
  /// At least one parcel is scanned (the server lists `finish_loading` once that is so; our own scans count at once, before the next refresh).
  bool get _canFinish => _scanned >= 1 || j.can('finish_loading');

  String _scanError(Object e) {
    if (e is ApiException) {
      if (e.code == 'VALIDATION' && e.details['field'] == 'code') return context.tr('fma.scan_unknown');
      if (e.code == 'DETAILS_INCOMPLETE') return context.tr('fma.scan_incomplete');
      if (e.code == 'INVALID_TRANSITION') return context.tr('fma.scan_not_now');
    }
    return stopErrMessage(context, e);
  }

  /// One scan — from the camera or the text field. Never throws: the answer is the feedback the driver sees (and, with the camera, hears/feels).
  Future<ScanVerdict> _scan(String raw) async {
    final code = normalizeScan(raw);
    if (code.isEmpty) return const ScanVerdict(false);
    try {
      final r = await ref.read(apiProvider).loadingScan(j.offerId, code);
      if (!mounted) return const ScanVerdict(true);
      final show = r.code.isNotEmpty ? r.code : code;
      late final ScanVerdict v;
      setState(() {
        if (r.shipmentId.isNotEmpty) _overlay[r.shipmentId] = true;
        _scannedNow = r.scanned ?? _scannedNow;
        _assignedNow = r.assigned ?? _assignedNow;
        final n = _scanned, total = _assigned;
        final text = r.already ? context.tr('fma.scan_already', {'code': show}) : context.tr('fma.scan_ok', {'code': show, 'n': n, 'total': total});
        v = ScanVerdict(!r.already, text, r.already);
        _last = (ok: !r.already, warning: r.already, text: text, code: r.shipmentId.isEmpty ? null : r.shipmentId);
      });
      return v;
    } catch (e) {
      final msg = mounted ? _scanError(e) : null;
      if (mounted) setState(() => _last = (ok: false, warning: false, text: msg ?? '', code: null));
      return ScanVerdict(false, msg);
    }
  }

  Future<void> _submitManual() async {
    final code = _manual.text;
    if (_busy || normalizeScan(code).isEmpty) return;
    setState(() => _busy = true);
    final v = await _scan(code);
    haptic(v.ok ? HapticKind.success : HapticKind.warning);
    if (!mounted) return;
    setState(() => _busy = false);
    if (v.ok) _manual.clear();
    ref.invalidate(jobProvider(j.offerId));
    // after the rebuild re-enables the field
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _focus.requestFocus(); });
  }

  Future<void> _camera() async {
    await scanBarcode(context, title: context.tr('fma.scan_loading_title'), continuous: true, onCode: _scan);
    if (mounted) ref.invalidate(jobProvider(j.offerId));
  }

  Future<void> _unscan(String code, String? stopId) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(apiProvider).loadingUnscan(j.offerId, code);
      if (!mounted) return;
      setState(() {
        if (stopId != null) _overlay[stopId] = false;
        _scannedNow = (r['scanned'] as num?)?.toInt() ?? _scannedNow;
        _assignedNow = (r['assigned'] as num?)?.toInt() ?? _assignedNow;
        _last = (ok: true, warning: true, text: context.tr('fma.scan_removed', {'code': code}), code: null);
      });
      haptic(HapticKind.select);
    } catch (e) {
      if (mounted) toast(context, _scanError(e), error: true);
    }
    if (mounted) { setState(() => _busy = false); ref.invalidate(jobProvider(j.offerId)); }
  }

  Future<void> _finish() async {
    final scanned = _scanned, left = _assigned - scanned;
    if (!_canFinish) { toast(context, context.tr('fma.finish_none'), error: true); return; }
    if (left > 0) {
      final sure = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
        title: Text(d.tr('fma.finish_confirm_title')), content: Text(d.tr('fma.finish_confirm_body', {'n': left, 'scanned': scanned})),
        actions: [
          TextButton(key: const Key('finish-loading-cancel'), style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('fma.keep_scanning'))),
          FilledButton(key: const Key('finish-loading-confirm'), style: FilledButton.styleFrom(minimumSize: const Size(120, 48)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('fma.finish_loading'))),
        ],
      ));
      if (sure != true || !mounted) return;
    }
    await runStopAction(context, ref, j.offerId, () async { await ref.read(apiProvider).loadingFinish(j.offerId); },
        success: 'fma.loading_finished_ok', verify: (f) => f.loading.finished || f.can('approve_route') || f.routeApproved);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final busy = ref.watch(stopBusyProvider).contains(j.offerId);
    final scanned = _scanned, total = _assigned;
    final pending = [for (final s in _stops) if (!_isScanned(s)) s];
    final done = [for (final s in _stops) if (_isScanned(s)) s];
    final last = _last;
    return SectionCard(key: const Key('loading-scan'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('fma.scan_loading_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      const SizedBox(height: 4),
      Text(t('fma.scan_loading_hint'), style: const TextStyle(color: JR.muted, height: 1.4)),
      const SizedBox(height: 14),
      Text(t('fma.scan_progress', {'n': scanned, 'total': total}), key: const Key('scan-progress-text'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
      const SizedBox(height: 8),
      ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(key: const Key('scan-progress-bar'), semanticsLabel: t('fma.scan_progress', {'n': scanned, 'total': total}), minHeight: 8, value: total == 0 ? 0 : (scanned / total).clamp(0.0, 1.0), color: JR.accent, backgroundColor: JR.line)),
      const SizedBox(height: 14),
      FilledButton.icon(key: const Key('scan-camera'), onPressed: busy ? null : _camera, icon: const Icon(Icons.qr_code_scanner), label: Text(t('fma.scan_with_camera'))),
      const SizedBox(height: 12),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: ScanField(
          fieldKey: const Key('scan-code'), controller: _manual, focusNode: _focus, label: t('fma.scan_type_label'), scanTitle: t('fma.scan_loading_title'), textInputAction: TextInputAction.done, enabled: !_busy,
          onChanged: (_) => setState(() {}), onSubmitted: (_) => _submitManual(), onScanned: (_) => _submitManual(),
        )),
        const SizedBox(width: 8),
        SizedBox(width: 64, height: 56, child: FilledButton(key: const Key('scan-add'), style: FilledButton.styleFrom(minimumSize: const Size(64, 56), padding: EdgeInsets.zero), onPressed: _busy || _manual.text.trim().isEmpty ? null : _submitManual, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : const Icon(Icons.add_task))),
      ]),
      if (last != null && last.text.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Banner2(
        key: const Key('scan-feedback'), tone: last.ok ? (last.warning ? Tone.warn : Tone.success) : (last.warning ? Tone.warn : Tone.danger), text: last.text,
        action: last.ok && !last.warning && last.code != null ? OutlinedButton.icon(key: const Key('scan-undo-last'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)), onPressed: _busy ? null : () { final s = stopIn(j, last.code!); _unscan(s?.code ?? '', last.code); }, icon: const Icon(Icons.undo), label: Text(t('fma.scan_undo'))) : null,
      )),
      if (_stops.isNotEmpty) ...[
        const SizedBox(height: 16),
        _ChecklistHeader(title: t('fma.not_scanned_n', {'n': pending.length}), icon: Icons.radio_button_unchecked, color: JR.muted),
        if (pending.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(t('fma.all_scanned'), key: const Key('scan-all-done'), style: const TextStyle(color: JR.accent, fontWeight: FontWeight.w700))),
        for (final s in (_showAllPending ? pending : pending.take(_limit))) _ParcelRow(key: Key('scan-row-${s.id}'), stop: s, scanned: false),
        if (pending.length > _limit && !_showAllPending) TextButton(key: const Key('scan-show-all-pending'), onPressed: () => setState(() => _showAllPending = true), child: Text(t('fma.show_all', {'n': pending.length}))),
        if (done.isNotEmpty) ...[
          const SizedBox(height: 10),
          _ChecklistHeader(title: t('fma.scanned_n', {'n': done.length}), icon: Icons.check_circle, color: JR.accent),
          for (final s in (_showAllScanned ? done : done.take(_limit))) _ParcelRow(key: Key('scan-row-${s.id}'), stop: s, scanned: true, onUndo: _busy ? null : () => _unscan(s.code, s.id)),
          if (done.length > _limit && !_showAllScanned) TextButton(key: const Key('scan-show-all-done'), onPressed: () => setState(() => _showAllScanned = true), child: Text(t('fma.show_all', {'n': done.length}))),
        ],
      ],
      const SizedBox(height: 16),
      FilledButton.icon(key: const Key('finish-loading'), onPressed: busy || _busy || !_canFinish ? null : _finish, icon: busyIcon(busy, Icons.flag_outlined), label: Text(t('fma.finish_loading'))),
      Padding(padding: const EdgeInsets.only(top: 6), child: Text(!_canFinish ? t('fma.finish_need_one') : t('fma.finish_hint'), key: const Key('finish-loading-hint'), style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.4))),
    ]));
  }
}

class _ChecklistHeader extends StatelessWidget {
  const _ChecklistHeader({required this.title, required this.icon, required this.color});
  final String title;
  final IconData icon;
  final Color color;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: [
        Icon(icon, size: 18, color: color), const SizedBox(width: 8),
        Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
      ]));
}

class _ParcelRow extends StatelessWidget {
  const _ParcelRow({super.key, required this.stop, required this.scanned, this.onUndo});
  final Stop stop;
  final bool scanned;
  final VoidCallback? onUndo;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final addr = [stop.address, if (stop.city != null) cityLabel(context, stop.city)].where((e) => e.isNotEmpty).join(' · ');
    return Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
      Icon(scanned ? Icons.check_circle : Icons.radio_button_unchecked, size: 20, color: scanned ? JR.accent : JR.muted),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(stop.code.isEmpty ? t('um.parcel_n', {'n': stop.seq}) : stop.code, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
        if (addr.isNotEmpty) Text(addr, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: JR.muted, fontSize: 12.5, height: 1.3)),
      ])),
      if (scanned && onUndo != null) IconButton(key: Key('scan-undo-${stop.id}'), tooltip: t('fma.scan_unscan'), constraints: const BoxConstraints(minWidth: 48, minHeight: 48), onPressed: onUndo, icon: const Icon(Icons.undo, size: 20)),
    ]));
  }
}
