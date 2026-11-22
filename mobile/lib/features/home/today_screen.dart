import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../services.dart';
import '../../widgets/common.dart';
import '../../widgets/job_card.dart';
import 'notify_prompt.dart';
import 'shell.dart';

class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});
  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

/// Whether the OS location permission is currently granted (re-read when the app comes back from Settings).
final locationPermissionProvider = FutureProvider.autoDispose<bool>((ref) => ref.watch(locationServiceProvider).hasPermission());

class _TodayScreenState extends ConsumerState<TodayScreen> {
  Timer? _poll, _loc;
  bool _toggling = false;
  late final AppLifecycleListener _life;

  void _refreshSoon() { ref.invalidate(overviewProvider); ref.invalidate(offersProvider); ref.invalidate(activeJobsProvider); ref.invalidate(locationPermissionProvider); }

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) { if (mounted) _refreshSoon(); });
    // Back from the lock screen, a call or Settings: show the real state immediately instead of up to 30 s later.
    _life = AppLifecycleListener(onResume: () { if (mounted) _refreshSoon(); });
  }

  @override
  void dispose() { _poll?.cancel(); _loc?.cancel(); _life.dispose(); super.dispose(); }

  /// Live location is reported while the driver is online OR has an active job (the server accepts both: customers
  /// follow a job in progress even if the driver went offline). It stops once neither applies, and is then cleared.
  void _syncLocationTimer({required bool online, required bool onJob}) {
    final shouldReport = online || onJob;
    if (shouldReport && _loc == null) {
      _loc = Timer.periodic(const Duration(seconds: 90), (_) => _report());
      _report();
    } else if (!shouldReport && _loc != null) {
      _loc!.cancel(); _loc = null;
      ref.read(apiProvider).clearLocation().catchError((_) {}); // driver is offline and the job ended: stop sharing the last point
    }
  }

  Future<void> _report() async {
    final p = await ref.read(locationServiceProvider).current();
    if (p != null) { try { await ref.read(apiProvider).sendLocation(p.lat, p.lng); } catch (_) {} }
  }

  Future<void> _toggle(bool goOnline) async {
    if (_toggling) return;
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
        if (ok == true) { final granted = await loc.requestPermission(); if (!granted && mounted) toast(context, context.tr('m.location_denied')); ref.invalidate(locationPermissionProvider); }
      }
    }
    if (!mounted) return;
    setState(() => _toggling = true);
    final api = ref.read(apiProvider);
    // Going offline wipes the shared location — unless a job is in progress, which keeps reporting (see _syncLocationTimer).
    final onJob = (ref.read(overviewProvider).value?.activeJobs ?? 0) > 0;
    final r = await guarded(context, () async { await api.setAvailability(goOnline); if (!goOnline && !onJob) await api.clearLocation().catchError((_) {}); return true; }, success: goOnline ? 'driver.now_online' : 'driver.now_offline');
    if (r == true && !goOnline && onJob) _report(); // the server cleared the point when we went offline; publish a fresh one right away
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
    ov.whenData((o) => WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _syncLocationTimer(online: o.available, onJob: o.activeJobs > 0); }));
    return Scaffold(
      appBar: AppBar(title: Text(t('driver.hello', {'name': '${user?['name'] ?? ''}'.split(' ').first})), actions: [IconButton(tooltip: t('nav.notifications'), icon: const Icon(Icons.notifications_outlined), onPressed: () => context.push('/notifications'))]),
      body: RefreshIndicator(
        color: JR.accent, onRefresh: () async { refreshAll(ref); await ref.read(overviewProvider.future); },
        child: AsyncBody(value: ov, onRetry: () => ref.invalidate(overviewProvider), builder: (o) => ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
          if (!o.verified) ...[Banner2(tone: Tone.warn, title: t.knows('verify.driver_${o.verification}_title') ? t('verify.driver_${o.verification}_title') : t('verify.driver_pending_title'), text: t('verify.driver_body'), action: OutlinedButton(onPressed: () => context.push('/documents'), child: Text(t('verify.go_documents')))), const SizedBox(height: 12)],
          if (o.suspended) ...[Banner2(tone: Tone.danger, title: t('driver.suspended'), text: t('driver.suspended_until', {'d': fmtDateTime(o.suspendedUntil, lang)})), const SizedBox(height: 12)],
          _AvailabilityCard(online: o.available, busy: _toggling, blocked: !o.verified || o.suspended, onToggle: _toggle),
          // Online without location permission: operations cannot see the driver and check-ins carry no GPS. Say so, with the way out.
          if (o.available && ref.watch(locationPermissionProvider).value == false) ...[
            const SizedBox(height: 12),
            Banner2(key: const Key('location-off'), tone: Tone.warn, icon: Icons.location_off_outlined, text: t('um.loc_off'), action: OutlinedButton.icon(onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings')))),
          ],
          const SizedBox(height: 12),
          // E11: while a job is active the server hides new offers; this shortcut takes the driver straight back to it.
          if (activeJobOf(o) case final a?) ...[
            SectionCard(key: const Key('active-job-card'), border: JR.accent, onTap: () => context.openJob(a.offerId), child: Row(children: [
              Icon(Icons.local_shipping, color: JR.accent),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t('fmb.active_job'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                if (a.ref.isNotEmpty) Text('${a.ref}${a.status.isNotEmpty && t.has('jobstatus.${a.status}') ? ' · ${t.val('jobstatus', a.status)}' : ''}', style: TextStyle(color: JR.muted, fontSize: 13)),
              ])),
              Icon(Icons.chevron_right, color: JR.muted),
            ])),
            const SizedBox(height: 12),
          ],
          // E17: cash collected on delivery that has not been handed to the warehouse yet.
          if (CashBrief.fromOverview(o.j) case final c? when c.show) ...[
            SectionCard(key: const Key('cash-card'), border: c.outstandingCents > 0 ? JR.gold : null, onTap: () => context.push('/cash'), child: Row(children: [
              Icon(Icons.payments_outlined, color: c.outstandingCents > 0 ? JR.gold : JR.cyan),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t('fmb.cash_with_me'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(fmtMoney(c.outstandingCents, lang), key: const Key('cash-card-amount'), textDirection: TextDirection.ltr, style: TextStyle(color: c.outstandingCents > 0 ? JR.gold : JR.accent, fontWeight: FontWeight.w800, fontSize: 19))),
              ])),
              Icon(Icons.chevron_right, color: JR.muted),
            ])),
            const SizedBox(height: 12),
          ],
          const NotifyPromptCard(),
          if ((offers.value?.length ?? 0) > 0) ...[
            SectionCard(border: JR.cyan, onTap: () => StatefulNavigationShell.of(context).goBranch(2), child: Row(children: [Icon(Icons.work, color: JR.cyan), const SizedBox(width: 12), Expanded(child: Text('${t('driver.new_offers')}: ${offers.value!.length}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))), Icon(Icons.chevron_right, color: JR.muted)])),
            const SizedBox(height: 12),
          ],
          // A driver of an office has no wallet and sees no earnings: the two money tiles are replaced by one calm line (his cash stays in the card above).
          if (o.walletManagedByOffice)
            SectionCard(key: const Key('wallet-managed-tile'), onTap: () => StatefulNavigationShell.of(context).goBranch(3), child: Row(children: [
              Icon(Icons.apartment_outlined, color: JR.cyan),
              const SizedBox(width: 12),
              Expanded(child: Text(t('drs.managed_title'), style: const TextStyle(fontWeight: FontWeight.w600, height: 1.3))),
              Icon(Icons.chevron_right, color: JR.muted),
            ]))
          else
            Row(children: [
              Expanded(child: _Stat(label: t('fmb.wallet_on_hold'), value: fmtMoney(o.pendingCents, lang), color: JR.gold)),
              const SizedBox(width: 12),
              Expanded(child: _Stat(label: t('wallet.available'), value: fmtMoney(o.availableCents, lang), color: JR.accent)),
            ]),
          const SizedBox(height: 20),
          Text(t('driver.active_jobs'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
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
          ExcludeSemantics(child: Container(width: 12, height: 12, decoration: BoxDecoration(shape: BoxShape.circle, color: online ? JR.accent : JR.muted, boxShadow: online ? [BoxShadow(color: JR.accent, blurRadius: 10)] : null))),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(online ? t('driver.online') : t('driver.offline'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text(blocked ? t('m.go_online_blocked') : online ? t('driver.online_hint') : t('driver.offline_hint'), style: TextStyle(color: JR.muted, fontSize: 13)),
          ])),
        ]),
        const SizedBox(height: 14),
        online
            ? OutlinedButton.icon(key: const Key('toggle'), onPressed: busy ? null : () => onToggle(false), icon: busyIcon(busy, Icons.power_settings_new, color: JR.accent), label: Text(t('driver.go_offline')))
            : FilledButton.icon(key: const Key('toggle'), onPressed: busy || blocked ? null : () => onToggle(true), icon: busyIcon(busy, Icons.power_settings_new), label: Text(t('driver.go_online'))),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});
  final String label, value;
  final Color color;
  @override
  Widget build(BuildContext context) => SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: TextStyle(color: JR.muted, fontSize: 12)), const SizedBox(height: 6), Text(value, textDirection: TextDirection.ltr, style: TextStyle(color: color, fontSize: 19, fontWeight: FontWeight.w800))]));
}
