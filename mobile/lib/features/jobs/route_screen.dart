import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// Multi-stop route planning. The server returns an ordered list; the driver reviews it before navigation starts.
class RouteScreen extends ConsumerStatefulWidget {
  const RouteScreen({super.key});
  @override
  ConsumerState<RouteScreen> createState() => _RouteScreenState();
}

class _RouteScreenState extends ConsumerState<RouteScreen> {
  final _picked = <String>{};
  bool _busy = false, _init = false;
  RoutePlan? _plan;
  List<Job> _jobs = [];
  static const _riyadh = (lat: 24.7136, lng: 46.6753);

  Future<void> _optimize() async {
    setState(() { _busy = true; _plan = null; });
    final here = await ref.read(locationServiceProvider).current();
    if (here == null && mounted) toast(context, context.tr('m.location_denied'));
    if (!mounted) return;
    final plan = await guarded(context, () => ref.read(apiProvider).optimizeRoute((here ?? _riyadh).lat, (here ?? _riyadh).lng, _picked.toList()));
    if (mounted) setState(() { _plan = plan; _busy = false; });
  }

  String _stopQuery(Job j) => j.deliveryLat != null ? '${j.deliveryLat},${j.deliveryLng}' : (j.deliveryAddress ?? j.deliveryCity);

  Future<void> _start() async {
    final byId = {for (final j in _jobs) j.offerId: j};
    final stops = [for (final id in _plan!.order) _stopQuery(byId[id]!)];
    final ok = await ref.read(linkOpenerProvider).open(googleMapsDirections(stops));
    if (!ok && mounted) toast(context, context.tr('m.wa_open_failed'), error: true);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final jobs = ref.watch(activeJobsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t('m.route_title'))),
      body: AsyncBody(value: jobs, onRetry: () => ref.invalidate(activeJobsProvider), builder: (all) {
        _jobs = all.where((j) => j.delivery != null).toList();
        if (!_init) { _picked.addAll(_jobs.map((j) => j.offerId)); _init = true; }
        if (_jobs.isEmpty) return EmptyView(title: t('m.route_no_jobs'), icon: Icons.alt_route);
        final byId = {for (final j in _jobs) j.offerId: j};
        return ListView(padding: const EdgeInsets.all(16), children: [
          if (_plan == null) ...[
            Text(t('m.route_pick'), style: const TextStyle(color: JR.muted)),
            const SizedBox(height: 12),
            for (final j in _jobs) Padding(padding: const EdgeInsets.only(bottom: 8), child: SectionCard(padding: EdgeInsets.zero, child: CheckboxListTile(
              value: _picked.contains(j.offerId), activeColor: JR.accent, checkColor: JR.accentInk, controlAffinity: ListTileControlAffinity.leading,
              onChanged: (v) => setState(() => v == true ? _picked.add(j.offerId) : _picked.remove(j.offerId)),
              title: Text('${j.ref} · ${t('city.${j.deliveryCity}')}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(j.deliveryAddress ?? '—'),
            ))),
            const SizedBox(height: 8),
            FilledButton.icon(key: const Key('optimize'), onPressed: _busy || _picked.isEmpty ? null : _optimize, icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : const Icon(Icons.auto_awesome), label: Text(t('m.route_optimize'))),
          ] else ...[
            // Honest labelling: never claim an estimate is Google's or "the best".
            Banner2(tone: _plan!.isGoogle ? Tone.success : Tone.warn, title: _plan!.isGoogle ? t('m.route_google') : t('m.route_estimate'), text: _plan!.warning == null ? t('m.route_review') : '${t(_plan!.warning!.startsWith('ROUTING_PROVIDER_FAILED') ? 'm.route_failed' : 'm.route_not_configured')}\n${t('m.route_review')}'),
            const SizedBox(height: 12),
            SectionCard(child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              const Icon(Icons.timelapse, color: JR.cyan),
              Text(t('m.route_total', {'km': fmtKm(_plan!.totalDistanceM), 'time': fmtDuration(_plan!.totalDurationS)}), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ])),
            const SizedBox(height: 12),
            for (final (i, id) in _plan!.order.indexed) Padding(padding: const EdgeInsets.only(bottom: 8), child: SectionCard(child: Row(children: [
              CircleAvatar(radius: 16, backgroundColor: JR.accent, child: Text('${i + 1}', style: const TextStyle(color: JR.accentInk, fontWeight: FontWeight.w800))),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(byId[id]?.ref ?? id, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(byId[id]?.deliveryAddress ?? '', style: const TextStyle(color: JR.muted, fontSize: 13)),
              ])),
              if (i < _plan!.legs.length) Text('${fmtKm(_plan!.legs[i].distanceM)}\n${fmtDuration(_plan!.legs[i].durationS)}', textAlign: TextAlign.end, textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 12)),
            ]))),
            const SizedBox(height: 8),
            FilledButton.icon(key: const Key('start-nav'), onPressed: _start, icon: const Icon(Icons.navigation), label: Text(t('m.route_start'))),
            const SizedBox(height: 10),
            OutlinedButton(onPressed: () => setState(() => _plan = null), child: Text(t('common.back'))),
          ],
        ]);
      }),
    );
  }
}
