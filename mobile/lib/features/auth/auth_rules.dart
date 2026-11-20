import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../data/api_client.dart';
import '../../widgets/common.dart';

/// The rules below mirror the server (web `passwordProblem`, the username policy of J1, the old sign-in phone check): one place, no drift.

/// Username policy: 3-30 characters from `[a-z0-9._-]`, starting with a letter or digit. Lower-case is the canonical form.
final _usernameRe = RegExp(r'^[a-z0-9][a-z0-9._-]{2,29}$');
String normalizeUsername(String raw) => latinDigits(raw).trim().toLowerCase();
bool usernameValid(String u) => _usernameRe.hasMatch(u);

/// Keeps a username field canonical while typing: Latin digits, lower-case, only the allowed characters, at most 30.
class UsernameFormatter extends TextInputFormatter {
  const UsernameFormatter();
  @override
  TextEditingValue formatEditUpdate(TextEditingValue old, TextEditingValue next) {
    var t = latinDigits(next.text).toLowerCase().replaceAll(RegExp(r'[^a-z0-9._-]'), '');
    if (t.length > 30) t = t.substring(0, 30);
    if (t == next.text) return next;
    final off = (next.selection.baseOffset - (next.text.length - t.length)).clamp(0, t.length);
    return TextEditingValue(text: t, selection: TextSelection.collapsed(offset: off));
  }
}

/// The sign-in field also accepts an e-mail address, so it only strips whitespace and converts digits.
final loginUsernameFormatters = <TextInputFormatter>[const LatinDigitsFormatter(), FilteringTextInputFormatter.deny(RegExp(r'\s'))];

/// Password policy (same as the server): at least 10 characters, a Latin letter and a digit; at most 200.
class PasswordCheck {
  const PasswordCheck({required this.long, required this.letter, required this.digit});
  final bool long, letter, digit;
  bool get ok => long && letter && digit;
}

PasswordCheck checkPassword(String p) => PasswordCheck(long: p.length >= 10 && p.length <= 200, letter: RegExp(r'[a-zA-Z]').hasMatch(p), digit: RegExp(r'\d').hasMatch(p));

/// A contact number: 9-15 digits, optional leading +, spaces / dashes / brackets ignored (digits typed in any script are accepted).
String phoneDigits(String raw) => latinDigits(raw).replaceAll(RegExp(r'[\s\-()]'), '');
bool phoneValid(String raw) => RegExp(r'^\+?\d{9,15}$').hasMatch(phoneDigits(raw));

/// Dictionary key for a sign-in failure, or null when the generic localized text (`errMessage`) says it best (offline, timeout, server down…).
String? loginErrorKey(Object e) {
  if (e is! ApiException) return null;
  return switch (e.code) {
    'UNAUTHENTICATED' || 'VALIDATION' => 'm.au_err_credentials',
    'RATE_LIMITED' => 'm.au_err_rate',
    'FORBIDDEN' => 'm.au_err_suspended',
    _ => null,
  };
}

String loginErrorMessage(BuildContext c, Object e) {
  final k = loginErrorKey(e);
  return k == null ? errMessage(c, e) : c.tr(k);
}

/// Inline messages for a failed sign-up: `409 CONFLICT details.field` and per-field `422 VALIDATION` details become localized text keyed by field.
/// Raw server text is never shown. Anything that is not field-specific returns an empty map (the caller then shows the general toast).
Map<String, String> registerFieldErrors(Strings t, Object e) {
  if (e is! ApiException) return const {};
  if (e.code == 'CONFLICT') {
    return switch (e.details['field']) {
      'username' => {'username': t('m.au_un_taken')},
      'phone' => {'phone': t('m.au_err_phone_taken')},
      'email' => {'email': t('m.au_err_email_taken')},
      _ => const {},
    };
  }
  if (e.code == 'VALIDATION') {
    final f = e.details['field'];
    final keys = <String>{if (f is String) f, for (final k in e.details.keys) if (k != 'field') k};
    return {for (final k in keys) k: k == 'username' ? t('m.au_un_rules') : k == 'phone' ? t('m.au_phone_invalid') : t('m.au_err_field')};
  }
  return const {};
}
