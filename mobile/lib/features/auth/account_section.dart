import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart';
import 'auth_rules.dart';
import 'auth_widgets.dart';
import 'username_field.dart';

/// The sign-in part of the sign-up form: username (live availability), password + confirmation with the live checklist, and the contact phone.
/// State lives in the screen (controllers, [username] state, inline [errors] by field); this widget only lays the fields out.
class AccountSection extends StatelessWidget {
  const AccountSection({super.key, required this.username, required this.password, required this.confirm, required this.phone, required this.check, required this.onUsernameState, required this.onChanged, required this.errors});
  final TextEditingController username, password, confirm, phone;
  final Future<Json> Function(String) check;
  final ValueChanged<UsernameState> onUsernameState;
  final VoidCallback onChanged;
  final Map<String, String> errors;

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final mismatch = confirm.text.isNotEmpty && confirm.text != password.text;
    return AutofillGroup(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        UsernameField(controller: username, check: check, onState: onUsernameState, serverError: errors['username']),
        const SizedBox(height: 14),
        PasswordField(id: 'password', controller: password, label: t('m.au_password'), hints: const [AutofillHints.newPassword], errorText: errors['password'], onChanged: (_) => onChanged()),
        const SizedBox(height: 14),
        PasswordField(id: 'confirm', controller: confirm, label: t('m.au_confirm_password'), hints: const [AutofillHints.newPassword], errorText: mismatch ? t('m.au_pw_mismatch') : null, onChanged: (_) => onChanged()),
        const SizedBox(height: 10),
        PasswordChecklist(password: password.text, confirm: confirm.text),
        const SizedBox(height: 14),
        TextField(
          key: const Key('phone'), controller: phone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, autofillHints: const [AutofillHints.telephoneNumber],
          inputFormatters: const [LatinDigitsFormatter()], textInputAction: TextInputAction.next, onChanged: (_) => onChanged(),
          decoration: InputDecoration(
            labelText: t('auth.phone'), hintText: '05XXXXXXXX', prefixIcon: const Icon(Icons.phone_outlined), helperText: t('m.au_phone_note'), helperMaxLines: 2,
            errorText: errors['phone'] ?? (phone.text.isNotEmpty && !phoneValid(phone.text) ? t('m.au_phone_invalid') : null), errorMaxLines: 2,
          ),
        ),
      ]),
    );
  }
}
