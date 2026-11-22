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
          _ActiveJobs(lang: lang, emptyTitle: t('jobs.empty')),
          // The server pages the history at 100 jobs: older ones are loaded on demand. (Its own widget: the list is only requested when the tab is built.)
          _HistoryJobs(lang: lang, emptyTitle: t('jobs.empty')),
        ]),
      ),
    );
  }
}

class _ActiveJobs extends ConsumerWidget {
  const _ActiveJobs({required this.lang, required this.emptyTitle});
  final String lang, emptyTitle;
  @override
  Widget build(BuildContext context, WidgetRef ref) => _List(
        value: ref.watch(activeJobsProvider), lang: lang, emptyTitle: emptyTitle,
        onRefresh: () { ref.invalidate(activeJobsProvider); return ref.read(activeJobsProvider.future); },
      );
}

class _HistoryJobs extends ConsumerWidget {
  const _HistoryJobs({required this.lang, required this.emptyTitle});
  final String lang, emptyTitle;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(historyJobsProvider);
    final notifier = ref.read(historyJobsProvider.notifier);
    return _List(
      value: value, lang: lang, emptyTitle: emptyTitle,
      onRefresh: () { ref.invalidate(historyJobsProvider); return ref.read(historyJobsProvider.future); },
      hasMore: notifier.hasMore, onLoadMore: notifier.loadMore,
    );
  }
}

class _List extends StatelessWidget {
  const _List({required this.value, required this.lang, required this.emptyTitle, required this.onRefresh, this.hasMore = false, this.onLoadMore});
  final AsyncValue<List<Job>> value;
  final String lang, emptyTitle;
  /// Reloads the list and completes when it is there (pull to refresh, retry).
  final Future<void> Function() onRefresh;
  /// More jobs wait on the server: a "Load more" row closes the list.
  final bool hasMore;
  final Future<void> Function()? onLoadMore;
  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: JR.accent, onRefresh: onRefresh,
      child: AsyncBody(value: value, onRetry: () { onRefresh().ignore(); }, builder: (list) => list.isEmpty
          ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [SizedBox(height: 300, child: EmptyView(title: emptyTitle, icon: Icons.local_shipping_outlined))])
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), itemCount: list.length + (hasMore && onLoadMore != null ? 1 : 0), separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (_, i) => i == list.length ? LoadMoreButton(onLoad: onLoadMore!) : JobCard(job: list[i], lang: lang, onTap: () => context.openJob(list[i].offerId)))),
    );
  }
}
