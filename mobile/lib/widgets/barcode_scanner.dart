import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../services.dart';
import 'common.dart';

// ──────────────────────────── camera scanning (E4) ────────────────────────────
// Every driver-app field that takes a shipment number offers a camera button next to manual typing. The camera itself sits behind the
// small [BarcodeScanner] interface so widget tests never open a real camera (see `FakeBarcodeScanner` in test/helpers.dart).

/// What the caller says about one scanned code in continuous mode: [ok] = accepted (beep + success haptic), else a warning/error feedback.
class ScanVerdict {
  const ScanVerdict(this.ok, [this.message, this.warning = false]);
  final bool ok;
  /// Shown on the camera view for a moment ("Scanned JR-…-007 · 13 of 30" / "Already scanned" / the error).
  final String? message;
  /// A soft problem (e.g. "already scanned") rather than a hard error: amber instead of red.
  final bool warning;
}

typedef ScanHandler = Future<ScanVerdict> Function(String code);

abstract class BarcodeScanner {
  /// Opens the camera. One-shot mode returns the first code seen and closes (null when the driver cancels / chooses to type). In [continuous]
  /// mode the camera stays open, [onCode] is called for every NEW code (de-duplicated) and the driver closes it with "Done"; the result is the last accepted code.
  Future<String?> scan(BuildContext context, {String? title, bool continuous = false, ScanHandler? onCode});
}

class CameraBarcodeScanner implements BarcodeScanner {
  const CameraBarcodeScanner();
  @override
  Future<String?> scan(BuildContext context, {String? title, bool continuous = false, ScanHandler? onCode}) =>
      Navigator.of(context, rootNavigator: true).push<String>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => ScannerPage(title: title, continuous: continuous, onCode: onCode)));
}

final barcodeScannerProvider = Provider<BarcodeScanner>((_) => const CameraBarcodeScanner());

/// Opens the camera scanner (see [BarcodeScanner.scan]). Works from any widget under the app's `ProviderScope`; tests override [barcodeScannerProvider].
Future<String?> scanBarcode(BuildContext context, {String? title, bool continuous = false, ScanHandler? onCode}) =>
    ProviderScope.containerOf(context, listen: false).read(barcodeScannerProvider).scan(context, title: title, continuous: continuous, onCode: onCode);

/// Cleans a scanned/typed code: label scanners add whitespace and line breaks.
String normalizeScan(String raw) => raw.trim().replaceAll(RegExp(r'\s+'), ' ');

/// Cameras report the same barcode many times a second: a code is accepted once, then ignored for [window].
class ScanDeduper {
  ScanDeduper({this.window = const Duration(seconds: 3)});
  final Duration window;
  final Map<String, DateTime> _seen = {};
  bool accept(String code, [DateTime? now]) {
    final t = now ?? DateTime.now();
    final last = _seen[code];
    if (last != null && t.difference(last) < window) return false;
    _seen[code] = t;
    return true;
  }
}

/// The text field every shipment-number input uses: the usual field plus a camera button. Manual entry always works (also when the camera is
/// denied or missing). [fieldKey] goes on the inner TextField, the camera button is `Key('<fieldKey>-scan')`.
class ScanField extends StatefulWidget {
  const ScanField({super.key, required this.controller, this.fieldKey, this.label, this.helper, this.enabled = true, this.onChanged, this.onSubmitted, this.onScanned, this.scanTitle, this.textInputAction = TextInputAction.next, this.focusNode, this.prefixIcon = Icons.qr_code_2, this.textStyle});
  final TextEditingController controller;
  final Key? fieldKey;
  final String? label, helper, scanTitle;
  final bool enabled;
  final ValueChanged<String>? onChanged, onSubmitted;
  /// Called after a camera scan filled the field (in addition to [onChanged]).
  final ValueChanged<String>? onScanned;
  final TextInputAction textInputAction;
  final FocusNode? focusNode;
  final IconData prefixIcon;
  final TextStyle? textStyle;
  @override
  State<ScanField> createState() => _ScanFieldState();
}

class _ScanFieldState extends State<ScanField> {
  FocusNode? _own;
  FocusNode get _focus => widget.focusNode ?? (_own ??= FocusNode());
  @override
  void dispose() { _own?.dispose(); super.dispose(); }

  Future<void> _scan() async {
    final code = await scanBarcode(context, title: widget.scanTitle ?? widget.label);
    if (!mounted) return;
    if (code == null) { _focus.requestFocus(); return; } // cancelled / "type it instead": the keyboard is the next step
    final c = normalizeScan(code);
    widget.controller.value = TextEditingValue(text: c, selection: TextSelection.collapsed(offset: c.length));
    widget.onChanged?.call(c);
    widget.onScanned?.call(c);
  }

  @override
  Widget build(BuildContext context) {
    final k = widget.fieldKey;
    final scanKey = k is ValueKey<String> ? Key('${k.value}-scan') : const Key('scan-button');
    return TextField(
      key: widget.fieldKey, controller: widget.controller, focusNode: _focus, enabled: widget.enabled, textInputAction: widget.textInputAction, textCapitalization: TextCapitalization.characters,
      textDirection: TextDirection.ltr, autocorrect: false, enableSuggestions: false, inputFormatters: const [LatinDigitsFormatter()], style: widget.textStyle,
      onChanged: widget.onChanged, onSubmitted: widget.onSubmitted,
      decoration: InputDecoration(
        labelText: widget.label, helperText: widget.helper, helperMaxLines: 3, prefixIcon: Icon(widget.prefixIcon),
        suffixIcon: IconButton(key: scanKey, tooltip: context.tr('fma.scan_camera'), constraints: const BoxConstraints(minWidth: 48, minHeight: 48), icon: Icon(Icons.photo_camera_outlined, color: JR.accent), onPressed: widget.enabled ? _scan : null),
      ),
    );
  }
}

// ──────────────────────────── the camera page ────────────────────────────

class ScannerPage extends ConsumerStatefulWidget {
  const ScannerPage({super.key, this.title, this.continuous = false, this.onCode});
  final String? title;
  final bool continuous;
  final ScanHandler? onCode;
  @override
  ConsumerState<ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends ConsumerState<ScannerPage> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates, formats: const [], torchEnabled: false);
  final _dedupe = ScanDeduper();
  bool _busy = false, _closing = false;
  String? _lastOk;
  ScanVerdict? _verdict;
  Timer? _verdictTimer;

  @override
  void dispose() { _verdictTimer?.cancel(); _controller.dispose(); super.dispose(); }

  void _close([String? result]) {
    if (_closing) return;
    _closing = true;
    if (mounted) Navigator.of(context).pop(result);
  }

  Future<void> _onDetect(BarcodeCapture cap) async {
    if (_busy || _closing) return;
    for (final b in cap.barcodes) {
      final raw = b.rawValue ?? b.displayValue;
      if (raw == null) continue;
      final code = normalizeScan(raw);
      if (code.isEmpty || !_dedupe.accept(code)) continue;
      await _handle(code);
      break;
    }
  }

  Future<void> _handle(String code) async {
    _busy = true;
    try {
      if (!widget.continuous) {
        haptic(HapticKind.success);
        SystemSound.play(SystemSoundType.click);
        _close(code);
        return;
      }
      ScanVerdict v;
      try { v = await widget.onCode?.call(code) ?? const ScanVerdict(true); } catch (_) { v = ScanVerdict(false, mounted ? context.tr('err.INTERNAL') : null); }
      if (!mounted) return;
      if (v.ok) { _lastOk = code; haptic(HapticKind.success); SystemSound.play(SystemSoundType.click); } else { haptic(HapticKind.warning); }
      setState(() => _verdict = v);
      _verdictTimer?.cancel();
      _verdictTimer = Timer(const Duration(milliseconds: 2800), () { if (mounted) setState(() => _verdict = null); });
    } finally {
      _busy = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final v = _verdict;
    final vColor = v == null ? JR.accent : v.ok ? JR.accent : v.warning ? JR.gold : JR.danger;
    // The camera surface is black in both modes: light status-bar icons whatever the app theme.
    return AnnotatedRegion<SystemUiOverlayStyle>(value: systemOverlayFor(Brightness.dark, navigationBar: false), child: Scaffold(
      backgroundColor: JR.mediaBg,
      body: Stack(fit: StackFit.expand, children: [
        MobileScanner(
          controller: _controller, onDetect: _onDetect,
          errorBuilder: (c, e) => ScanErrorView(denied: e.errorCode == MobileScannerErrorCode.permissionDenied, onType: () => _close()),
          overlayBuilder: (c, box) => const _ScanFrame(),
        ),
        SafeArea(child: Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(4, 4, 4, 0), child: Row(children: [
            IconButton(key: const Key('scan-close'), tooltip: t('fma.scan_close'), color: JR.mediaFg, iconSize: 28, constraints: const BoxConstraints(minWidth: 48, minHeight: 48), icon: const Icon(Icons.close), onPressed: () => _close()),
            Expanded(child: Text(widget.title ?? t('fma.scan_title'), maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: TextStyle(color: JR.mediaFg, fontSize: 17, fontWeight: FontWeight.w700))),
            ValueListenableBuilder<MobileScannerState>(valueListenable: _controller, builder: (c, st, _) => IconButton(
              key: const Key('scan-torch'), tooltip: t('fma.scan_torch'), color: JR.mediaFg, iconSize: 28, constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              icon: Icon(st.torchState == TorchState.on ? Icons.flash_on : Icons.flash_off), onPressed: st.torchState == TorchState.unavailable || !st.isRunning ? null : () => _controller.toggleTorch(),
            )),
          ])),
          const Spacer(),
          if (v?.message != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Container(
            key: const Key('scan-verdict'), width: double.infinity, padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: vColor.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(12)),
            child: Row(children: [Icon(v!.ok ? Icons.check_circle : Icons.error_outline, color: JR.accentInk), const SizedBox(width: 10), Expanded(child: Text(v.message!, style: TextStyle(color: JR.accentInk, fontWeight: FontWeight.w700, height: 1.3)))]),
          )),
          Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 12), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(t('fma.scan_hint'), textAlign: TextAlign.center, style: TextStyle(color: JR.mediaFgSoft, height: 1.35)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: TextButton.icon(key: const Key('scan-type'), style: TextButton.styleFrom(foregroundColor: JR.mediaFg, minimumSize: const Size(0, 48)), onPressed: () => _close(), icon: const Icon(Icons.keyboard_outlined), label: Text(t('fma.scan_type_instead'), textAlign: TextAlign.center))),
              if (widget.continuous) ...[const SizedBox(width: 8), Expanded(child: FilledButton(key: const Key('scan-done'), style: FilledButton.styleFrom(minimumSize: const Size(0, 52)), onPressed: () => _close(_lastOk), child: Text(t('fma.scan_done'))))],
            ]),
          ])),
        ])),
      ]),
    ));
  }
}

/// Camera unusable: refused permission (fix in Settings) or any other failure — either way typing the code still works.
class ScanErrorView extends ConsumerWidget {
  const ScanErrorView({super.key, required this.denied, required this.onType});
  final bool denied;
  final VoidCallback onType;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    return Container(
      key: const Key('scan-error'), color: JR.mediaBg, padding: const EdgeInsets.all(24), alignment: Alignment.center,
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.no_photography_outlined, size: 56, color: JR.mediaGold),
        const SizedBox(height: 14),
        Text(t(denied ? 'fma.scan_denied' : 'fma.scan_unavailable'), textAlign: TextAlign.center, style: TextStyle(color: JR.mediaFg, fontSize: 16, height: 1.4)),
        const SizedBox(height: 18),
        if (denied) FilledButton.icon(key: const Key('scan-open-settings'), onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings'))),
        const SizedBox(height: 10),
        OutlinedButton.icon(key: const Key('scan-type-error'), style: OutlinedButton.styleFrom(foregroundColor: JR.mediaFg, side: BorderSide(color: JR.mediaFgFaint), minimumSize: const Size(0, 52)), onPressed: onType, icon: const Icon(Icons.keyboard_outlined), label: Text(t('fma.scan_type_instead'), textAlign: TextAlign.center)),
      ])),
    );
  }
}

/// Dimmed camera with a clear rounded frame in the middle: where to hold the barcode.
class _ScanFrame extends StatelessWidget {
  const _ScanFrame();
  @override
  Widget build(BuildContext context) => IgnorePointer(child: CustomPaint(painter: _FramePainter(), size: Size.infinite));
}

class _FramePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width * 0.78, h = (size.width * 0.5).clamp(120.0, size.height * 0.4);
    final frame = RRect.fromRectAndRadius(Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.42), width: w, height: h), const Radius.circular(18));
    final dim = Path()..addRect(Offset.zero & size)..addRRect(frame)..fillType = PathFillType.evenOdd;
    canvas.drawPath(dim, Paint()..color = JR.mediaBg.withValues(alpha: 0.5));
    canvas.drawRRect(frame, Paint()..color = JR.mediaAccent..style = PaintingStyle.stroke..strokeWidth = 3);
  }

  @override
  bool shouldRepaint(_FramePainter old) => true; // cheap, and keeps the frame in step with any palette change
}
