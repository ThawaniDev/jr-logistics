import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import '../../widgets/job_card.dart';

class OffersScreen extends ConsumerWidget {
  const OffersScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(t('nav.opportunities')), bottom: TabBar(indicatorColor: JR.accent, labelColor: JR.accent, unselectedLabelColor: JR.muted, tabs: [Tab(text: t('opp.directed')), Tab(text: t('opp.open'))])),
        body: TabBarView(children: [
          RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(offersProvider); await ref.read(offersProvider.future); }, child: AsyncBody(value: ref.watch(offersProvider), onRetry: () => ref.invalidate(offersProvider), builder: (list) => list.isEmpty
              ? ListView(children: [SizedBox(height: 320, child: EmptyView(title: t('driver.no_offers'), hint: t('driver.no_offers_hint'), icon: Icons.work_outline))])
              : ListView.separated(padding: const EdgeInsets.all(16), itemCount: list.length, separatorBuilder: (_, _) => const SizedBox(height: 12), itemBuilder: (_, i) {
                  final j = list[i];
                  return JobCard(job: j, lang: lang, onTap: () => context.push('/job/${j.offerId}'), footer: Row(children: [
                    Expanded(flex: 2, child: FilledButton(key: Key('accept-${j.offerId}'), onPressed: () => acceptWithTerms(context, ref, () => ref.read(apiProvider).accept(j.offerId), j.offerId), child: Text(t('act.accept')))),
                    const SizedBox(width: 10),
                    Expanded(child: OutlinedButton(onPressed: () async { await guarded(context, () async { await ref.read(apiProvider).reject(j.offerId); return true; }, success: 'driver.declined_ok'); refreshAll(ref); }, child: Text(t('act.decline')))),
                  ]));
                })),
          ),
          RefreshIndicator(color: JR.accent, onRefresh: () async { ref.invalidate(opportunitiesProvider); await ref.read(opportunitiesProvider.future); }, child: AsyncBody(value: ref.watch(opportunitiesProvider), onRetry: () => ref.invalidate(opportunitiesProvider), builder: (list) => list.isEmpty
              ? ListView(children: [SizedBox(height: 320, child: EmptyView(title: t('driver.no_offers'), icon: Icons.work_outline))])
              : ListView.separated(padding: const EdgeInsets.all(16), itemCount: list.length, separatorBuilder: (_, _) => const SizedBox(height: 12), itemBuilder: (_, i) {
                  final o = list[i];
                  return SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Expanded(child: Text(t('svc.${o['service']}'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17))), Pill(t('opp.open_slots', {'n': o['openSlots']}), tone: Tone.info)]),
                    const SizedBox(height: 8),
                    Text('${fmtDateTime(o['startsAt'] as String, lang)}\n${t('city.${o['pickupCity']}')} → ${t('city.${o['deliveryCity']}')}', style: const TextStyle(color: JR.muted, height: 1.5)),
                    if (o['expectedEarningCents'] != null) ...[const SizedBox(height: 10), Text(fmtMoney((o['expectedEarningCents'] as num).toInt(), lang), textDirection: TextDirection.ltr, style: const TextStyle(color: JR.accent, fontWeight: FontWeight.w800, fontSize: 17))],
                    const SizedBox(height: 12),
                    FilledButton(onPressed: () => acceptWithTerms(context, ref, () => ref.read(apiProvider).apply(o['requestId'] as String), null), child: Text(t('act.apply'))),
                  ]));
                })),
          ),
        ]),
      ),
    );
  }
}

/// Terms must be accepted explicitly each time a driver takes a job; cancellation policy is shown up front.
Future<void> acceptWithTerms(BuildContext context, WidgetRef ref, Future<Map<String, dynamic>> Function() action, String? offerId) async {
  final cat = await ref.read(catalogProvider.future).catchError((_) => <String, dynamic>{});
  if (!context.mounted) return;
  final terms = (cat['terms'] as Map?)?['driver'] as String? ?? '';
  var agreed = false;
  final ok = await showModalBottomSheet<bool>(context: context, useRootNavigator: true, isScrollControlled: true, builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(child: Padding(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(c.tr('opp.terms_title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Container(constraints: const BoxConstraints(maxHeight: 140), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(12)), child: SingleChildScrollView(child: Text(terms.isEmpty ? c.tr('opp.terms_default') : terms, style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.5)))),
      CheckboxListTile(key: const Key('terms-check'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: JR.accent, checkColor: JR.accentInk, value: agreed, onChanged: (v) => set(() => agreed = v ?? false), title: Text(c.tr('opp.terms_accept'), style: const TextStyle(fontSize: 14))),
      const SizedBox(height: 8),
      FilledButton(key: const Key('confirm-accept'), onPressed: agreed ? () => Navigator.pop(c, true) : null, child: Text(c.tr('act.accept_job'))),
    ]),
  ))));
  if (ok != true || !context.mounted) return;
  final r = await guarded(context, action, success: 'driver.accepted_ok');
  refreshAll(ref);
  if (r != null && context.mounted) context.push('/job/${offerId ?? r['id']}');
}
