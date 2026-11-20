import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import 'auth_rules.dart';

/// Where a typed username stands. `unchecked` = the availability call failed (offline…): sign-up stays possible, the server decides on submit.
enum UsernameState { empty, tooShort, checking, available, taken, reserved, unchecked }

extension UsernameStateX on UsernameState {
  /// The sign-up button may be enabled in these states.
  bool get submittable => this == UsernameState.available || this == UsernameState.unchecked;
}

/// The username input of the sign-up form: canonicalises while typing, then asks `GET /auth/username-available` once the driver stops typing
/// ([debounce]). A slow answer for an older value never overwrites a newer one. [serverError] (a `409` from the submit) is shown in red until the next edit.
class UsernameField extends StatefulWidget {
  const UsernameField({super.key, required this.controller, required this.check, required this.onState, this.serverError, this.debounce = const Duration(milliseconds: 450)});
  final TextEditingController controller;
  final Future<Json> Function(String username) check;
  final ValueChanged<UsernameState> onState;
  final String? serverError;
  final Duration debounce;
  @override
  State<UsernameField> createState() => _UsernameFieldState();
}

class _UsernameFieldState extends State<UsernameField> {
  Timer? _timer;
  int _seq = 0;
  UsernameState _state = UsernameState.empty;

  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  void _set(UsernameState s) {
    if (!mounted) return;
    setState(() => _state = s);
    widget.onState(s);
  }

  void _changed(String raw) {
    _timer?.cancel();
    final seq = ++_seq;
    final v = normalizeUsername(raw);
    if (v.isEmpty) return _set(UsernameState.empty);
    if (!usernameValid(v)) return _set(UsernameState.tooShort);
    _set(UsernameState.checking);
    _timer = Timer(widget.debounce, () async {
      UsernameState next;
      try {
        final r = await widget.check(v);
        next = r['available'] == true ? UsernameState.available : (r['reason'] == 'reserved' ? UsernameState.reserved : r['reason'] == 'invalid' ? UsernameState.tooShort : UsernameState.taken);
      } catch (_) {
        next = UsernameState.unchecked;
      }
      if (mounted && seq == _seq) _set(next);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final (helper, error, icon) = switch (_state) {
      _ when widget.serverError != null => (null, widget.serverError, const Icon(Icons.error_outline, color: JR.danger)),
      UsernameState.empty || UsernameState.tooShort => (t('m.au_un_rules'), null, null),
      UsernameState.checking => (t('m.au_un_checking'), null, const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accent)))),
      UsernameState.available => (t('m.au_un_ok'), null, const Icon(Icons.check_circle, color: JR.accent)),
      UsernameState.taken => (null, t('m.au_un_taken'), const Icon(Icons.error_outline, color: JR.danger)),
      UsernameState.reserved => (null, t('m.au_un_reserved'), const Icon(Icons.error_outline, color: JR.danger)),
      UsernameState.unchecked => (t('m.au_un_unchecked'), null, const Icon(Icons.help_outline, color: JR.gold)),
    };
    return TextField(
      key: const Key('username'), controller: widget.controller, onChanged: _changed, autofillHints: const [AutofillHints.newUsername], keyboardType: TextInputType.visiblePassword,
      autocorrect: false, enableSuggestions: false, textCapitalization: TextCapitalization.none, textInputAction: TextInputAction.next, textDirection: TextDirection.ltr,
      inputFormatters: const [UsernameFormatter()],
      decoration: InputDecoration(
        labelText: t('m.au_username'), prefixIcon: const Icon(Icons.person_outline), suffixIcon: icon,
        helperText: helper, helperMaxLines: 3, helperStyle: TextStyle(color: _state == UsernameState.available ? JR.accent : JR.muted, fontSize: 12, height: 1.3),
        errorText: error, errorMaxLines: 3,
      ),
    );
  }
}
