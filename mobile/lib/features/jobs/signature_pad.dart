import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';

/// The strokes of a drawn signature. Coordinates are in the pad's own pixels; [toPng] scales them to a fixed export width.
class SignatureController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;
  bool _drawing = false;

  List<List<Offset>> get strokes => List.unmodifiable(_strokes);

  /// A real signature, not an accidental tap: at least a short line was drawn.
  bool get hasSignature {
    var len = 0.0;
    for (final s in _strokes) { for (var i = 1; i < s.length; i++) { len += (s[i] - s[i - 1]).distance; } }
    return len >= 24;
  }

  void setSize(Size s) { _size = s; }

  void start(Offset p) { _strokes.add([p]); _drawing = true; notifyListeners(); }
  void add(Offset p) { if (_drawing && _strokes.isNotEmpty) { _strokes.last.add(p); notifyListeners(); } }
  void end() { _drawing = false; notifyListeners(); }
  void undo() { if (_strokes.isNotEmpty) { _strokes.removeLast(); notifyListeners(); } }
  void clear() { if (_strokes.isNotEmpty) { _strokes.clear(); notifyListeners(); } }

  /// Draws the signature in black on white (readable on any receipt/screen) and encodes it as PNG, [width] px wide. Null when nothing was drawn.
  Future<Uint8List?> toPng({int width = 600}) async {
    if (!hasSignature || _size.isEmpty) return null;
    final scale = width / _size.width;
    final height = (_size.height * scale).round();
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec, Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()));
    canvas.drawRect(Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()), Paint()..color = JR.paper);
    paintSignature(canvas, _strokes, scale: scale, color: JR.ink);
    final img = await rec.endRecording().toImage(width, height);
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    img.dispose();
    return data?.buffer.asUint8List();
  }
}

/// Smooth pen strokes (midpoint quadratic curves); a single touch is drawn as a dot.
void paintSignature(Canvas canvas, List<List<Offset>> strokes, {double scale = 1, required Color color, double pen = 3}) {
  final line = Paint()..color = color..style = PaintingStyle.stroke..strokeWidth = pen * scale..strokeCap = StrokeCap.round..strokeJoin = StrokeJoin.round;
  final dot = Paint()..color = color..style = PaintingStyle.fill;
  for (final s in strokes) {
    if (s.isEmpty) continue;
    if (s.length == 1) { canvas.drawCircle(s.first * scale, pen * scale / 2, dot); continue; }
    final path = Path()..moveTo(s.first.dx * scale, s.first.dy * scale);
    for (var i = 1; i < s.length - 1; i++) {
      final mid = (s[i] + s[i + 1]) / 2;
      path.quadraticBezierTo(s[i].dx * scale, s[i].dy * scale, mid.dx * scale, mid.dy * scale);
    }
    path.lineTo(s.last.dx * scale, s.last.dy * scale);
    canvas.drawPath(path, line);
  }
}

/// The recipient signs with a finger: a paper-white canvas, Undo and Clear. The canvas claims every touch, so signing never scrolls the page.
class SignaturePad extends StatefulWidget {
  const SignaturePad({super.key, required this.controller, this.height = 190, this.enabled = true});
  final SignatureController controller;
  final double height;
  final bool enabled;
  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  int? _pointer;

  @override
  void initState() { super.initState(); widget.controller.addListener(_changed); }
  @override
  void didUpdateWidget(SignaturePad old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) { old.controller.removeListener(_changed); widget.controller.addListener(_changed); }
  }
  @override
  void dispose() { widget.controller.removeListener(_changed); super.dispose(); }
  void _changed() { if (mounted) setState(() {}); }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final c = widget.controller;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        key: const Key('signature-pad'), height: widget.height,
        decoration: BoxDecoration(color: JR.paper, borderRadius: BorderRadius.circular(12), border: Border.all(color: c.hasSignature ? JR.accent : JR.line, width: c.hasSignature ? 2 : 1)),
        child: ClipRRect(borderRadius: BorderRadius.circular(11), child: LayoutBuilder(builder: (context, box) {
          c.setSize(box.biggest);
          return RawGestureDetector(
            gestures: {EagerGestureRecognizer: GestureRecognizerFactoryWithHandlers<EagerGestureRecognizer>(EagerGestureRecognizer.new, (_) {})},
            child: Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: !widget.enabled ? null : (e) { if (_pointer != null) return; _pointer = e.pointer; c.start(e.localPosition); },
              onPointerMove: (e) { if (e.pointer == _pointer) c.add(e.localPosition); },
              onPointerUp: (e) { if (e.pointer == _pointer) { _pointer = null; c.end(); } },
              onPointerCancel: (e) { if (e.pointer == _pointer) { _pointer = null; c.end(); } },
              child: Stack(fit: StackFit.expand, children: [
                CustomPaint(painter: _PadPainter(c.strokes)),
                if (c.strokes.isEmpty) Center(child: Padding(padding: const EdgeInsets.all(12), child: Text(t('fma.sign_here'), textAlign: TextAlign.center, style: const TextStyle(color: JR.paperHint, fontSize: 18)))),
                PositionedDirectional(start: 16, end: 16, bottom: 34, child: Container(height: 1, color: JR.paperRule)),
              ]),
            ),
          );
        })),
      ),
      const SizedBox(height: 6),
      Row(children: [
        Expanded(child: TextButton.icon(key: const Key('signature-undo'), style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: widget.enabled && c.strokes.isNotEmpty ? c.undo : null, icon: const Icon(Icons.undo), label: Text(t('fma.sign_undo'), maxLines: 1, overflow: TextOverflow.ellipsis))),
        Expanded(child: TextButton.icon(key: const Key('signature-clear'), style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: widget.enabled && c.strokes.isNotEmpty ? c.clear : null, icon: const Icon(Icons.delete_outline), label: Text(t('fma.sign_clear'), maxLines: 1, overflow: TextOverflow.ellipsis))),
      ]),
    ]);
  }
}

class _PadPainter extends CustomPainter {
  _PadPainter(List<List<Offset>> strokes) : strokes = [for (final s in strokes) List<Offset>.of(s)];
  final List<List<Offset>> strokes;
  @override
  void paint(Canvas canvas, Size size) => paintSignature(canvas, strokes, color: JR.ink);
  @override
  bool shouldRepaint(_PadPainter old) => true;
}
