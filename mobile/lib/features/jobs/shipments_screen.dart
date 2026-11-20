import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'route_map_screen.dart';
import 'shipments_view.dart';

/// All shipments of a job as a run sheet in its own page: back arrow, the job reference, and — only while routing is on — the route icon (the map).
/// With routing OFF the job page itself is the run sheet ([ShipmentsView]); this page is the overview a driver can open from the one-stop-at-a-time flow.
class ShipmentsScreen extends ConsumerWidget {
  const ShipmentsScreen({super.key, required this.offerId});
  final String offerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lang = ref.watch(localeProvider);
    final job = ref.watch(jobProvider(offerId));
    final j = job.value;
    Future<void> reload() async { ref.invalidate(jobProvider(offerId)); await ref.read(jobProvider(offerId).future); }
    return Scaffold(
      appBar: AppBar(title: Text(j?.ref ?? context.tr('drs.all_shipments'), textDirection: TextDirection.ltr), actions: [
        if (j != null && j.routingEnabled && j.manifest) IconButton(key: const Key('drs-route'), tooltip: context.tr('fmb.map_btn'), icon: const Icon(Icons.map_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => RouteMapScreen(offerId: offerId)))),
      ]),
      body: RefreshIndicator(color: JR.accent, onRefresh: reload, child: AsyncBody(value: job, onRetry: () => ref.invalidate(jobProvider(offerId)), builder: (j) => ShipmentsView(job: j, lang: lang))),
    );
  }
}
