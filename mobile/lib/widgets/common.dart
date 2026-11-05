import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../data/api_client.dart';

String errMessage(BuildContext c, Object e) {
  if (e is ApiException) {
    final key = 'err.${e.code}';
    if (c.tr.has(key)) return c.tr(key);
    if (e.isNetwork) return c.tr('m.offline_banner');
    return e.message;
  }
  return c.tr('err.INTERNAL');
}

void toast(BuildContext c, String msg, {bool error = false}) {
  ScaffoldMessenger.of(c)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Row(children: [Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: error ? JR.danger : JR.accent, size: 20), const SizedBox(width: 10), Expanded(child: Text(msg))])));
}

/// Runs [fn], shows a localized error toast on failure. Returns the result or null.
Future<T?> guarded<T>(BuildContext c, Future<T> Function() fn, {String? success}) async {
  try {
    final r = await fn();
    if (success != null && c.mounted) toast(c, c.tr(success));
    return r;
  } catch (e) {
    if (c.mounted) toast(c, errMessage(c, e), error: true);
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
      child: Text(text, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
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
  Widget build(BuildContext context) => Pill(context.tr('jobstatus.$status'), tone: jobTone(status));
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
            if (hint != null) ...[const SizedBox(height: 6), Text(hint!, textAlign: TextAlign.center, style: const TextStyle(color: JR.muted))],
          ]),
        ),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 48, color: JR.danger), const SizedBox(height: 12),
            Text(errMessage(context, error), textAlign: TextAlign.center), const SizedBox(height: 16),
            SizedBox(width: 180, child: OutlinedButton(onPressed: onRetry, child: Text(context.tr('common.retry')))),
          ]),
        ),
      );
}

class Banner2 extends StatelessWidget {
  const Banner2({super.key, required this.text, this.tone = Tone.info, this.title, this.action});
  final String text;
  final String? title;
  final Tone tone;
  final Widget? action;
  @override
  Widget build(BuildContext context) {
    final c = switch (tone) { Tone.success => JR.accent, Tone.warn => JR.gold, Tone.danger => JR.danger, _ => JR.cyan };
    return Container(
      width: double.infinity, padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: c.withValues(alpha: 0.4))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (title != null) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(title!, style: TextStyle(color: c, fontWeight: FontWeight.w700))),
        Text(text, style: const TextStyle(height: 1.4)),
        if (action != null) Padding(padding: const EdgeInsets.only(top: 10), child: action),
      ]),
    );
  }
}

/// Async data wrapper: skeleton while loading, retry on error, pull-to-refresh friendly.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.onRetry, required this.builder});
  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(T data) builder;
  @override
  Widget build(BuildContext context) => value.when(
        data: builder,
        loading: () => const Center(child: CircularProgressIndicator(color: JR.accent)),
        error: (e, _) => ErrorView(error: e, onRetry: onRetry),
      );
}
