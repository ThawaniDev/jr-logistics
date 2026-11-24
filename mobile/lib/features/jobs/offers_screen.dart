import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart' show ApiException, mapOf, strOf;
import '../../core/theme.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';
import '../../widgets/job_card.dart';
import '../cash/cash_errors.dart';
import '../cash/cash_risk_banner.dart';

class OffersScreen extends ConsumerWidget {
  const OffersScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    ref.read(catalogProvider); // warm the terms/policy text so tapping Accept never waits on the network for it
    // E11: with an active job the server sends no offers (`hidden`) — say why, and offer the way back to that job.
    final info = ref.watch(offersInfoProvider).value ?? OffersInfo.none;
    // A driver of an office sees no earnings anywhere (the office is paid).
    final hideMoney = ref.watch(overviewProvider).value?.walletManagedByOffice == true;
    // Cash over the limit / overdue: the server answers `{items: [], cashBlocked: true, cash}` — a paused state with the way out, not an empty list.
    final oppInfo = ref.watch(opportunitiesInfoProvider).value ?? OffersInfo.none;
    final risk = info.cash ?? oppInfo.cash ?? ref.watch(overviewProvider).value?.cashRisk;
    final paused = info.cashBlocked || oppInfo.cashBlocked || ref.watch(overviewProvider).value?.cashRisk?.blocksOffers == true;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(t('nav.opportunities')), bottom: TabBar(indicatorColor: JR.accent, labelColor: JR.accent, unselectedLabelColor: JR.muted, tabs: [Tab(text: t('opp.directed')), Tab(text: t('opp.open'))])),
        body: Column(children: [
        if (info.hidden && !paused) Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: _BusyBanner(active: info.activeJob)),
        Expanded(child: TabBarView(children: [
          RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(offersProvider); ref.invalidate(offersInfoProvider); await ref.read(offersProvider.future); }, child: AsyncBody(value: ref.watch(offersProvider), onRetry: () => ref.invalidate(offersProvider), builder: (list) => paused ? _PausedList(key: const Key('offers-paused-empty'), cash: risk) : list.isEmpty
              ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [ConstrainedBox(constraints: const BoxConstraints(minHeight: 320), child: EmptyView(title: t('driver.no_offers'), hint: t('driver.no_offers_hint'), icon: Icons.work_outline))])
              : ListView.separated(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), itemCount: list.length, separatorBuilder: (_, _) => const SizedBox(height: 12), itemBuilder: (_, i) {
                  final j = list[i];
                  return JobCard(job: j, lang: lang, onTap: () => context.push('/job/${j.offerId}'), footer: Row(children: [
                    Expanded(flex: 2, child: FilledButton(key: Key('accept-${j.offerId}'), onPressed: () => acceptWithTerms(context, ref, () => ref.read(apiProvider).accept(j.offerId), j.offerId), child: Text(t('act.accept')))),
                    const SizedBox(width: 10),
                    Expanded(child: OutlinedButton(key: Key('decline-${j.offerId}'), onPressed: () => _decline(context, ref, j.offerId), child: Text(t('act.decline')))),
                  ]));
                })),
          ),
          RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(opportunitiesProvider); ref.invalidate(offersInfoProvider); await ref.read(opportunitiesProvider.future); }, child: AsyncBody(value: ref.watch(opportunitiesProvider), onRetry: () => ref.invalidate(opportunitiesProvider), builder: (list) => paused ? _PausedList(key: const Key('opps-paused-empty'), cash: risk) : list.isEmpty
              ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [ConstrainedBox(constraints: const BoxConstraints(minHeight: 320), child: EmptyView(title: t('driver.no_offers'), icon: Icons.work_outline))])
              : ListView.separated(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), itemCount: list.length, separatorBuilder: (_, _) => const SizedBox(height: 12), itemBuilder: (_, i) {
                  final o = list[i];
                  return SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Expanded(child: Text(t.val('svc', o['service']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17))), Pill(t('opp.open_slots', {'n': o['openSlots'] ?? 0}), tone: Tone.info)]),
                    const SizedBox(height: 8),
                    Text('${fmtDateTime('${o['startsAt'] ?? ''}', lang)}\n${cityLabel(context, '${o['pickupCity'] ?? ''}')} → ${cityLabel(context, '${o['deliveryCity'] ?? ''}')}', style: TextStyle(color: JR.muted, height: 1.5)),
                    if (o['service'] == 'delivery_driver' && o['expectedUnits'] != null) ...[const SizedBox(height: 6), Text(t('ms.up_to_in_city', {'n': o['expectedUnits'], 'city': cityLabel(context, '${o['deliveryCity'] ?? ''}')}), key: Key('opp-parcels-${o['requestId']}'), style: const TextStyle(fontWeight: FontWeight.w600))],
                    if (o['allowPartial'] == false) ...[const SizedBox(height: 6), Text(t('ms.all_or_nothing'), key: Key('opp-all-or-nothing-${o['requestId']}'), style: TextStyle(color: JR.gold, fontSize: 13, height: 1.4))],
                    if (o['expectedEarningCents'] is num && !hideMoney && o['earningHidden'] != true) ...[const SizedBox(height: 10), Text(fmtMoney((o['expectedEarningCents'] as num).toInt(), lang), textDirection: TextDirection.ltr, style: TextStyle(color: JR.accent, fontWeight: FontWeight.w800, fontSize: 17))],
                    const SizedBox(height: 12),
                    FilledButton(key: Key('apply-${o['requestId']}'), onPressed: () => acceptWithTerms(context, ref, () => ref.read(apiProvider).apply('${o['requestId']}'), null), child: Text(t('act.apply'))),
                  ]));
                })),
          ),
        ])),
        ]),
      ),
    );
  }
}

/// What a tab shows while offers are paused: the banner in a scrolling list (it can be tall on a small phone with large text; it must never overflow).
class _PausedList extends StatelessWidget {
  const _PausedList({super.key, required this.cash});
  final CashRisk? cash;
  @override
  Widget build(BuildContext context) => ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [_PausedBanner(cash: cash)]);
}

/// "New offers are paused" (cash over the limit or overdue) + the way out: hand the cash to the warehouse.
class _PausedBanner extends ConsumerWidget {
  const _PausedBanner({required this.cash});
  final CashRisk? cash;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final overdue = cash?.reason == 'overdue' || cash?.state == CashState.overdue;
    return Banner2(
      key: const Key('offers-paused'), tone: Tone.danger, title: t('cr.paused_title'),
      text: [t(overdue ? 'cr.paused_overdue' : 'cr.paused_limit'), if (cash != null && cash!.atRisk) cashRiskTexts(t, cash!, lang).text].join('\n\n'),
      action: FilledButton.icon(key: const Key('offers-paused-cash'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: () => context.push('/cash'), icon: const Icon(Icons.payments_outlined), label: Text(t('cr.banner_open'), textAlign: TextAlign.center)),
    );
  }
}

/// "Finish your current job to see new offers" + a button to that job.
class _BusyBanner extends StatelessWidget {
  const _BusyBanner({required this.active});
  final ActiveJobRef? active;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final a = active;
    return Banner2(
      key: const Key('offers-hidden'), tone: Tone.info, title: t('fmb.offers_busy_title'),
      text: a != null && a.ref.isNotEmpty ? '${t('fmb.offers_busy')}\n${t('fmb.offers_busy_job', {'ref': a.ref})}' : t('fmb.offers_busy'),
      action: a == null ? null : FilledButton.icon(key: const Key('offers-active-job'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: () => context.push('/job/${a.offerId}'), icon: const Icon(Icons.local_shipping_outlined), label: Text(t('fmb.offers_go_job'), textAlign: TextAlign.center)),
    );
  }
}

/// Declining is final for this offer, and sits next to Accept: ask once so a stray thumb does not lose a job.
Future<void> _decline(BuildContext context, WidgetRef ref, String offerId) async {
  if (_actionRunning) return;
  final sure = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
    title: Text(d.tr('um.decline_title')), content: Text(d.tr('um.decline_body')),
    actions: [TextButton(style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))), FilledButton(key: const Key('decline-confirm'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48), backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('act.decline')))],
  ));
  if (sure != true || !context.mounted) return;
  _actionRunning = true;
  try {
    await guarded(context, () async { await ref.read(apiProvider).reject(offerId); return true; }, success: 'driver.declined_ok', maybeApplied: true);
    refreshAll(ref);
  } finally { _actionRunning = false; }
}

/// Accept / apply / decline are one-at-a-time across the whole screen: a double tap on a slow network must not send two requests.
bool _actionRunning = false;

/// Terms must be accepted explicitly each time a driver takes a job; cancellation policy is shown up front.
Future<void> acceptWithTerms(BuildContext context, WidgetRef ref, Future<Map<String, dynamic>> Function() action, String? offerId) async {
  if (_actionRunning) return;
  _actionRunning = true;
  try {
    await _acceptWithTerms(context, ref, action, offerId);
  } finally { _actionRunning = false; }
}

Future<void> _acceptWithTerms(BuildContext context, WidgetRef ref, Future<Map<String, dynamic>> Function() action, String? offerId) async {
  if (ref.read(catalogProvider).hasError) ref.invalidate(catalogProvider); // a failed first load must not stick for the whole session
  final cat = await ref.read(catalogProvider.future).timeout(const Duration(seconds: 6)).catchError((_) => <String, dynamic>{});
  if (!context.mounted) return;
  final terms = strOf(mapOf(cat['terms'])?['driver']) ?? '';
  var agreed = false;
  final ok = await showModalBottomSheet<bool>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(child: Padding(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(c.tr('opp.terms_title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Container(constraints: const BoxConstraints(maxHeight: 140), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(12)), child: SingleChildScrollView(child: Text(terms.isEmpty ? c.tr('opp.terms_default') : terms, style: TextStyle(color: JR.muted, fontSize: 13, height: 1.5)))),
      CheckboxListTile(key: const Key('terms-check'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: JR.accent, checkColor: JR.accentInk, value: agreed, onChanged: (v) => set(() => agreed = v ?? false), title: Text(c.tr('opp.terms_accept'), style: const TextStyle(fontSize: 14))),
      const SizedBox(height: 8),
      FilledButton(key: const Key('confirm-accept'), onPressed: agreed ? () => Navigator.pop(c, true) : null, child: Text(c.tr('act.accept_job'))),
    ]),
  ))));
  if (ok != true || !context.mounted) return;
  final lang = ref.read(localeProvider);
  final r = await guarded(context, action, success: 'driver.accepted_ok', maybeApplied: true, handle: (e) {
    // 403 CASH_LIMIT: too much cash (or cash past its handover time) — say so, with the figures, and offer the cash page; the lists then show the paused state.
    if (e is ApiException && e.code == 'CASH_LIMIT') { showCashLimitDialog(context, e, lang); return true; }
    return false;
  });
  refreshAll(ref);
  ref.invalidate(offersInfoProvider); ref.invalidate(opportunitiesInfoProvider);
  if (r != null && context.mounted) { final id = offerId ?? r['id']; if (id != null) context.push('/job/$id'); }
}
