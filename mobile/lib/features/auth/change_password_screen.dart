import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'auth_rules.dart';
import 'auth_session.dart';
import 'auth_widgets.dart';

/// "Choose a new password": shown to everyone whose account carries a temporary password (the router locks every other page until it is done —
/// then there is no way back, only "Sign out"), and opened from Profile → Change password otherwise. Same password rules as the server.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _current = TextEditingController(), _new = TextEditingController(), _confirm = TextEditingController();
  /// Latched: once the screen has been shown for a temporary password it stays in that mode (the flag flips the moment the change succeeds).
  bool _forced = false;
  bool _busy = false;
  String? _currentError, _newError;

  bool get _ok => _current.text.isNotEmpty && checkPassword(_new.text).ok && _new.text == _confirm.text && _new.text != _current.text;

  @override
  void dispose() { _current.dispose(); _new.dispose(); _confirm.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_busy || !_ok) return;
    setState(() { _busy = true; _currentError = _newError = null; });
    try {
      final outcome = await changePasswordAndContinue(ref, _current.text, _new.text);
      if (!mounted) return;
      if (outcome == PasswordChangeOutcome.signedOut) return; // the router already shows the sign-in screen with its notice
      toast(context, context.tr('m.au_cp_done'));
      context.go(_forced ? '/' : '/profile'); // `go`, not `pop`: the session update above re-evaluates the router, which could undo a pop
    } catch (e) {
      if (!mounted) return;
      if (e is ApiException && e.code == 'UNAUTHENTICATED') {
        // The same code means "wrong current password" and "your session is gone": ask the server which one it is.
        if (await sessionExpired(ref)) { ref.read(authProvider.notifier).expire(); return; }
        if (mounted) setState(() => _currentError = context.tr('m.au_cp_wrong_current'));
      } else if (e is ApiException && e.code == 'VALIDATION') {
        setState(() => _newError = context.tr('m.au_err_field'));
      } else {
        toast(context, errMessage(context, e), error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    if (ref.watch(authProvider).value?.mustChangePassword == true) _forced = true;
    final same = _new.text.isNotEmpty && _new.text == _current.text;
    return PopScope(
      canPop: !_forced,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: !_forced, title: Text(t(_forced ? 'm.au_cp_forced_title' : 'm.au_cp_title')),
          actions: [if (_forced) TextButton(key: const Key('cp-signout'), onPressed: _busy ? null : () => ref.read(authProvider.notifier).signOut(), child: Text(t('auth.logout')))],
        ),
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(20), children: [
            if (_forced) ...[Banner2(key: const Key('cp-forced'), tone: Tone.warn, text: t('m.au_cp_forced_sub')), const SizedBox(height: 16)]
            else ...[Text(t('m.au_cp_sub'), style: TextStyle(color: JR.muted, height: 1.4)), const SizedBox(height: 16)],
            AutofillGroup(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              PasswordField(id: 'cp-current', controller: _current, label: t('m.au_cp_current'), readOnly: _busy, errorText: _currentError, onChanged: (_) => setState(() => _currentError = null)),
              const SizedBox(height: 14),
              PasswordField(id: 'cp-new', controller: _new, label: t('m.au_cp_new'), hints: const [AutofillHints.newPassword], readOnly: _busy, errorText: same ? t('m.au_cp_same') : _newError, onChanged: (_) => setState(() => _newError = null)),
              const SizedBox(height: 14),
              PasswordField(id: 'cp-confirm', controller: _confirm, label: t('m.au_cp_confirm'), hints: const [AutofillHints.newPassword], readOnly: _busy, action: TextInputAction.done, onChanged: (_) => setState(() {}), onSubmitted: (_) => _submit(),
                  errorText: _confirm.text.isNotEmpty && _confirm.text != _new.text ? t('m.au_pw_mismatch') : null),
            ])),
            const SizedBox(height: 10),
            PasswordChecklist(password: _new.text, confirm: _confirm.text),
            const SizedBox(height: 20),
            FilledButton(key: const Key('cp-submit'), onPressed: _ok && !_busy ? _submit : null, child: _busy ? SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('m.au_cp_submit'))),
          ]),
        ),
      ),
    );
  }
}
