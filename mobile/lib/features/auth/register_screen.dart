import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'account_section.dart';
import 'auth_rules.dart';
import 'auth_session.dart';
import 'username_field.dart';

/// Driver sign-up: username + password + contact phone (no one-time code) and the same profile fields as before.
/// The account is verified by the team through documents afterwards. `409` field errors (username / phone) are shown inline.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _username = TextEditingController(), _password = TextEditingController(), _confirm = TextEditingController(), _phone = TextEditingController();
  final _name = TextEditingController(), _plate = TextEditingController(), _nid = TextEditingController(), _bank = TextEditingController(), _iban = TextEditingController();
  String? _city, _vehicle, _temp;
  final _services = <String>{'delivery_driver'};
  bool _terms = false, _busy = false;
  UsernameState _un = UsernameState.empty;
  Map<String, String> _errors = {};

  bool get _needTemp => _vehicle == 'van' || _vehicle == 'dyna';
  /// Optional at sign-up, but when typed it must be a Saudi IBAN (SA + 22 digits) — same rule as the server.
  bool get _ibanOk => _iban.text.trim().isEmpty || normalizeIban(_iban.text) != null;
  bool get _passwordOk => checkPassword(_password.text).ok && _password.text == _confirm.text;

  @override
  void dispose() {
    for (final c in [_username, _password, _confirm, _phone, _name, _plate, _nid, _bank, _iban]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final lang = ref.read(localeProvider);
    setState(() { _busy = true; _errors = {}; });
    try {
      final r = await ref.read(apiProvider).register({
        'role': 'driver', 'username': normalizeUsername(_username.text), 'password': _password.text, 'name': _name.text.trim(), 'phone': phoneDigits(_phone.text), 'city': _city, 'language': lang,
        'vehicleType': _vehicle, if (_needTemp) 'vehicleTemperature': _temp, 'services': _services.toList(), 'termsAccepted': _terms,
        if (_plate.text.isNotEmpty) 'vehiclePlate': _plate.text.trim(), if (_nid.text.isNotEmpty) 'nationalId': _nid.text.trim(),
        if (_bank.text.trim().isNotEmpty) 'bankName': _bank.text.trim(), if (_iban.text.trim().isNotEmpty) 'iban': normalizeIban(_iban.text),
      });
      final token = r['token'], user = r['user'];
      if (token is! String || user is! Map) throw ApiException('BAD_RESPONSE', 'register: missing token/user');
      await ref.read(prefsProvider).setString(lastUsernameKey, normalizeUsername(_username.text));
      await ref.read(authProvider.notifier).signIn(token, user.cast<String, dynamic>());
    } catch (e) {
      if (!mounted) return;
      final fields = registerFieldErrors(context.tr, e);
      setState(() { _errors = fields; if (fields.containsKey('username')) _un = UsernameState.taken; });
      // The answer may simply not have come back: the account can exist already, so a second try would say "username taken" — point at signing in instead.
      toast(context, fields.isNotEmpty ? fields.values.first : e is ApiException && e.isNetwork ? context.tr('m.reg_unconfirmed') : errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final catAsync = ref.watch(catalogProvider);
    final cat = catAsync.value;
    final lang = ref.watch(localeProvider);
    final cities = listOf(cat?['cities']).whereType<Map>().toList();
    final vehicles = listOf(cat?['vehicleTypes']).whereType<String>().toList();
    final svcs = listOf(cat?['services']).whereType<Map>().where((s) => s['driverless'] != true);
    final termsText = strOf(mapOf(cat?['terms'])?['driver']) ?? '';
    final ok = _un.submittable && _passwordOk && phoneValid(_phone.text) && _name.text.trim().length >= 2 && _city != null && _vehicle != null && (!_needTemp || _temp != null) && _services.isNotEmpty && _ibanOk && _terms;
    Widget heading(String s) => Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(s, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)));
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/login')), title: Text(t('reg.title'))),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Text(t('m.au_reg_sub'), style: TextStyle(color: JR.muted, height: 1.4)),
          const SizedBox(height: 20),
          // The city / vehicle / service lists come from the server. Without them the form is unusable: say why and offer a retry.
          if (catAsync.hasError && cat == null) ...[Banner2(key: const Key('catalog-error'), tone: Tone.warn, text: t('um.catalog_failed'), action: OutlinedButton.icon(onPressed: () => ref.invalidate(catalogProvider), icon: const Icon(Icons.refresh), label: Text(t('common.retry')))), const SizedBox(height: 16)]
          else if (cat == null) ...[Padding(padding: EdgeInsets.only(bottom: 16), child: LinearProgressIndicator(color: JR.accent, backgroundColor: JR.line)),],
          heading(t('m.au_section_account')),
          AccountSection(
            username: _username, password: _password, confirm: _confirm, phone: _phone, errors: _errors, check: ref.read(apiProvider).usernameAvailable,
            onUsernameState: (s) { _un = s; if (_errors.containsKey('username')) { _errors = {..._errors}..remove('username'); } if (mounted) setState(() {}); },
            onChanged: () => setState(() { if (_errors.isNotEmpty) _errors = {}; }),
          ),
          const SizedBox(height: 24),
          heading(t('m.au_section_you')),
          TextField(key: const Key('name'), controller: _name, onChanged: (_) => setState(() {}), textInputAction: TextInputAction.next, decoration: InputDecoration(labelText: t('reg.full_name'), errorText: _errors['name'])),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(initialValue: _city, decoration: InputDecoration(labelText: t('reg.city')), items: [for (final c in cities) DropdownMenuItem(value: c['key'] as String, child: Text('${c[lang]}'))], onChanged: (v) => setState(() => _city = v)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(initialValue: _vehicle, decoration: InputDecoration(labelText: t('reg.vehicle'), errorText: _errors['vehicleType']), items: [for (final v in vehicles) DropdownMenuItem(value: v, child: Text(t.val('vehicle', v)))], onChanged: (v) => setState(() { _vehicle = v; if (!_needTemp) _temp = null; })),
          if (_needTemp) ...[
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(initialValue: _temp, decoration: InputDecoration(labelText: t('reg.temperature'), errorText: _errors['vehicleTemperature']), items: [for (final v in ['dry', 'cold']) DropdownMenuItem(value: v, child: Text(t.val('temp', v)))], onChanged: (v) => setState(() => _temp = v)),
          ],
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: TextField(controller: _plate, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.plate')))),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: _nid, keyboardType: TextInputType.number, inputFormatters: digitsOnly(max: 12), textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.national_id')))),
          ]),
          const SizedBox(height: 14),
          TextField(key: const Key('bank'), controller: _bank, decoration: InputDecoration(labelText: t('profile.bank'))),
          const SizedBox(height: 14),
          TextField(key: const Key('iban'), controller: _iban, onChanged: (_) => setState(() {}), textCapitalization: TextCapitalization.characters, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('profile.iban'), hintText: 'SA…', helperText: t('profile.iban_hint'), errorText: _ibanOk ? _errors['iban'] : t('profile.iban_invalid'))),
          const SizedBox(height: 18),
          Text(t('reg.services'), style: TextStyle(color: JR.muted, fontSize: 13)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in svcs)
              FilterChip(label: Text(t.val('svc', s['key'])), selected: _services.contains(s['key']), selectedColor: JR.accent.withValues(alpha: 0.2), checkmarkColor: JR.accent, side: BorderSide(color: JR.line), onSelected: (v) => setState(() => v ? _services.add(s['key'] as String) : _services.remove(s['key']))),
          ]),
          if (_errors['services'] != null) Text(_errors['services']!, style: TextStyle(color: JR.danger, fontSize: 12)),
          const SizedBox(height: 18),
          SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('reg.terms_title'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(termsText.isEmpty ? t('reg.terms_default_driver') : termsText, style: TextStyle(color: JR.muted, fontSize: 13, height: 1.5)),
            CheckboxListTile(key: const Key('terms'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: JR.accent, checkColor: JR.accentInk, value: _terms, onChanged: (v) => setState(() => _terms = v ?? false), title: Text(t('reg.terms_accept'), style: const TextStyle(fontSize: 14))),
          ])),
          const SizedBox(height: 20),
          FilledButton(key: const Key('register'), onPressed: ok && !_busy ? _submit : null, child: _busy ? SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('reg.submit'))),
          const SizedBox(height: 12),
          Center(child: Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(t('m.au_have_account'), style: TextStyle(color: JR.muted)),
            TextButton(key: const Key('back-to-login'), onPressed: _busy ? null : () => context.go('/login'), child: Text(t('m.au_sign_in'))),
          ])),
        ]),
      ),
    );
  }
}
