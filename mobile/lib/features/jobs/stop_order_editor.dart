import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'route_order.dart';
import 'stop_runner.dart';

/// Manual route order (E5): the remaining stops as a list the driver can re-arrange — drag the handle, move one step with the arrows, or send a stop
/// to the front with "Make next" — and one "Save order" that sends the whole order to the server. Until then nothing changes on the server.
/// [stops] = the movable stops ([movableStops]) in their current order; the stop the driver stands at is pinned first and is not part of the list.
class StopOrderEditor extends ConsumerStatefulWidget {
  const StopOrderEditor({super.key, required this.job, required this.stops, required this.fallbackCity, required this.onClose});
  final Job job;
  final List<Stop> stops;
  final String fallbackCity;
  /// Called after a successful save or when the driver cancels.
  final VoidCallback onClose;
  @override
  ConsumerState<StopOrderEditor> createState() => _StopOrderEditorState();
}

class _StopOrderEditorState extends ConsumerState<StopOrderEditor> {
  late List<String> _ids = [for (final s in widget.stops) s.id];
  String? _error;

  List<String> get _serverIds => [for (final s in widget.stops) s.id];
  bool get _dirty { final a = _serverIds; if (a.length != _ids.length) return true; for (var i = 0; i < a.length; i++) { if (a[i] != _ids[i]) return true; } return false; }

  @override
  void didUpdateWidget(StopOrderEditor old) {
    super.didUpdateWidget(old);
    // Stops were resolved / added meanwhile (a refresh): keep my arrangement for the stops that are still there, append new ones, drop gone ones.
    final now = {for (final s in widget.stops) s.id};
    final before = {for (final s in old.stops) s.id};
    if (now.length != before.length || !now.containsAll(before)) {
      _ids = [for (final id in _ids) if (now.contains(id)) id, for (final s in widget.stops) if (!_ids.contains(s.id)) s.id];
    }
  }

  Stop? _stop(String id) { for (final s in widget.stops) { if (s.id == id) return s; } return null; }

  void _move(int from, int to) { if (to < 0 || to >= _ids.length) return; setState(() { _ids = moveItem(_ids, from, to > from ? to + 1 : to); _error = null; }); }
  void _first(int i) { if (i <= 0) return; setState(() { _ids = moveItem(_ids, i, 0); _error = null; }); haptic(HapticKind.select); }

  Future<void> _save() async {
    final order = List<String>.of(_ids);
    final ok = await runStopAction(context, ref, widget.job.offerId, () async { await ref.read(apiProvider).routeReorder(widget.job.offerId, order); },
        success: 'fma.order_saved',
        verify: (f) { final m = movableStops(f).map((s) => s.id).toList(); if (m.length != order.length) return false; for (var i = 0; i < m.length; i++) { if (m[i] != order[i]) return false; } return true; },
        onError: (m) { if (mounted) setState(() => _error = m); });
    if (ok && mounted) widget.onClose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final busy = ref.watch(stopBusyProvider).contains(widget.job.offerId);
    final sms = widget.job.routeApproved;
    return Column(key: const Key('order-editor'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Banner2(text: t(sms ? 'fma.reorder_hint_approved' : 'fma.reorder_hint')),
      const SizedBox(height: 8),
      ReorderableListView(
        shrinkWrap: true, primary: false, physics: const NeverScrollableScrollPhysics(), buildDefaultDragHandles: false,
        onReorder: busy ? (_, _) {} : (a, b) => setState(() { _ids = moveItem(_ids, a, b); _error = null; }),
        proxyDecorator: (child, _, _) => Material(color: JR.bg2, elevation: 4, borderRadius: BorderRadius.circular(10), child: child),
        children: [
          for (final (i, id) in _ids.indexed) if (_stop(id) != null) _EditRow(
            key: ValueKey(id), index: i, count: _ids.length, stop: _stop(id)!, fallbackCity: widget.fallbackCity, enabled: !busy, next: widget.job.routeApproved && i == 0,
            onUp: () => _move(i, i - 1), onDown: () => _move(i, i + 1), onFirst: () => _first(i),
          ),
        ],
      ),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Banner2(key: const Key('order-error'), tone: Tone.danger, text: _error!)),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: OutlinedButton(key: const Key('order-cancel'), onPressed: busy ? null : widget.onClose, child: Text(t('common.cancel'), maxLines: 1, overflow: TextOverflow.ellipsis))),
        const SizedBox(width: 8),
        Expanded(flex: 2, child: FilledButton.icon(key: const Key('order-save'), onPressed: busy || !_dirty ? null : _save, icon: busyIcon(busy, Icons.save_outlined), label: Text(t('fma.save_order'), maxLines: 1, overflow: TextOverflow.ellipsis))),
      ]),
    ]);
  }
}

class _EditRow extends StatelessWidget {
  const _EditRow({super.key, required this.index, required this.count, required this.stop, required this.fallbackCity, required this.enabled, required this.next, required this.onUp, required this.onDown, required this.onFirst});
  final int index, count;
  final Stop stop;
  final String fallbackCity;
  final bool enabled, next;
  final VoidCallback onUp, onDown, onFirst;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final id = stop.id;
    Widget small(Key k, IconData icon, String tip, VoidCallback? onTap) => IconButton(key: k, tooltip: tip, iconSize: 22, constraints: const BoxConstraints(minWidth: 44, minHeight: 44), padding: EdgeInsets.zero, onPressed: enabled ? onTap : null, icon: Icon(icon));
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4), padding: const EdgeInsetsDirectional.fromSTEB(10, 8, 4, 8),
      decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(10), border: Border.all(color: JR.line)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CircleAvatar(radius: 14, backgroundColor: JR.accent.withValues(alpha: 0.15), child: Text('${index + 1}', style: const TextStyle(color: JR.accent, fontSize: 12, fontWeight: FontWeight.w800))),
        const SizedBox(width: 10),
        Expanded(child: Column(key: Key('order-row-$id'), crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(stop.address, style: const TextStyle(fontWeight: FontWeight.w700, height: 1.25)),
          Text(cityLabel(context, stop.city ?? fallbackCity), style: const TextStyle(color: JR.muted, fontSize: 13)),
          if (next) Padding(padding: const EdgeInsets.only(top: 4), child: Pill(t('fma.stop_next'), tone: Tone.info)),
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
            small(Key('order-up-$id'), Icons.keyboard_arrow_up, t('fma.move_up'), index > 0 ? onUp : null),
            small(Key('order-down-$id'), Icons.keyboard_arrow_down, t('fma.move_down'), index < count - 1 ? onDown : null),
            if (index > 0) TextButton.icon(key: Key('order-first-$id'), style: TextButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 8)), onPressed: enabled ? onFirst : null, icon: const Icon(Icons.vertical_align_top, size: 18), label: Text(t('fma.make_next'))),
          ]),
        ])),
        ReorderableDragStartListener(index: index, enabled: enabled, child: Padding(key: Key('order-handle-$id'), padding: const EdgeInsets.all(12), child: const Icon(Icons.drag_handle, color: JR.muted))),
      ]),
    );
  }
}
