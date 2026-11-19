import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import '../profile/language_sheet.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _codeStep = false, _busy = false;
  String? _demo, _error;
  DateTime? _resendAt;

  String get _phoneDigits => latinDigits(_phone.text).replaceAll(RegExp(r'[\s\-()]'), '');
  bool get _phoneOk => RegExp(r'^\+?\d{9,15}$').hasMatch(_phoneDigits);
  bool get _codeOk => latinDigits(_code.text).trim().length >= 4;

  @override
  void dispose() { _phone.dispose(); _code.dispose(); super.dispose(); }

  /// Resending is allowed after 30 s: stops accidental double sends (each is an SMS) while never leaving the driver stuck.
  void _startCooldown() => _resendAt = DateTime.now().add(const Duration(seconds: 30));

  Future<void> _send() async {
    if (_busy || !_phoneOk) return;
    setState(() { _busy = true; _error = null; });
    try {
      final r = await ref.read(apiProvider).sendOtp(_phoneDigits);
      if (!mounted) return;
      setState(() { _codeStep = true; _demo = r['demoCode'] is String ? r['demoCode'] as String : null; });
      _startCooldown();
    } catch (e) {
      if (mounted) setState(() => _error = errMessage(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (_busy || !_codeOk) return;
    setState(() { _busy = true; _error = null; });
    try {
      final r = await ref.read(apiProvider).verifyOtp(_phoneDigits, latinDigits(_code.text).trim());
      if (r['isNew'] == true) {
        if (mounted) context.go('/register', extra: {'token': r['registrationToken'], 'phone': _phoneDigits});
      } else {
        final user = (r['user'] as Map).cast<String, dynamic>();
        if (user['role'] != 'driver') { if (mounted) setState(() => _error = context.tr('m.driver_only')); return; }
        await ref.read(authProvider.notifier).signIn(r['token'] as String, user);
      }
    } catch (e) {
      if (mounted) setState(() => _error = errMessage(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final expired = ref.watch(authProvider).value?.expired == true;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(onPressed: () => showLanguageSheet(context, ref), icon: const Icon(Icons.language), label: Text(langNames[ref.watch(localeProvider)]!))),
                const SizedBox(height: 8),
                Row(children: [
                  ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.asset('assets/logo.png', width: 48, height: 48)),
                  const SizedBox(width: 12),
                  const Expanded(child: Text('JR Logistics', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800))), // wraps instead of overflowing at large text sizes
                ]),
                const SizedBox(height: 32),
                Text(t('auth.login_title'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(t('auth.login_sub'), style: const TextStyle(color: JR.muted, height: 1.4)),
                if (expired) ...[const SizedBox(height: 16), Banner2(text: t('auth.session_expired'), tone: Tone.warn)],
                const SizedBox(height: 24),
                TextField(
                  key: const Key('phone'), controller: _phone, enabled: !_codeStep && !_busy, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, autofillHints: const [AutofillHints.telephoneNumber],
                  inputFormatters: const [LatinDigitsFormatter()], textInputAction: TextInputAction.done, onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(labelText: t('auth.phone'), hintText: '05XXXXXXXX', prefixIcon: const Icon(Icons.phone_outlined)),
                  onSubmitted: (_) => _codeStep ? null : _send(),
                ),
                if (_codeStep) ...[
                  const SizedBox(height: 16),
                  if (_demo != null) Banner2(tone: Tone.warn, title: t('auth.demo_code'), text: '${_demo!}\n${t('auth.demo_code_hint')}', action: OutlinedButton(onPressed: () => setState(() => _code.text = _demo!), child: Text(t('m.demo_fill')))),
                  if (_demo != null) const SizedBox(height: 16),
                  TextField(key: const Key('code'), controller: _code, autofocus: true, keyboardType: TextInputType.number, inputFormatters: digitsOnly(max: 6), autofillHints: const [AutofillHints.oneTimeCode], textInputAction: TextInputAction.done, textDirection: TextDirection.ltr, textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, letterSpacing: 8, fontWeight: FontWeight.w700), decoration: InputDecoration(labelText: t('auth.code'), counterText: ''), onChanged: (_) => setState(() {}), onSubmitted: (_) => _verify()),
                  Row(children: [
                    Expanded(child: Align(alignment: AlignmentDirectional.centerStart, child: TextButton(style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: _busy ? null : () => setState(() { _codeStep = false; _code.clear(); _demo = null; _error = null; }), child: Text(t('auth.change_number'))))),
                    DeadlineBuilder(
                      key: ValueKey(_resendAt),
                      deadline: _resendAt ?? DateTime.fromMillisecondsSinceEpoch(0),
                      builder: (_, wait) => TextButton(key: const Key('resend-otp'), style: TextButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: _busy || wait > 0 ? null : _send, child: Text(wait > 0 ? t('um.resend_in', {'time': fmtCountdown(wait)}) : t('ms.resend_code'))),
                    ),
                  ]),
                ],
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Semantics(liveRegion: true, child: Text(_error!, key: const Key('login-error'), style: const TextStyle(color: JR.danger, height: 1.4)))),
                const SizedBox(height: 16),
                FilledButton(key: const Key('submit'), onPressed: _busy || !(_codeStep ? _codeOk : _phoneOk) ? null : (_codeStep ? _verify : _send), child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(_codeStep ? t('auth.verify') : t('auth.send_code'))),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
