import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

  Future<void> _send() async {
    setState(() { _busy = true; _error = null; });
    try {
      final r = await ref.read(apiProvider).sendOtp(_phone.text.trim());
      setState(() { _codeStep = true; _demo = r['demoCode'] as String?; });
    } catch (e) {
      if (mounted) setState(() => _error = errMessage(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() { _busy = true; _error = null; });
    try {
      final r = await ref.read(apiProvider).verifyOtp(_phone.text.trim(), _code.text.trim());
      if (r['isNew'] == true) {
        if (mounted) context.go('/register', extra: {'token': r['registrationToken'], 'phone': _phone.text.trim()});
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
                  const Text('JR Logistics', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                ]),
                const SizedBox(height: 32),
                Text(t('auth.login_title'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(t('auth.login_sub'), style: const TextStyle(color: JR.muted, height: 1.4)),
                if (expired) ...[const SizedBox(height: 16), Banner2(text: t('auth.session_expired'), tone: Tone.warn)],
                const SizedBox(height: 24),
                TextField(
                  key: const Key('phone'), controller: _phone, enabled: !_codeStep, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr,
                  decoration: InputDecoration(labelText: t('auth.phone'), hintText: '05XXXXXXXX', prefixIcon: const Icon(Icons.phone_outlined)),
                  onSubmitted: (_) => _codeStep ? null : _send(),
                ),
                if (_codeStep) ...[
                  const SizedBox(height: 16),
                  if (_demo != null) Banner2(tone: Tone.warn, title: t('auth.demo_code'), text: '${_demo!}\n${t('auth.demo_code_hint')}', action: OutlinedButton(onPressed: () => _code.text = _demo!, child: Text(t('m.demo_fill')))),
                  if (_demo != null) const SizedBox(height: 16),
                  TextField(key: const Key('code'), controller: _code, autofocus: true, keyboardType: TextInputType.number, maxLength: 6, textDirection: TextDirection.ltr, textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, letterSpacing: 8, fontWeight: FontWeight.w700), decoration: InputDecoration(labelText: t('auth.code'), counterText: ''), onSubmitted: (_) => _verify()),
                  Align(alignment: AlignmentDirectional.centerStart, child: TextButton(onPressed: () => setState(() { _codeStep = false; _code.clear(); _demo = null; _error = null; }), child: Text(t('auth.change_number')))),
                ],
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: JR.danger))),
                const SizedBox(height: 16),
                FilledButton(key: const Key('submit'), onPressed: _busy ? null : (_codeStep ? _verify : _send), child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(_codeStep ? t('auth.verify') : t('auth.send_code'))),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
