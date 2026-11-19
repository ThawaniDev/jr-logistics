import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/geo.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// The job screen's `_run`: one action at a time, errors toasted unless [handle] consumes them, an ambiguous failure settled by [verify] (re-reading the job).
typedef JobRun = Future<bool> Function(Future<void> Function() fn, {String? success, bool Function(Object e)? handle, bool Function(Job fresh)? verify});

enum _Problem { denied, noFix, locationRequired, tooFar }

/// "I've arrived at the warehouse" with the arrival geofence (E1/E2): the tap asks for location permission and a high-accuracy GPS fix and sends it with
/// the check-in. While the warehouse pin is known it shows the live distance ("340 m from the warehouse — get within 200 m"). A refused permission, a missing fix,
/// `LOCATION_REQUIRED` and `TOO_FAR_FROM_WAREHOUSE {distanceM, radiusM}` are explained right here with the numbers and a retry. When the warehouse does not need to
/// confirm arrivals the server answers `attendance_confirmed` and the driver goes straight to loading; otherwise he waits for the confirmation.
class ArrivalSection extends ConsumerStatefulWidget {
  const ArrivalSection({super.key, required this.job, required this.run, required this.busy});
  final Job job;
  final JobRun run;
  /// Another job action is running.
  final bool busy;
  @override
  ConsumerState<ArrivalSection> createState() => _ArrivalSectionState();
}

class _ArrivalSectionState extends ConsumerState<ArrivalSection> {
  static const _poll = Duration(seconds: 12);
  Timer? _timer;
  double? _distanceM;
  _Problem? _problem;
  ({double dist, double radius})? _tooFar;
  /// Covers the permission prompt and the GPS read, so a second tap cannot start a second check-in.
  bool _working = false;

  JobArrival get _arr => widget.job.arrival;

  @override
  void initState() {
    super.initState();
    if (_arr.geofence && _arr.hasWarehouse) {
      _measure();
      _timer = Timer.periodic(_poll, (_) => _measure());
    }
  }

  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  /// Distance to the warehouse pin from the current fix. Only when the permission is already granted (never prompts on its own).
  Future<void> _measure() async {
    if (_working) return;
    final loc = ref.read(locationServiceProvider);
    try {
      if (!await loc.hasPermission()) return;
      final p = await loc.current();
      if (p != null && mounted) _setDistance(p);
    } catch (_) { /* the next tick tries again */ }
  }

  void _setDistance(LatLng p) {
    final a = _arr;
    if (!a.hasWarehouse) return;
    setState(() => _distanceM = distanceMeters(p.lat, p.lng, a.warehouseLat!, a.warehouseLng!));
  }

  Future<void> _arrive() async {
    if (_working || widget.busy) return;
    final j = widget.job;
    setState(() { _working = true; _problem = null; _tooFar = null; });
    final loc = ref.read(locationServiceProvider);
    double? lat, lng;
    try {
      if (j.arrival.enforced) {
        // The warehouse checks the position: permission and a real fix are required, so say what is missing instead of failing later.
        var granted = await loc.hasPermission();
        if (!granted) granted = await loc.requestPermission();
        if (!mounted) return;
        if (!granted) { setState(() { _working = false; _problem = _Problem.denied; }); return; }
        final p = await loc.current();
        if (!mounted) return;
        if (p == null) { setState(() { _working = false; _problem = _Problem.noFix; }); return; }
        lat = p.lat; lng = p.lng;
        _setDistance(p);
      } else {
        // Not enforced (no geofence / no pin): send the position when we have one — never block on it.
        final p = await loc.current().timeout(const Duration(seconds: 4), onTimeout: () => null);
        lat = p?.lat; lng = p?.lng;
      }
    } catch (_) {
      if (!mounted) return;
      if (j.arrival.enforced) { setState(() { _working = false; _problem = _Problem.noFix; }); return; }
    }
    if (!mounted) return;
    setState(() => _working = false);
    String? status;
    final ok = await widget.run(
      () async { final r = await ref.read(apiProvider).checkIn(j.offerId, lat: lat, lng: lng); status = r['status'] is String ? r['status'] as String : null; },
      verify: (f) => f.status != 'accepted',
      handle: (e) {
        if (e is! ApiException || !mounted) return false;
        if (e.code == 'TOO_FAR_FROM_WAREHOUSE') {
          final d = (e.details['distanceM'] as num?)?.toDouble(), r = (e.details['radiusM'] as num?)?.toDouble();
          if (d != null && r != null) { setState(() { _problem = _Problem.tooFar; _tooFar = (dist: d, radius: r); _distanceM = d; }); return true; }
        }
        if (e.code == 'LOCATION_REQUIRED') { setState(() => _problem = _Problem.locationRequired); return true; }
        return false;
      },
    );
    if (ok && mounted) toast(context, context.tr(status == 'attendance_confirmed' ? 'fma.arrived_confirmed' : status == 'arrived' ? 'fma.arrived_waiting' : 'job.arrived_ok'));
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final a = _arr;
    final working = _working || widget.busy;
    final d = _distanceM;
    final inside = d != null && d <= a.radiusM;
    Widget? distance;
    if (a.geofence && a.hasWarehouse) {
      distance = d == null
          ? Text(t('fma.dist_unknown'), key: const Key('arrival-distance'), style: const TextStyle(color: JR.muted, fontSize: 13.5, height: 1.4))
          : Row(key: const Key('arrival-distance'), crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(inside ? Icons.check_circle : Icons.near_me_outlined, size: 20, color: inside ? JR.accent : JR.gold),
              const SizedBox(width: 8),
              Expanded(child: Text(t(inside ? 'fma.dist_ok' : 'fma.dist_far', {'dist': fmtMeters(t, d), 'radius': fmtMeters(t, a.radiusM)}), style: TextStyle(fontWeight: FontWeight.w700, height: 1.35, color: inside ? JR.accent : JR.gold))),
            ]);
    }
    final retry = OutlinedButton.icon(key: const Key('checkin-retry'), style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: working ? null : _arrive, icon: const Icon(Icons.refresh), label: Text(t('fma.try_again')));
    Widget settings() => TextButton.icon(key: const Key('checkin-settings'), style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings')));
    Widget? problem;
    switch (_problem) {
      case _Problem.denied:
        problem = Banner2(key: const Key('checkin-denied'), tone: Tone.warn, text: t('fma.loc_denied'), action: Wrap(spacing: 8, runSpacing: 4, children: [settings(), retry]));
      case _Problem.noFix:
        problem = Banner2(key: const Key('checkin-nofix'), tone: Tone.warn, text: t('fma.loc_nofix'), action: retry);
      case _Problem.locationRequired:
        problem = Banner2(key: const Key('checkin-location-required'), tone: Tone.warn, text: t('err.LOCATION_REQUIRED'), action: Wrap(spacing: 8, runSpacing: 4, children: [settings(), retry]));
      case _Problem.tooFar:
        final f = _tooFar;
        problem = Banner2(key: const Key('checkin-too-far'), tone: Tone.danger, text: f == null ? t('err.TOO_FAR_FROM_WAREHOUSE') : t('fma.err_too_far', {'dist': fmtMeters(t, f.dist), 'radius': fmtMeters(t, f.radius)}), action: retry);
      case null:
        break;
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (distance != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: distance),
      if (problem != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: problem),
      FilledButton.icon(key: const Key('checkin'), onPressed: working ? null : _arrive, icon: busyIcon(working, Icons.my_location), label: Text(t('act.checkin'))),
    ]);
  }
}
