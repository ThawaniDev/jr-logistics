import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models.dart';
import 'stop_actions.dart';

/// The route map's seam to the per-stop actions. The real work lives in [StopActions] (owned by the stops flow); the popup calls it through this
/// interface so widget tests can substitute a recording fake. Every method that changes something returns `true` when the action was applied on the
/// server — the caller then refreshes the job.
abstract class MapStopActions {
  Future<bool> arrive(BuildContext context, WidgetRef ref, Job job, Stop stop);
  Future<bool> deliver(BuildContext context, WidgetRef ref, Job job, Stop stop);
  Future<bool> cantDeliver(BuildContext context, WidgetRef ref, Job job, Stop stop);
  Future<bool> postpone(BuildContext context, WidgetRef ref, Job job, Stop stop);
  Future<bool> makeNext(BuildContext context, WidgetRef ref, Job job, Stop stop);
  Future<void> navigate(BuildContext context, Stop stop);
  Future<void> call(BuildContext context, Stop stop);
  Future<void> whatsapp(BuildContext context, WidgetRef ref, Job job, Stop stop);
}

/// Forwards to the shared [StopActions].
class StopActionsDelegate implements MapStopActions {
  const StopActionsDelegate();
  @override
  Future<bool> arrive(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.arrive(context, ref, job, stop);
  @override
  Future<bool> deliver(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.deliver(context, ref, job, stop);
  @override
  Future<bool> cantDeliver(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.cantDeliver(context, ref, job, stop);
  @override
  Future<bool> postpone(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.postpone(context, ref, job, stop);
  @override
  Future<bool> makeNext(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.makeNext(context, ref, job, stop);
  @override
  Future<void> navigate(BuildContext context, Stop stop) => StopActions.navigate(context, stop);
  @override
  Future<void> call(BuildContext context, Stop stop) => StopActions.call(context, stop);
  @override
  Future<void> whatsapp(BuildContext context, WidgetRef ref, Job job, Stop stop) => StopActions.whatsapp(context, ref, job, stop);
}

final mapStopActionsProvider = Provider<MapStopActions>((_) => const StopActionsDelegate());
