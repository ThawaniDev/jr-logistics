import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../data/models.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import '../../widgets/job_card.dart';
import '../home/shell.dart';

class JobsScreen extends ConsumerWidget {
  const JobsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(t('nav.my_jobs')), bottom: TabBar(indicatorColor: JR.accent, labelColor: JR.accent, unselectedLabelColor: JR.muted, tabs: [Tab(text: t('jobs.active')), Tab(text: t('jobs.history'))])),
        body: TabBarView(children: [
          _List(provider: activeJobsProvider, lang: lang, emptyTitle: t('jobs.empty')),
          _List(provider: historyJobsProvider, lang: lang, emptyTitle: t('jobs.empty')),
        ]),
      ),
    );
  }
}

class _List extends ConsumerWidget {
  const _List({required this.provider, required this.lang, required this.emptyTitle});
  final FutureProvider<List<Job>> provider;
  final String lang, emptyTitle;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(provider);
    return RefreshIndicator(
      color: JR.accent, onRefresh: () async { ref.invalidate(provider); await ref.read(provider.future); },
      child: AsyncBody(value: v, onRetry: () => ref.invalidate(provider), builder: (list) => list.isEmpty
          ? ListView(children: [SizedBox(height: 300, child: EmptyView(title: emptyTitle, icon: Icons.local_shipping_outlined))])
          : ListView.separated(padding: const EdgeInsets.all(16), itemCount: list.length, separatorBuilder: (_, _) => const SizedBox(height: 12), itemBuilder: (_, i) => JobCard(job: list[i], lang: lang, onTap: () => context.openJob(list[i].offerId)))),
    );
  }
}
