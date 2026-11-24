import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/barcode_scanner.dart';
import '../../widgets/common.dart';
import 'signature_pad.dart';
import 'stop_actions.dart';
import 'stop_runner.dart';

/// What the driver has typed for a stop but not yet submitted. Lives in memory for the session so that leaving the job screen,
/// a rebuild, or the screen being recreated after a bad-signal reload never throws away a parcel code or a receiver name.
/// (The 4-digit recipient code is deliberately NOT kept: it is single-use and a stale one only wastes a try.)
typedef StopDraft = ({String code, String receiver});

class StopDraftNotifier extends Notifier<Map<String, StopDraft>> {
  @override
  Map<String, StopDraft> build() => const {};
  void put(String stopId, {String? code, String? receiver}) {
    final cur = state[stopId] ?? (code: '', receiver: '');
    state = {...state, stopId: (code: code ?? cur.code, receiver: receiver ?? cur.receiver)};
  }
  void clear(String stopId) { if (state.containsKey(stopId)) state = {...state}..remove(stopId); }
}

final stopDraftProvider = NotifierProvider<StopDraftNotifier, Map<String, StopDraft>>(StopDraftNotifier.new);

/// Turns the drawn signature into a PNG. A provider so widget tests can skip the real image encoder.
typedef SignatureExporter = Future<Uint8List?> Function(SignatureController c);
final signatureExporterProvider = Provider<SignatureExporter>((_) => (c) => c.toPng());

/// The "hand over the parcel" form of the CURRENT stop, used inline on the stops screen and inside the delivery sheet (so the two never diverge):
/// parcel code (camera scan or typing) · the recipient's 4-digit code, or just the scanned code when the warehouse does not use delivery codes
/// (`needsOtp == false`) · the business receipt photo alternative · the recipient's signature (`needsSignature`) · cash on delivery confirmation (`codCents > 0`).
/// Every error shows INLINE (a toast would hide behind the sheet).
class DeliverForm extends ConsumerStatefulWidget {
  const DeliverForm({super.key, required this.job, required this.stop, this.onDelivered});
  final Job job;
  final Stop stop;
  /// Called once the server accepted the delivery.
  final VoidCallback? onDelivered;
  @override
  ConsumerState<DeliverForm> createState() => _DeliverFormState();
}

class _DeliverFormState extends ConsumerState<DeliverForm> {
  static const _resendCooldown = Duration(seconds: 30);
  final _code = TextEditingController(), _otp = TextEditingController(), _receiver = TextEditingController();
  final _sig = SignatureController();
  bool _receiptMode = false, _uploading = false, _uploaded = false, _locked = false, _cashOk = false;
  /// Synchronous re-entry guard: set the instant a button is tapped (before any await, e.g. while GPS is being read), so a second tap
  /// can never start a second deliver. The shared busy flag only flips once the request itself starts.
  bool _submitting = false;
  PickedPhoto? _photo;
  double? _progress;
  Object? _uploadError;
  bool _cameraDenied = false;
  String? _error;
  int? _triesOverride;
  DateTime? _resendAt;

  Stop get s => widget.stop;
  String get offerId => widget.job.offerId;
  bool get _working => ref.read(stopBusyProvider).contains(offerId) || _submitting;
  int get _tries => _triesOverride ?? s.otpAttemptsLeft;
  bool get _isLocked => s.needsOtp && (_locked || _tries <= 0);
  bool get _needsOtp => s.needsOtp && !_receiptMode;

  @override
  void initState() {
    super.initState();
    _uploaded = s.hasProof;
    _locked = s.otpAttemptsLeft == 0;
    final d = ref.read(stopDraftProvider)[s.id];
    if (d != null) { _code.text = d.code; _receiver.text = d.receiver; }
    _sig.addListener(_sigChanged);
  }

  void _sigChanged() { if (mounted) setState(() {}); }

  @override
  void didUpdateWidget(DeliverForm old) {
    super.didUpdateWidget(old);
    if (old.stop.otpAttemptsLeft != s.otpAttemptsLeft) {
      _triesOverride = null; // the server's number is the truth once it arrives
      _locked = s.otpAttemptsLeft == 0; // locked/unlocked only when the server's count changes (a resend unlocks it), not on every refresh
    }
    if (s.hasProof && !old.stop.hasProof) _uploaded = true;
    if (_receiptMode && !(s.needsOtp && s.allowsReceipt)) _receiptMode = false;
  }

  @override
  void dispose() { _sig.removeListener(_sigChanged); _sig.dispose(); _code.dispose(); _otp.dispose(); _receiver.dispose(); super.dispose(); }

  /// Single-flight wrapper for every action of the form.
  Future<void> _once(Future<void> Function() f) async {
    if (_working) return;
    setState(() => _submitting = true);
    try { await f(); } finally { if (mounted) setState(() => _submitting = false); }
  }

  bool get _codeOk => _code.text.trim().isNotEmpty;
  bool get _otpOk => _otp.text.length == 4;
  bool get _receiverOk => _receiver.text.trim().isNotEmpty;
  bool get _proofOk => !s.needsOtp || (_receiptMode ? _uploaded && _receiverOk : _otpOk && !_isLocked);
  bool get _signatureOk => !s.needsSignature || _sig.hasSignature;
  bool get _cashDone => !s.hasCod || _cashOk;

  /// Why the confirm button is disabled — shown as a plain sentence so the driver is never left guessing.
  String? _missing(Strings t) {
    if (!_codeOk) return t('um.missing_code');
    if (s.needsOtp) {
      if (_receiptMode) {
        if (!_uploaded) return t('um.missing_photo');
        if (!_receiverOk) return t('um.missing_receiver');
      } else if (!_isLocked && !_otpOk) {
        return t('um.missing_otp');
      }
    }
    if (!_signatureOk) return t('fma.missing_signature');
    if (!_cashDone) return t('fma.missing_cash');
    return null;
  }

  bool get _canSubmit => !_working && !_uploading && _codeOk && _proofOk && _signatureOk && _cashDone;

  Future<void> _deliver() => _once(() async {
        final where = await stopWhere(ref.read(locationServiceProvider));
        if (!mounted) return;
        setState(() => _error = null);
        final stopId = s.id;
        final needsSig = s.needsSignature, cash = s.hasCod ? s.codCents : null, useOtp = _needsOtp, receipt = _receiptMode;
        final code = _code.text.trim(), otp = _otp.text, receiver = _receiver.text.trim();
        final ok = await runStopAction(
          context, ref, offerId,
          () async {
            final api = ref.read(apiProvider);
            String? sigId;
            if (needsSig) {
              final png = await ref.read(signatureExporterProvider)(_sig);
              if (png == null) throw ApiException('SIGNATURE_REQUIRED', 'no signature', status: 422);
              final up = await api.uploadStopMedia(offerId, stopId, kind: 'signature', bytes: png, filename: 'signature.png');
              sigId = up['id'] is String ? up['id'] as String : null;
            }
            await api.deliverStop(offerId, stopId, code: code, otp: useOtp ? otp : null, proof: receipt ? 'receipt' : null, receiverName: receipt ? receiver : null, signatureMediaId: sigId, cashCollectedCents: cash, lat: where.lat, lng: where.lng);
          },
          success: 'ms.delivered_stop_ok',
          verify: (f) => stopIn(f, stopId)?.status == 'delivered',
          onError: (m) { if (mounted) setState(() => _error = m); },
          handle: (e) {
            if (e is! ApiException || !mounted) return false;
            if (e.code == 'OTP_INVALID' || e.code == 'OTP_LOCKED') {
              final left = numOf(e.details['attemptsLeft'])?.toInt();
              setState(() {
                _otp.clear();
                if (e.code == 'OTP_LOCKED' || (left != null && left <= 0)) { _locked = true; _triesOverride = 0; _error = null; }
                else { _error = errMessage(context, e); if (left != null) _triesOverride = left; }
              });
              return true;
            }
            if (e.code == 'CASH_MISMATCH') { setState(() { _cashOk = false; _error = stopErrMessage(context, e); }); return true; } // collect the right amount, then confirm again
            return false;
          },
        );
        if (ok && mounted) {
          _otp.clear();
          ref.read(stopDraftProvider.notifier).clear(stopId);
          widget.onDelivered?.call();
        }
      });

  Future<void> _resend() => _once(() async {
        // `{sent: false, smsOff: true}`: text messages were switched off since the form was opened — nothing was sent and none is needed (the job reloads without a code box).
        var smsOff = false;
        final ok = await runStopAction(context, ref, offerId, () async { final r = await ref.read(apiProvider).resendCode(offerId, s.id); smsOff = r['smsOff'] == true || r['sent'] == false; }, onError: (m) { if (mounted) setState(() => _error = m); });
        if (!ok || !mounted) return;
        if (smsOff) { toast(context, context.tr('lm.sms_off_resend'), quiet: true); setState(() => _error = null); return; }
        toast(context, context.tr('ms.code_resent'));
        setState(() { _locked = false; _triesOverride = 5; _error = null; _resendAt = DateTime.now().add(_resendCooldown); });
      });

  Future<void> _takePhoto() async {
    if (_working || _uploading) return;
    PickedPhoto? pic;
    try {
      pic = await ref.read(photoPickerProvider).takePhoto();
    } on PhotoException catch (e) {
      if (mounted) { setState(() => _cameraDenied = e.denied); if (!e.denied) toast(context, context.tr('um.camera_failed'), error: true); }
      return;
    }
    if (pic == null || !mounted) return;
    setState(() { _photo = pic; _cameraDenied = false; _uploaded = false; _uploadError = null; });
    await _upload();
  }

  /// Sends [_photo] (again, after a failure). The picture stays on screen and the retry needs no re-shoot.
  Future<void> _upload() async {
    final pic = _photo;
    if (pic == null || _uploading || _working) return;
    setState(() { _uploading = true; _uploadError = null; _progress = 0; });
    final stopId = s.id;
    final ok = await runStopAction(
      context, ref, offerId,
      () async { await ref.read(apiProvider).uploadProof(offerId, stopId, pic.path, pic.name, onProgress: (p) { if (mounted) setState(() => _progress = p); }); },
      success: 'ms.photo_uploaded',
      verify: (f) => stopIn(f, stopId)?.hasProof == true,
      handle: (e) { if (mounted) setState(() => _uploadError = e); return true; }, // shown inline with a Retry button, not just a toast
    );
    if (mounted) setState(() { _uploading = false; _uploaded = ok; _progress = null; });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    ref.watch(stopBusyProvider); // rebuild when another action starts/ends so the buttons follow
    final missing = _missing(t);
    final resendBlocked = !s.canResend;
    final working = _working;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('ms.deliver_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
      if (s.hasCod) ...[const SizedBox(height: 10), CodBox(cents: s.codCents)],
      const SizedBox(height: 10),
      ScanField(
        fieldKey: const Key('parcel-code'), controller: _code, label: t('ms.parcel_code'), helper: t('ms.parcel_code_hint'), scanTitle: t('fma.scan_parcel_title'),
        onChanged: (v) { ref.read(stopDraftProvider.notifier).put(s.id, code: v); setState(() {}); },
      ),
      if (s.needsOtp && s.allowsReceipt) ...[
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          key: const Key('proof-mode'), showSelectedIcon: false, style: SegmentedButton.styleFrom(minimumSize: const Size(0, 52)),
          segments: [ButtonSegment(value: false, label: Text(t('ms.proof_code'), key: const Key('mode-code'))), ButtonSegment(value: true, label: Text(t('ms.proof_receipt'), key: const Key('mode-receipt')))],
          selected: {_receiptMode}, onSelectionChanged: (v) => setState(() { _receiptMode = v.first; _error = null; }),
        ),
      ],
      const SizedBox(height: 12),
      // No recipient code: either this warehouse does not use one, or text messages are switched off platform-wide (then the hint says why nothing was sent).
      if (!s.needsOtp) Banner2(key: Key(s.smsOff ? 'sms-off-note' : 'scan-proof-note'), icon: Icons.qr_code_scanner, text: t(s.smsOff ? 'lm.sms_off_hint' : 'fma.scan_proof_note'))
      else if (!_receiptMode) ..._otpSection(t, resendBlocked)
      else ..._receiptSection(t),
      if (s.needsSignature) ...[
        const SizedBox(height: 16),
        Text(t('fma.sign_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 2),
        Text(t('fma.sign_hint'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.35)),
        const SizedBox(height: 8),
        SignaturePad(controller: _sig, enabled: !working),
      ],
      if (s.hasCod) ...[const SizedBox(height: 12), _CashConfirm(cents: s.codCents, value: _cashOk, enabled: !working, onChanged: (v) => setState(() => _cashOk = v))],
      if (_error != null) ...[const SizedBox(height: 10), Banner2(key: const Key('deliver-error'), tone: Tone.danger, text: _error!)],
      const SizedBox(height: 14),
      FilledButton.icon(key: const Key('deliver-submit'), onPressed: _canSubmit ? _deliver : null, icon: busyIcon(working && !_uploading, Icons.check), label: Text(t('ms.deliver_btn'))),
      if (missing != null && !working) Padding(padding: const EdgeInsets.only(top: 8), child: Text(missing, key: const Key('deliver-hint'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, fontSize: 13, height: 1.3))),
      if (s.needsOtp && !_receiptMode && !_isLocked && !resendBlocked) _resendButton(t),
    ]);
  }

  List<Widget> _otpSection(Strings t, bool resendBlocked) {
    if (_isLocked) {
      // Locked: the field is disabled and the way out is the one big button — never a dead end.
      return [
        TextField(key: const Key('otp-code'), controller: _otp, enabled: false, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('ms.delivery_code'), prefixIcon: const Icon(Icons.lock_outline))),
        const SizedBox(height: 10),
        Banner2(
          key: const Key('otp-locked'), tone: Tone.danger, title: t('um.locked_title'),
          text: resendBlocked ? t('um.locked_no_resend') : t('err.OTP_LOCKED'),
          action: resendBlocked ? null : _resendButton(t, filled: true),
        ),
      ];
    }
    return [
      TextField(
        key: const Key('otp-code'), controller: _otp, enabled: !_working, textAlign: TextAlign.center, textInputAction: TextInputAction.done,
        keyboardType: TextInputType.number, textDirection: TextDirection.ltr, autofillHints: const [AutofillHints.oneTimeCode],
        inputFormatters: digitsOnly(max: 4), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 14),
        onChanged: (_) {
          setState(() {});
          if (_otpOk && _codeOk) FocusManager.instance.primaryFocus?.unfocus(); // keypad out of the way: the confirm button is now the next thing
        },
        onSubmitted: (_) { if (_canSubmit) _deliver(); },
        decoration: InputDecoration(labelText: t('ms.delivery_code'), helperText: t('ms.delivery_code_hint'), helperMaxLines: 2, prefixIcon: const Icon(Icons.pin_outlined)),
      ),
      if (_tries < 5 && _error == null) Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Align(alignment: AlignmentDirectional.centerStart, child: Pill(t('um.tries_left', {'n': _tries}), tone: _tries <= 2 ? Tone.danger : Tone.warn)),
      ),
    ];
  }

  /// Resend with a 30 s cooldown after a send, so a nervous double tap cannot SMS the recipient twice.
  Widget _resendButton(Strings t, {bool filled = false}) {
    Widget build(int wait) {
      final label = wait > 0 ? t('um.resend_in', {'time': fmtCountdown(wait)}) : t('ms.resend_code');
      final onTap = _working || wait > 0 ? null : _resend;
      return filled
          ? FilledButton.icon(key: const Key('resend-code'), style: FilledButton.styleFrom(backgroundColor: JR.danger, foregroundColor: JR.dangerInk), onPressed: onTap, icon: busyIcon(_working, Icons.sms_outlined, color: JR.dangerInk), label: Text(label))
          : TextButton.icon(key: const Key('resend-code'), style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: onTap, icon: const Icon(Icons.sms_outlined), label: Text(label));
    }
    final at = _resendAt;
    if (at == null || !at.isAfter(DateTime.now())) return build(0);
    return DeadlineBuilder(deadline: at, builder: (_, wait) => build(wait));
  }

  List<Widget> _receiptSection(Strings t) {
    final photo = _photo;
    return [
      Banner2(text: t('ms.receipt_hint')),
      const SizedBox(height: 10),
      if (photo != null) Stack(alignment: Alignment.bottomCenter, children: [
        ClipRRect(borderRadius: BorderRadius.circular(12), child: SizedBox(height: 180, width: double.infinity, child: Image.file(File(photo.path), key: const Key('receipt-preview'), fit: BoxFit.cover, cacheWidth: 900, errorBuilder: (_, _, _) => Container(color: JR.bg2, alignment: Alignment.center, child: Icon(Icons.receipt_long, size: 48, color: JR.muted))))),
        if (_uploaded) PositionedDirectional(top: 8, end: 8, child: Container(padding: const EdgeInsets.all(4), decoration: BoxDecoration(color: JR.accent, shape: BoxShape.circle), child: Icon(Icons.check, size: 20, color: JR.accentInk))),
      ]),
      if (photo != null) const SizedBox(height: 8),
      if (_uploading) Padding(padding: const EdgeInsets.only(bottom: 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        LinearProgressIndicator(key: const Key('upload-progress'), value: _progress == null || _progress == 0 ? null : _progress, minHeight: 6, color: JR.accent, backgroundColor: JR.line, semanticsLabel: t('um.uploading')),
        const SizedBox(height: 4),
        Text(_progress == null || _progress == 0 ? t('um.uploading') : t('um.uploading_pct', {'pct': (_progress! * 100).round()}), style: TextStyle(color: JR.muted, fontSize: 12)),
      ])),
      if (_uploadError != null && !_uploading) Padding(padding: const EdgeInsets.only(bottom: 8), child: Banner2(
        key: const Key('upload-error'), tone: Tone.danger, text: errMessage(context, _uploadError!),
        action: photo == null ? null : FilledButton.icon(key: const Key('receipt-retry'), style: FilledButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: _upload, icon: const Icon(Icons.refresh), label: Text(t('um.retry_upload'))),
      )),
      if (_cameraDenied) Padding(padding: const EdgeInsets.only(bottom: 8), child: Banner2(
        key: const Key('camera-denied'), tone: Tone.warn, text: t('um.camera_denied'),
        action: OutlinedButton.icon(onPressed: () => ref.read(linkOpenerProvider).openAppSettings(), icon: const Icon(Icons.settings_outlined), label: Text(t('um.open_settings'))),
      )),
      OutlinedButton.icon(key: const Key('receipt-pick'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)), onPressed: _working || _uploading ? null : _takePhoto, icon: busyIcon(_uploading, Icons.photo_camera_outlined, color: JR.accent), label: Text(_uploaded || photo != null ? t('ms.retake_photo') : t('ms.take_photo'))),
      if (_uploaded) Padding(padding: const EdgeInsets.only(top: 6), child: Row(children: [Icon(Icons.check_circle, size: 18, color: JR.accent), const SizedBox(width: 6), Text(t('ms.photo_uploaded'), key: const Key('photo-ok'), style: TextStyle(color: JR.accent, fontWeight: FontWeight.w600))])),
      const SizedBox(height: 10),
      TextField(key: const Key('receiver-name'), controller: _receiver, onChanged: (v) { ref.read(stopDraftProvider.notifier).put(s.id, receiver: v); setState(() {}); }, textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.done, decoration: InputDecoration(labelText: t('ms.receiver_name'), prefixIcon: const Icon(Icons.badge_outlined))),
    ];
  }
}

/// "Collect SAR 120.00 in cash" — the amount the recipient must pay at the door (cash on delivery). Large and gold so it is never missed.
class CodBox extends StatelessWidget {
  const CodBox({super.key, required this.cents});
  final int cents;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return Container(
      key: const Key('cod-box'), width: double.infinity, padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: JR.gold.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: JR.gold, width: 1.5)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Icon(Icons.payments_outlined, color: JR.gold, size: 30),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(t('fma.cod_collect'), style: TextStyle(color: JR.gold, fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.3)),
          const SizedBox(height: 2),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(fmtMoney(cents, t.code), key: const Key('cod-amount'), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, height: 1.15))),
          const SizedBox(height: 2),
          Text(t('fma.cod_collect_hint'), style: TextStyle(color: JR.muted, fontSize: 12.5, height: 1.35)),
        ])),
      ]),
    );
  }
}

class _CashConfirm extends StatelessWidget {
  const _CashConfirm({required this.cents, required this.value, required this.enabled, required this.onChanged});
  final int cents;
  final bool value, enabled;
  final ValueChanged<bool> onChanged;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return Container(
      decoration: BoxDecoration(color: JR.bg2, borderRadius: BorderRadius.circular(JR.radius), border: Border.all(color: value ? JR.accent : JR.gold, width: 1.5)),
      child: CheckboxListTile(
        key: const Key('cod-confirm'), value: value, onChanged: enabled ? (v) => onChanged(v == true) : null, controlAffinity: ListTileControlAffinity.leading, contentPadding: const EdgeInsetsDirectional.only(start: 8, end: 12), activeColor: JR.accent, checkColor: JR.accentInk,
        title: Text(t('fma.cod_confirm', {'amount': fmtMoney(cents, t.code)}), style: const TextStyle(fontWeight: FontWeight.w700, height: 1.3)),
      ),
    );
  }
}

/// The delivery as a bottom sheet (used by [StopActions.deliver], e.g. from the route-map popup): the stop's header, then — once the driver has arrived —
/// the same [DeliverForm] as the stops screen. Pops `true` after a successful delivery.
class DeliverSheet extends ConsumerWidget {
  const DeliverSheet({super.key, required this.job, required this.stop});
  final Job job;
  final Stop stop;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final fresh = ref.watch(jobProvider(job.offerId)).value ?? job;
    final s = stopIn(fresh, stop.id) ?? stop;
    final busy = ref.watch(stopBusyProvider).contains(job.offerId);
    return SafeArea(child: SingleChildScrollView(child: Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(s.recipientName ?? t('um.parcel_n', {'n': s.seq}), key: const Key('deliver-sheet-title'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, height: 1.2)),
        const SizedBox(height: 4),
        Text('${s.address}${s.city != null ? ' · ${cityLabel(context, s.city)}' : ''}', style: TextStyle(color: JR.muted, fontSize: 15, height: 1.3)),
        const SizedBox(height: 14),
        if (s.resolved) const SizedBox.shrink()
        else if (fresh.routingEnabled && !s.current) Banner2(key: const Key('deliver-locked'), tone: Tone.warn, text: t('err.STOP_LOCKED'))
        else if (!s.arrived) ...[
          Text(t('ms.arrive_first'), style: TextStyle(color: JR.muted, height: 1.4)),
          const SizedBox(height: 12),
          FilledButton.icon(key: const Key('arrive'), onPressed: busy ? null : () => StopActions.arrive(context, ref, fresh, s), icon: busyIcon(busy, Icons.my_location), label: Text(t('act.checkin'))),
        ] else DeliverForm(key: ValueKey('deliver-${s.id}'), job: fresh, stop: s, onDelivered: () { if (context.mounted) Navigator.pop(context, true); }),
      ]),
    )));
  }
}
