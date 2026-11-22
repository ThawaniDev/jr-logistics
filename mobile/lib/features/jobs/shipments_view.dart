import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'shipment_card.dart';
import 'shipment_logic.dart';
import 'shipment_sheet.dart';
import 'shipments_header.dart';
import 'stop_actions.dart';

/// The shipments of a per-parcel job as a run sheet (the "DRS"): header with counters and progress, filter chips + search, one card per shipment in a
/// virtualised list (1 to 500+), and a bottom bar with the main action. With routing OFF this is the whole working surface of the job (any shipment, any
/// order); with routing ON it is an overview where only the server's current stop accepts actions.
class ShipmentsView extends ConsumerStatefulWidget {
  const ShipmentsView({super.key, required this.job, required this.lang, this.extras = const []});
  final Job job;
  final String lang;
  /// Job-level cards shown under the header (job completed, rating, notices).
  final List<Widget> extras;

  /// With routing OFF the run sheet replaces the one-stop-at-a-time panel as soon as the parcels are with the driver: after the loading
  /// confirmation, while delivering, and for a finished job (its result). Before that (hand-over, counting, scan loading) the job page guides the driver.
  static bool applies(Job j) {
    if (!j.manifest || j.routingEnabled || j.stops.isEmpty || j.inScanLoading || j.can('ack_loading') || j.loadingDisputed) return false;
    final s = j.stopsSummary;
    if (s.total > 0 && s.pending >= s.total) return false; // nothing handed over yet
    return const ['attendance_confirmed', 'delivered_reported', 'pending_settlement', 'qty_disputed', 'completed'].contains(j.status);
  }

  @override
  ConsumerState<ShipmentsView> createState() => _ShipmentsViewState();
}

class _ShipmentsViewState extends ConsumerState<ShipmentsView> {
  ShipFilter _filter = ShipFilter.all;
  final _search = TextEditingController();
  bool _searchOpen = false;

  @override
  void dispose() { _search.dispose(); super.dispose(); }

  Job get job => widget.job;

  Future<void> _finish() => runStopAction(context, ref, job.offerId, () async { await ref.read(apiProvider).delivered(job.offerId); },
      success: job.earningHidden ? 'drs.finish_ok_office' : 'fma.finish_ok', verify: (f) => !f.can('report_delivered'));

  void _open(Stop s) => showShipmentSheet(context, offerId: job.offerId, stopId: s.id);

  void _clear() => setState(() { _filter = ShipFilter.all; _search.clear(); });

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final stops = job.stops;
    final counts = ShipCounts.of(stops);
    final list = filterShipments(stops, _filter, _search.text);
    final next = job.can('work_stops') ? nextShipment(stops) : null;
    final index = {for (final (i, s) in list.indexed) 'ship-item-${s.id}': i};
    return Column(children: [
      Expanded(child: CustomScrollView(key: const Key('ship-scroll'), physics: const AlwaysScrollableScrollPhysics(), slivers: [
        SliverToBoxAdapter(child: ShipmentsHeader(job: job, lang: widget.lang, counts: counts)),
        if (widget.extras.isNotEmpty) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: widget.extras))),
        PinnedHeaderSliver(child: ShipFilterBar(
          counts: counts, filter: _filter, onFilter: (f) => setState(() => _filter = f),
          search: _search, searchOpen: _searchOpen, onQuery: (_) => setState(() {}),
          onToggleSearch: () => setState(() { _searchOpen = !_searchOpen; if (!_searchOpen) _search.clear(); }),
        )),
        if (list.isEmpty)
          SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: EmptyView(
            key: const Key('ship-empty'), icon: Icons.inventory_2_outlined, title: t(stops.isEmpty ? 'ms.no_stops' : 'drs.empty_title'), hint: stops.isEmpty ? null : t('drs.empty_hint'),
          )))
        else
          SliverPadding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 16), sliver: SliverList.builder(
            itemCount: list.length,
            findChildIndexCallback: (k) => k is ValueKey<String> ? index[k.value] : null,
            itemBuilder: (context, i) {
              final s = list[i];
              final a = shipActionsFor(job, s);
              return Padding(key: ValueKey('ship-item-${s.id}'), padding: const EdgeInsets.only(bottom: 10), child: ShipmentCard(
                stop: s, lang: widget.lang, isNext: next?.id == s.id,
                onTap: () => _open(s),
                onCall: a.call ? () => StopActions.call(context, s) : null,
                onWhatsapp: a.whatsapp ? () => StopActions.whatsapp(context, ref, job, s) : null,
              ));
            },
          )),
        if (list.isEmpty && stops.isNotEmpty && (_filter != ShipFilter.all || _search.text.trim().isNotEmpty))
          SliverToBoxAdapter(child: Center(child: TextButton(key: const Key('ship-clear'), onPressed: _clear, child: Text(t('drs.clear_filters'))))),
      ])),
      _BottomBar(job: job, counts: counts, next: next, onNext: next == null ? null : () => _open(next), onFinish: _finish),
    ]);
  }
}

/// The main action of the run sheet: "Next shipment" while parcels are left, "Finish route" once every one is resolved. Nothing for a finished job.
class _BottomBar extends ConsumerWidget {
  const _BottomBar({required this.job, required this.counts, required this.next, required this.onNext, required this.onFinish});
  final Job job;
  final ShipCounts counts;
  final Stop? next;
  final VoidCallback? onNext;
  final VoidCallback onFinish;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final busy = ref.watch(stopBusyProvider).contains(job.offerId);
    Widget? child;
    if (job.can('work_stops') && next != null) {
      child = Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FilledButton.icon(key: const Key('drs-next'), onPressed: busy ? null : onNext, icon: const Icon(Icons.local_shipping_outlined), label: Text(t('drs.next_shipment'), textAlign: TextAlign.center)),
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('drs.left', {'n': counts.toDeliver}), key: const Key('drs-left'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, fontSize: 12.5))),
      ]);
    } else if (job.can('report_delivered')) {
      child = Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(t('ms.finish_summary', {'delivered': counts.delivered, 'failed': counts.notDelivered}), key: const Key('finish-summary'), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
        if (counts.notDelivered > 0) Padding(padding: const EdgeInsets.only(top: 8), child: Banner2(key: const Key('return-warning'), tone: Tone.warn, text: t('fma.finish_return_warning', {'n': counts.notDelivered}))),
        const SizedBox(height: 10),
        FilledButton.icon(key: const Key('finish'), onPressed: busy ? null : onFinish, icon: busyIcon(busy, Icons.flag_outlined), label: Text(t('ms.finish_btn'))),
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(t(job.earningHidden ? 'drs.finish_paid_note_office' : 'fma.finish_paid_note'), key: const Key('finish-paid-note'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, fontSize: 12.5, height: 1.35))),
      ]);
    }
    if (child == null) return const SizedBox.shrink();
    return Material(color: JR.bg2, child: SafeArea(top: false, child: Container(
      key: const Key('drs-bottom-bar'), padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: JR.line))), child: child,
    )));
  }
}
