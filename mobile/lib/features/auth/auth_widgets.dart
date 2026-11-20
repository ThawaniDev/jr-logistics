import 'package:flutter/material.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import 'auth_rules.dart';

/// A password input with a show/hide toggle. Always left-to-right (passwords are Latin text), no suggestions, autofill-aware.
/// [id] becomes the field key (`Key(id)`) and the toggle key (`Key('$id-toggle')`).
class PasswordField extends StatefulWidget {
  const PasswordField({super.key, required this.id, required this.controller, required this.label, this.hints = const [AutofillHints.password], this.errorText, this.onChanged, this.onSubmitted, this.readOnly = false, this.action = TextInputAction.next, this.enabled = true});
  final String id, label;
  final TextEditingController controller;
  final Iterable<String> hints;
  final String? errorText;
  final ValueChanged<String>? onChanged, onSubmitted;
  final TextInputAction action;
  final bool enabled;
  /// Read-only (not disabled) while a request is running: a disabled field drops focus, so the keyboard would close after every failed attempt.
  final bool readOnly;
  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _show = false;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    return TextField(
      key: Key(widget.id), controller: widget.controller, enabled: widget.enabled, readOnly: widget.readOnly, obscureText: !_show, autocorrect: false, enableSuggestions: false,
      autofillHints: widget.hints, textInputAction: widget.action, textDirection: TextDirection.ltr, onChanged: widget.onChanged, onSubmitted: widget.onSubmitted,
      decoration: InputDecoration(
        labelText: widget.label, errorText: widget.errorText, errorMaxLines: 3, prefixIcon: const Icon(Icons.lock_outline),
        suffixIcon: IconButton(key: Key('${widget.id}-toggle'), tooltip: t(_show ? 'm.au_hide_password' : 'm.au_show_password'), icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined), onPressed: () => setState(() => _show = !_show)),
      ),
    );
  }
}

/// The live "your password needs…" list. [confirm] (when given) adds the "both passwords match" line.
class PasswordChecklist extends StatelessWidget {
  const PasswordChecklist({super.key, required this.password, this.confirm});
  final String password;
  final String? confirm;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final c = checkPassword(password);
    Widget row(String id, bool ok, String text) => Semantics(
          container: true, label: '$text: ${ok ? '✓' : '✗'}',
          child: ExcludeSemantics(child: Padding(padding: const EdgeInsets.only(top: 4), child: Row(key: Key(id), children: [
            Icon(ok ? Icons.check_circle : Icons.radio_button_unchecked, size: 18, color: ok ? JR.accent : JR.muted), const SizedBox(width: 8),
            Expanded(child: Text(text, style: TextStyle(fontSize: 13, color: ok ? JR.text : JR.muted))),
          ]))),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(t('m.au_pw_rules'), style: const TextStyle(color: JR.muted, fontSize: 13)),
      row('pw-rule-len', c.long, t('m.au_pw_len')),
      row('pw-rule-letter', c.letter, t('m.au_pw_letter')),
      row('pw-rule-digit', c.digit, t('m.au_pw_digit')),
      if (confirm != null) row('pw-rule-match', password.isNotEmpty && password == confirm, t('m.au_pw_match')),
    ]);
  }
}
