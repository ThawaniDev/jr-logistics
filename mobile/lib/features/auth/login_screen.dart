import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show TextInput;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import '../profile/language_sheet.dart';
import '../support/support_contact_card.dart';
import 'auth_rules.dart';
import 'auth_session.dart';
import 'auth_widgets.dart';

/// Username + password sign-in. The username of the last successful sign-in is remembered on the device (never the password).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  late final _username = TextEditingController(text: ref.read(prefsProvider).getString(lastUsernameKey) ?? '');
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  String get _user => normalizeUsername(_username.text);
  bool get _canSubmit => _user.isNotEmpty && _password.text.isNotEmpty;

  @override
  void dispose() { _username.dispose(); _password.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_busy || !_canSubmit) return;
    ref.read(passwordChangedNoticeProvider.notifier).set(false);
    setState(() { _busy = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final r = await api.login(_user, _password.text);
      final token = r['token'], user = r['user'];
      // Staff / admin with two-step verification answer `mfaRequired` and have no session: like every non-driver account they belong on the web portal.
      if (r['mfaRequired'] == true) { if (mounted) setState(() => _error = context.tr('m.driver_only')); return; }
      if (token is! String || user is! Map) throw ApiException('BAD_RESPONSE', 'login: missing token/user');
      if (user['role'] != 'driver') {
        // The server opened a session for this account: end it now (best effort, in the background) — nobody holds this token and it would live for 30 days.
        unawaited(api.revokeSession(token));
        if (mounted) setState(() => _error = context.tr('m.driver_only'));
        return;
      }
      await ref.read(prefsProvider).setString(lastUsernameKey, _user);
      TextInput.finishAutofillContext();
      await ref.read(authProvider.notifier).signIn(token, user.cast<String, dynamic>());
    } catch (e) {
      if (mounted) setState(() => _error = loginErrorMessage(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final auth = ref.watch(authProvider).value;
    final changed = ref.watch(passwordChangedNoticeProvider);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(key: const Key('language'), onPressed: () => showLanguageSheet(context, ref), icon: const Icon(Icons.language), label: Text(langNames[ref.watch(localeProvider)]!))),
                  const SizedBox(height: 8),
                  Row(children: [
                    ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.asset('assets/logo.png', width: 48, height: 48)),
                    const SizedBox(width: 12),
                    const Expanded(child: Text('JR Logistics', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800))), // wraps instead of overflowing at large text sizes
                  ]),
                  const SizedBox(height: 32),
                  Text(t('m.au_login_title'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(t('m.au_login_sub'), style: TextStyle(color: JR.muted, height: 1.4)),
                  if (auth?.expired == true) ...[const SizedBox(height: 16), auth?.afterDeletionRequest == true ? Banner2(key: const Key('session-ended-after-request'), text: t('lm.session_ended_after_request')) : Banner2(text: t('auth.session_expired'), tone: Tone.warn)],
                  if (changed) ...[const SizedBox(height: 16), Banner2(key: const Key('password-changed'), text: t('m.au_password_changed'), tone: Tone.success)],
                  const SizedBox(height: 24),
                  TextField(
                    key: const Key('username'), controller: _username, readOnly: _busy, keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr, autofillHints: const [AutofillHints.username],
                    autocorrect: false, enableSuggestions: false, textCapitalization: TextCapitalization.none, inputFormatters: loginUsernameFormatters, textInputAction: TextInputAction.next, onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(labelText: t('m.au_username'), prefixIcon: const Icon(Icons.person_outline)),
                  ),
                  const SizedBox(height: 14),
                  PasswordField(id: 'password', controller: _password, label: t('m.au_password'), readOnly: _busy, action: TextInputAction.done, onChanged: (_) => setState(() {}), onSubmitted: (_) => _submit()),
                  if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Semantics(liveRegion: true, child: Text(_error!, key: const Key('login-error'), style: TextStyle(color: JR.danger, height: 1.4)))),
                  const SizedBox(height: 16),
                  FilledButton(key: const Key('submit'), onPressed: _busy || !_canSubmit ? null : _submit, child: _busy ? SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('m.au_sign_in'))),
                  const SizedBox(height: 14),
                  Text(t('m.au_forgot'), key: const Key('forgot-hint'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, fontSize: 13, height: 1.4)),
                  const SizedBox(height: 16),
                  const SupportContactCard(), // the company's call / WhatsApp / e-mail, when it has published any — the way out for a driver who cannot sign in
                  const SizedBox(height: 28),
                  Text(t('m.au_no_account'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted)),
                  const SizedBox(height: 8),
                  OutlinedButton(key: const Key('create-account'), onPressed: _busy ? null : () => context.go('/register'), child: Text(t('m.au_create_account'))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
