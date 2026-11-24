import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../data/api_client.dart';


/// Localized, driver-readable text for any failure. Never shows raw server/Dart text: every API code maps to `err.<CODE>`,
/// connectivity problems to the `um.err_*` family, and anything unknown to a generic line that carries the code for support.
String errMessage(BuildContext c, Object e) {
  final t = c.tr;
  if (e is ApiException) {
    // A few per-parcel errors carry numbers the driver needs ("N tries left", "wait 3:20"): use the richer message.
    final left = numOf(e.details['attemptsLeft'])?.toInt();
    if (e.code == 'OTP_INVALID' && left != null) return left <= 0 ? t('err.OTP_LOCKED') : t('ms.otp_wrong', {'n': left});
    final wait = numOf(e.details['remainingSec'])?.toInt();
    if (e.code == 'WAIT_REQUIRED' && wait != null) return t('ms.wait_required', {'time': fmtCountdown(wait)});
    if (e.code == 'VALIDATION') {
      final field = e.details['field'];
      // Per-parcel delivery validation: say exactly what is wrong instead of "some details are invalid".
      if (field == 'code') return t('um.err_parcel_code');
      if (field == 'proof') return t('um.err_proof');
      if (field == 'receiverName') return t('um.err_receiver');
    }
    switch (e.code) {
      case 'NETWORK': return t('um.err_network');
      case 'TIMEOUT': return t('um.err_timeout');
      case 'UNAVAILABLE': return t('um.err_unavailable');
      case 'BAD_RESPONSE': return t('um.err_bad_response');
      case 'FILE_TOO_LARGE': return t('um.err_file_big');
    }
    final key = 'err.${e.code}';
    if (t.has(key)) return t(key);
    return t('um.err_generic', {'code': e.code});
  }
  return t('err.INTERNAL');
}

/// Short physical feedback for key moments (a confirmed delivery, a rejected code). Never throws, never awaited.
void haptic([HapticKind kind = HapticKind.light]) {
  final f = switch (kind) { HapticKind.light => HapticFeedback.lightImpact(), HapticKind.success => HapticFeedback.mediumImpact(), HapticKind.warning => HapticFeedback.heavyImpact(), HapticKind.select => HapticFeedback.selectionClick() };
  f.catchError((_) {});
}

enum HapticKind { light, success, warning, select }

/// City display name from the shared dictionary; an unknown/empty key never renders as a raw "city.xyz" string.
String cityLabel(BuildContext c, String? key) => key == null || key.isEmpty ? '' : (c.tr.has('city.$key') ? c.tr('city.$key') : key);

void toast(BuildContext c, String msg, {bool error = false, bool quiet = false}) {
  if (!quiet) haptic(error ? HapticKind.warning : HapticKind.success);
  ScaffoldMessenger.of(c)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      duration: Duration(seconds: error ? 6 : 4),
      content: Semantics(liveRegion: true, child: Row(children: [Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: error ? JR.danger : JR.accent, size: 20), const SizedBox(width: 10), Expanded(child: Text(msg))])),
    ));
}

/// Runs [fn], shows a localized error toast on failure. Returns the result or null.
/// [maybeApplied]: [fn] is a write that is not idempotent (accept, send a message, open a ticket, upload a document). When the answer never came back
/// the server may well have done it, so the toast says "we couldn't confirm it" (`m.net_unconfirmed_write`) instead of "check your connection" and
/// the caller re-reads the list — a blind retry would duplicate the message / ticket / upload.
/// [handle] sees the failure first: returning true means "I showed something better" (a dialog with what to do), so no toast is raised.
Future<T?> guarded<T>(BuildContext c, Future<T> Function() fn, {String? success, bool maybeApplied = false, bool Function(Object error)? handle}) async {
  try {
    final r = await fn();
    if (success != null && c.mounted) toast(c, c.tr(success));
    return r;
  } catch (e) {
    if (c.mounted && handle?.call(e) != true) toast(c, maybeApplied && e is ApiException && e.isNetwork ? c.tr('m.net_unconfirmed_write') : errMessage(c, e), error: true);
    return null;
  }
}

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.border, this.onTap});
  final Widget child;
  final EdgeInsets padding;
  final Color? border;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final card = Container(
      width: double.infinity, padding: padding,
      decoration: BoxDecoration(color: JR.card, borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: border ?? JR.line, width: border != null ? 1.5 : 1)),
      child: child,
    );
    return onTap == null ? card : Material(color: Colors.transparent, child: InkWell(borderRadius: BorderRadius.circular(JR.radius), onTap: onTap, child: card));
  }
}

enum Tone { success, info, warn, danger, neutral }

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = Tone.neutral});
  final String text;
  final Tone tone;
  @override
  Widget build(BuildContext context) {
    final c = switch (tone) { Tone.success => JR.accent, Tone.info => JR.cyan, Tone.warn => JR.gold, Tone.danger => JR.danger, Tone.neutral => JR.muted };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99), border: Border.all(color: c.withValues(alpha: 0.4))),
      child: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

Tone jobTone(String s) => switch (s) {
      'completed' => Tone.success,
      'offered' || 'accepted' || 'arrived' => Tone.info,
      'attendance_confirmed' || 'delivered_reported' || 'pending_settlement' => Tone.warn,
      'qty_disputed' || 'cancelled' || 'no_show' || 'rejected' => Tone.danger,
      _ => Tone.neutral,
    };

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) => Pill(context.tr.val('jobstatus', status), tone: jobTone(status));
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.title, this.hint, this.icon = Icons.inbox_outlined});
  final String title;
  final String? hint;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 48, color: JR.muted), const SizedBox(height: 12),
            Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            if (hint != null) ...[const SizedBox(height: 6), Text(hint!, textAlign: TextAlign.center, style: TextStyle(color: JR.muted))],
          ]),
        ),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final offline = error is ApiException && (error as ApiException).isNetwork;
    final body = Padding(
      padding: const EdgeInsets.all(32),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(offline ? Icons.cloud_off_outlined : Icons.error_outline, size: 48, color: offline ? JR.gold : JR.danger), const SizedBox(height: 12),
        Semantics(liveRegion: true, child: Text(errMessage(context, error), textAlign: TextAlign.center, style: const TextStyle(height: 1.4))), const SizedBox(height: 16),
        SizedBox(width: 200, child: OutlinedButton.icon(key: const Key('retry'), onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(context.tr('common.retry')))),
      ]),
    );
    // Scrollable so pull-to-refresh still works on an error screen (when the parent gives us a bounded height).
    return LayoutBuilder(builder: (context, c) => !c.hasBoundedHeight
        ? Center(child: body)
        : SingleChildScrollView(physics: const AlwaysScrollableScrollPhysics(), child: ConstrainedBox(constraints: BoxConstraints(minHeight: c.maxHeight), child: Center(child: body))));
  }
}

class Banner2 extends StatelessWidget {
  const Banner2({super.key, required this.text, this.tone = Tone.info, this.title, this.action, this.icon});
  final String text;
  final IconData? icon;
  final String? title;
  final Tone tone;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final c = switch (tone) { Tone.success => JR.accent, Tone.warn => JR.gold, Tone.danger => JR.danger, _ => JR.cyan };
    return Semantics(container: true, liveRegion: tone == Tone.danger, child: Container(
      width: double.infinity, padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: c.withValues(alpha: 0.4))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (title != null || icon != null) Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: [
          if (icon != null) Padding(padding: const EdgeInsetsDirectional.only(end: 8), child: Icon(icon, size: 22, color: c)),
          if (title != null) Expanded(child: Text(title!, style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: icon != null ? 22 : null), textDirection: icon != null ? TextDirection.ltr : null)),
        ])),
        Text(text, style: const TextStyle(height: 1.4)),
        if (action != null) Padding(padding: const EdgeInsets.only(top: 10), child: action),
      ]),
    ));
  }
}

/// Async data wrapper: spinner while loading, retry on error, and — crucially on a weak signal — if a background refresh fails
/// while data is already on screen, KEEP the data (and anything typed into it) and show a slim "stale" strip instead of an error page.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.onRetry, required this.builder});
  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(T data) builder;
  @override
  Widget build(BuildContext context) {
    final v = value;
    if (v.hasValue) {
      // Data on screen — fresh, refreshing, or stale after a failed refresh. The SAME tree shape in all three, with the body keyed,
      // so a strip appearing/disappearing never remounts the page (that would throw away what the driver was typing).
      final err = v.hasError ? (v.error ?? 'error') : null;
      return LayoutBuilder(builder: (context, c) {
        final body = KeyedSubtree(key: const ValueKey('async-body'), child: builder(v.requireValue));
        return Column(mainAxisSize: c.hasBoundedHeight ? MainAxisSize.max : MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (err != null) StaleStrip(key: const ValueKey('async-strip'), error: err, onRetry: onRetry),
          if (c.hasBoundedHeight) Expanded(child: body) else body,
        ]);
      });
    }
    return v.when(
      data: builder,
      loading: () => Center(child: CircularProgressIndicator(color: JR.accent)),
      error: (e, _) => ErrorView(error: e, onRetry: onRetry),
    );
  }
}

/// "Couldn't refresh — showing the last loaded data" with a retry button.
class StaleStrip extends StatelessWidget {
  const StaleStrip({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final offline = error is ApiException && (error as ApiException).isNetwork;
    return Material(
      color: JR.gold.withValues(alpha: 0.14),
      child: Semantics(liveRegion: true, container: true, child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(14, 4, 4, 4),
        child: Row(children: [
          Icon(offline ? Icons.cloud_off_outlined : Icons.sync_problem_outlined, size: 18, color: JR.gold), const SizedBox(width: 10),
          Expanded(child: Text(offline ? t('m.offline_banner') : t('um.stale_generic'), key: const Key('stale-strip'), style: const TextStyle(fontSize: 13, height: 1.3))),
          TextButton(key: const Key('stale-retry'), style: TextButton.styleFrom(minimumSize: const Size(64, 48)), onPressed: onRetry, child: Text(t('common.retry'))),
        ]),
      )),
    );
  }
}

/// Global strip under the status bar while the last request failed for lack of connectivity (cleared by the next successful call).
class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return Material(
      color: JR.warnBg,
      child: Semantics(liveRegion: true, container: true, child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(14, 2, 4, 2),
        child: Row(children: [
          Icon(Icons.wifi_off_rounded, size: 18, color: JR.gold), const SizedBox(width: 10),
          Expanded(child: Text(t('um.offline_strip'), key: const Key('offline-strip'), style: TextStyle(fontSize: 13, height: 1.3, color: JR.text))),
          TextButton(key: const Key('offline-retry'), style: TextButton.styleFrom(minimumSize: const Size(64, 48)), onPressed: onRetry, child: Text(t('common.retry'))),
        ]),
      )),
    );
  }
}

/// Rebuilds every second until [deadline] passes, handing [builder] the whole seconds left (0 = reached).
/// Remaining time is the smaller of "wall clock to the deadline" and "seconds we had at the start minus ticks seen": the wall clock
/// keeps it right after the app was backgrounded (timers pause), the tick count keeps it moving if the device clock is changed.
class DeadlineBuilder extends StatefulWidget {
  const DeadlineBuilder({super.key, required this.deadline, required this.builder});
  final DateTime deadline;
  final Widget Function(BuildContext context, int remainingSec) builder;
  @override
  State<DeadlineBuilder> createState() => _DeadlineBuilderState();
}

class _DeadlineBuilderState extends State<DeadlineBuilder> {
  Timer? _timer;
  int _ticks = 0;
  late int _base = _wall;
  int get _wall => (widget.deadline.difference(DateTime.now()).inMilliseconds / 1000).ceil().clamp(0, 1 << 30);
  int get _remaining { final byTicks = (_base - _ticks).clamp(0, 1 << 30); final w = _wall; return w < byTicks ? w : byTicks; }

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) { _ticks++; if (mounted) setState(() {}); });
  }

  @override
  void didUpdateWidget(DeadlineBuilder old) {
    super.didUpdateWidget(old);
    if (old.deadline != widget.deadline) { _ticks = 0; _base = _wall; } // a fresher deadline from the server replaces the old estimate
  }

  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => widget.builder(context, _remaining);
}

/// "Load more" under a list the server pages (finished jobs, wallet history, notifications): one tap loads the next page, a spinner shows meanwhile
/// (a second tap is ignored) and a failure is a localized toast — the rows already shown stay.
class LoadMoreButton extends StatefulWidget {
  const LoadMoreButton({super.key, required this.onLoad});
  final Future<void> Function() onLoad;
  @override
  State<LoadMoreButton> createState() => _LoadMoreButtonState();
}

class _LoadMoreButtonState extends State<LoadMoreButton> {
  bool _busy = false;
  Future<void> _go() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onLoad();
    } catch (e) {
      if (mounted) toast(context, errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: OutlinedButton.icon(key: const Key('load-more'), onPressed: _busy ? null : _go, icon: busyIcon(_busy, Icons.expand_more, color: JR.accent), label: Text(context.tr('dtk.load_more'))),
      );
}

/// A button icon that turns into a spinner while [busy] (so a tap visibly "took" and cannot be repeated).
Widget busyIcon(bool busy, IconData icon, {Color? color}) => busy
    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: color ?? JR.accentInk))
    : Icon(icon);
