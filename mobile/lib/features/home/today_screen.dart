import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import '../../widgets/job_card.dart';
import 'shell.dart';

class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});
  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends ConsumerState<TodayScreen> {
  Timer? _poll, _loc;
  bool _toggling = false;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) { ref.invalidate(overviewProvider); ref.invalidate(offersProvider); ref.invalidate(activeJobsProvider); } });
  }

  @override
  void dispose() { _poll?.cancel(); _loc?.cancel(); super.dispose(); }

  /// Live location only while online; stops the moment the driver goes offline.
  void _syncLocationTimer(bool online) {
    if (online && _loc == null) {
      _loc = Timer.periodic(const Duration(seconds: 90), (_) => _report());
      _report();
    } else if (!online && _loc != null) { _loc!.cancel(); _loc = null; }
  }

  Future<void> _report() async {
    final p = await ref.read(locationServiceProvider).current();
    if (p != null) { try { await ref.read(apiProvider).sendLocation(p.lat, p.lng); } catch (_) {} }
  }

  Future<void> _toggle(bool goOnline) async {
    if (goOnline) {
      final prefs = ref.read(prefsProvider);
      final loc = ref.read(locationServiceProvider);
      if (prefs.getBool('loc_asked') != true && !await loc.hasPermission()) {
        if (!mounted) return;
        final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
          title: Text(d.tr('m.share_location_title')), content: Text(d.tr('m.share_location_body')),
          actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: Text(d.tr('m.not_now'))), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(100, 44)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('m.allow')))],
        ));
        await prefs.setBool('loc_asked', true);
        if (ok == true) { final granted = await loc.requestPermission(); if (!granted && mounted) toast(context, context.tr('m.location_denied')); }
      }
    }
    setState(() => _toggling = true);
    final api = ref.read(apiProvider);
    if (!mounted) return;
    final r = await guarded(context, () async { await api.setAvailability(goOnline); if (!goOnline) await api.clearLocation().catchError((_) {}); return true; }, success: goOnline ? 'driver.now_online' : 'driver.now_offline');
    if (r == true) refreshAll(ref); // going online backfills matching offers server-side; going offline changes what we may see
    if (mounted) setState(() => _toggling = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final user = ref.watch(authProvider).value?.user;
    final ov = ref.watch(overviewProvider);
    final jobs = ref.watch(activeJobsProvider);
    final offers = ref.watch(offersProvider);
    ov.whenData((o) => WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _syncLocationTimer(o.available); }));
    return Scaffold(
      appBar: AppBar(title: Text(t('driver.hello', {'name': '${user?['name'] ?? ''}'.split(' ').first})), actions: [IconButton(tooltip: t('nav.notifications'), icon: const Icon(Icons.notifications_outlined), onPressed: () => context.push('/notifications'))]),
      body: RefreshIndicator(
        color: JR.accent, onRefresh: () async { refreshAll(ref); await ref.read(overviewProvider.future); },
        child: AsyncBody(value: ov, onRetry: () => ref.invalidate(overviewProvider), builder: (o) => ListView(padding: const EdgeInsets.all(16), children: [
          if (!o.verified) ...[Banner2(tone: Tone.warn, title: t('verify.driver_${o.verification}_title'), text: t('verify.driver_body'), action: OutlinedButton(onPressed: () => context.push('/documents'), child: Text(t('verify.go_documents')))), const SizedBox(height: 12)],
          if (o.suspended) ...[Banner2(tone: Tone.danger, title: t('driver.suspended'), text: t('driver.suspended_until', {'d': fmtDateTime(o.suspendedUntil, lang)})), const SizedBox(height: 12)],
          _AvailabilityCard(online: o.available, busy: _toggling, blocked: !o.verified || o.suspended, onToggle: _toggle),
          const SizedBox(height: 12),
          if ((offers.value?.length ?? 0) > 0) ...[
            SectionCard(border: JR.cyan, onTap: () => StatefulNavigationShell.of(context).goBranch(2), child: Row(children: [const Icon(Icons.work, color: JR.cyan), const SizedBox(width: 12), Expanded(child: Text('${t('driver.new_offers')}: ${offers.value!.length}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))), const Icon(Icons.chevron_right, color: JR.muted)])),
            const SizedBox(height: 12),
          ],
          Row(children: [
            Expanded(child: _Stat(label: t('driver.pending_pay'), value: fmtMoney(o.pendingCents, lang), color: JR.gold)),
            const SizedBox(width: 12),
            Expanded(child: _Stat(label: t('wallet.available'), value: fmtMoney(o.availableCents, lang), color: JR.accent)),
          ]),
          const SizedBox(height: 20),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Flexible(child: Text(t('driver.active_jobs'), overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
            if ((jobs.value?.length ?? 0) > 0) TextButton.icon(onPressed: () => context.push('/route'), icon: const Icon(Icons.alt_route), label: Text(t('m.route_title'))),
          ]),
          const SizedBox(height: 8),
          AsyncBody(value: jobs, onRetry: () => ref.invalidate(activeJobsProvider), builder: (list) => list.isEmpty
              ? Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: EmptyView(title: t('m.today_empty'), hint: o.available ? t('driver.no_offers_hint') : t('driver.no_offers_offline'), icon: Icons.local_shipping_outlined))
              : Column(children: [for (final j in list) Padding(padding: const EdgeInsets.only(bottom: 12), child: JobCard(job: j, lang: lang, highlight: j.can('checkin') || j.awaitingLoadingAck || j.can('report_delivered'), onTap: () => context.openJob(j.offerId)))])),
        ])),
      ),
    );
  }
}

class _AvailabilityCard extends StatelessWidget {
  const _AvailabilityCard({required this.online, required this.busy, required this.blocked, required this.onToggle});
  final bool online, busy, blocked;
  final Future<void> Function(bool) onToggle;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return SectionCard(
      border: online ? JR.accent : null,
      child: Column(children: [
        Row(children: [
          Container(width: 12, height: 12, decoration: BoxDecoration(shape: BoxShape.circle, color: online ? JR.accent : JR.muted, boxShadow: online ? [const BoxShadow(color: JR.accent, blurRadius: 10)] : null)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(online ? t('driver.online') : t('driver.offline'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text(blocked ? t('m.go_online_blocked') : online ? t('driver.online_hint') : t('driver.offline_hint'), style: const TextStyle(color: JR.muted, fontSize: 13)),
          ])),
        ]),
        const SizedBox(height: 14),
        online
            ? OutlinedButton(key: const Key('toggle'), onPressed: busy ? null : () => onToggle(false), child: Text(t('driver.go_offline')))
            : FilledButton(key: const Key('toggle'), onPressed: busy || blocked ? null : () => onToggle(true), child: Text(t('driver.go_online'))),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});
  final String label, value;
  final Color color;
  @override
  Widget build(BuildContext context) => SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(color: JR.muted, fontSize: 12)), const SizedBox(height: 6), Text(value, textDirection: TextDirection.ltr, style: TextStyle(color: color, fontSize: 19, fontWeight: FontWeight.w800))]));
}
