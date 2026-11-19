import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// Offers that have a stop/route action running. ONE flag per job, shared by the stops screen and the route-map popup, so a second action can
/// never start while the first is still in flight (a repeated deliver/fail could double-apply).
class StopBusyNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};
  bool begin(String offerId) {
    if (state.contains(offerId)) return false;
    state = {...state, offerId};
    return true;
  }
  void end(String offerId) { if (state.contains(offerId)) state = {...state}..remove(offerId); }
}

final stopBusyProvider = NotifierProvider<StopBusyNotifier, Set<String>>(StopBusyNotifier.new);

/// Localised text for a failure of a stop / arrival / loading action: the numbers the driver needs ("340 m", "SAR 120.00") come from the error details;
/// everything else goes through the app-wide mapper ([errMessage]).
String stopErrMessage(BuildContext c, Object e) {
  final t = c.tr;
  if (e is ApiException) {
    final d = e.details;
    switch (e.code) {
      case 'TOO_FAR_FROM_WAREHOUSE':
        final dist = (d['distanceM'] as num?)?.toDouble(), r = (d['radiusM'] as num?)?.toDouble();
        if (dist != null && r != null) return t('fma.err_too_far', {'dist': fmtMeters(t, dist), 'radius': fmtMeters(t, r)});
      case 'CASH_MISMATCH':
        final due = (d['expectedCents'] as num?)?.toInt();
        if (due != null) return t('fma.err_cash_mismatch', {'amount': fmtMoney(due, t.code)});
      case 'EVIDENCE_REQUIRED':
        final note = d['note'] == true, photo = d['photo'] == true;
        if (note && photo) return t('fma.err_evidence_both');
        if (note) return t('fma.err_evidence_note');
        if (photo) return t('fma.err_evidence_photo');
      case 'VALIDATION':
        switch (d['field']) {
          case 'order': return t('fma.err_order');
          case 'codes': return t('fma.finish_none');
        }
    }
  }
  return errMessage(c, e);
}

/// Where the driver is, for the audit trail only. Capped at 4 s so a weak GPS never makes a delivery feel stuck; null without permission/fix.
Future<({double? lat, double? lng})> stopWhere(LocationService loc) async {
  try {
    final p = await loc.current().timeout(const Duration(seconds: 4), onTimeout: () => null);
    return (lat: p?.lat, lng: p?.lng);
  } catch (_) {
    return (lat: null, lng: null);
  }
}

/// Runs [fn] exactly once at a time per job. On failure it shows the localized error — as a toast, or through [onError] when the caller shows it
/// inline (sheets do: a toast would hide behind them) — unless [handle] consumes the error. The job is ALWAYS refreshed afterwards so the next stop becomes current.
///
/// Poor-network safety: when the failure is ambiguous (connection dropped / timeout / 5xx — the server may have applied the action although we never
/// saw the answer) and [verify] is given, the job is re-read and [verify] decides whether the action already happened. If it did, this counts as
/// success (no scary error, no duplicate). If we cannot even re-read, we say honestly that the outcome is unconfirmed instead of claiming failure.
///
/// [skipRefresh] says a failure changed nothing, so the job is not re-read.
/// The caller's [context] must stay mounted while this runs (after it is gone the result is still applied and the providers refreshed, but nothing is shown).
Future<bool> runStopAction(
  BuildContext context, WidgetRef ref, String offerId, Future<void> Function() fn, {
  String? success, bool Function(Object e)? handle, bool Function(Job fresh)? verify, void Function(String message)? onError, bool Function(Object e)? skipRefresh,
}) async {
  final container = ProviderScope.containerOf(context, listen: false);
  if (!container.read(stopBusyProvider.notifier).begin(offerId)) return false; // single flight, even if a button somehow fires twice
  var ok = false;
  Object? failure;
  try {
    await fn();
    ok = true;
    if (success != null && context.mounted) toast(context, context.tr(success));
  } catch (e) {
    failure = e;
    final applied = verify == null ? false : await _alreadyApplied(container, offerId, e, verify);
    if (applied == true) {
      ok = true;
      failure = null;
      if (success != null && context.mounted) toast(context, context.tr(success));
    } else if (context.mounted && !(handle?.call(e) ?? false)) {
      final unknown = e is ApiException && e.isNetwork && verify != null && applied == null;
      final msg = unknown ? context.tr('um.net_unconfirmed') : stopErrMessage(context, e);
      if (onError != null) { haptic(HapticKind.warning); onError(msg); } else { toast(context, msg, error: true); }
    }
  }
  // [skipRefresh]: a failure that cannot have changed anything (e.g. "too many re-plans") needs no re-read.
  if (failure == null || !(skipRefresh?.call(failure) ?? false)) {
    if (context.mounted) {
      refreshAll(ref);
    } else {
      for (final p in [overviewProvider, offersProvider, activeJobsProvider, historyJobsProvider, opportunitiesProvider, walletProvider]) { container.invalidate(p); }
    }
    container.invalidate(jobProvider(offerId));
  }
  container.read(stopBusyProvider.notifier).end(offerId);
  return ok;
}

/// true = the server already did it · false = it did not · null = could not find out.
Future<bool?> _alreadyApplied(ProviderContainer c, String offerId, Object e, bool Function(Job fresh) verify) async {
  final ambiguous = e is ApiException && (e.isTransient || const {'INTERNAL', 'STOP_LOCKED', 'INVALID_TRANSITION', 'CONFLICT'}.contains(e.code));
  if (!ambiguous) return false;
  try {
    final fresh = await c.read(apiProvider).job(offerId).timeout(const Duration(seconds: 8));
    return verify(fresh);
  } catch (_) {
    return null;
  }
}

Stop? stopIn(Job job, String id) { for (final x in job.stops) { if (x.id == id) return x; } return null; }
