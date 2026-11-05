import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key, required this.token, required this.phone});
  final String token;
  final String phone;
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _name = TextEditingController(), _plate = TextEditingController(), _nid = TextEditingController();
  String? _city, _vehicle, _temp;
  final _services = <String>{'delivery_driver'};
  bool _terms = false, _busy = false;
  Map<String, String> _errors = {};

  bool get _needTemp => _vehicle == 'van' || _vehicle == 'dyna';

  Future<void> _submit() async {
    final lang = ref.read(localeProvider);
    setState(() { _busy = true; _errors = {}; });
    try {
      final r = await ref.read(apiProvider).register({
        'registrationToken': widget.token, 'role': 'driver', 'name': _name.text.trim(), 'city': _city, 'language': lang,
        'vehicleType': _vehicle, if (_needTemp) 'vehicleTemperature': _temp, 'services': _services.toList(), 'termsAccepted': _terms,
        if (_plate.text.isNotEmpty) 'vehiclePlate': _plate.text.trim(), if (_nid.text.isNotEmpty) 'nationalId': _nid.text.trim(),
      });
      await ref.read(authProvider.notifier).signIn(r['token'] as String, (r['user'] as Map).cast<String, dynamic>());
    } catch (e) {
      if (!mounted) return;
      final d = e is ApiException ? e.details : const <String, dynamic>{};
      setState(() => _errors = {for (final k in d.keys) k: '${d[k]}'});
      toast(context, errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final cat = ref.watch(catalogProvider).value;
    final lang = ref.watch(localeProvider);
    final cities = ((cat?['cities'] as List?) ?? const []).cast<Map>();
    final vehicles = ((cat?['vehicleTypes'] as List?) ?? const []).cast<String>();
    final svcs = ((cat?['services'] as List?) ?? const []).cast<Map>().where((s) => s['driverless'] != true);
    final termsText = (cat?['terms'] as Map?)?['driver'] as String? ?? '';
    final ok = _name.text.trim().length >= 2 && _city != null && _vehicle != null && (!_needTemp || _temp != null) && _services.isNotEmpty && _terms;
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/login')), title: Text(t('reg.title'))),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Text('${t('reg.sub')} ${widget.phone}', style: const TextStyle(color: JR.muted)),
          const SizedBox(height: 20),
          TextField(controller: _name, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: t('reg.full_name'), errorText: _errors['name'])),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(initialValue: _city, decoration: InputDecoration(labelText: t('reg.city')), items: [for (final c in cities) DropdownMenuItem(value: c['key'] as String, child: Text('${c[lang]}'))], onChanged: (v) => setState(() => _city = v)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(initialValue: _vehicle, decoration: InputDecoration(labelText: t('reg.vehicle'), errorText: _errors['vehicleType']), items: [for (final v in vehicles) DropdownMenuItem(value: v, child: Text(t('vehicle.$v')))], onChanged: (v) => setState(() { _vehicle = v; if (!_needTemp) _temp = null; })),
          if (_needTemp) ...[
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(initialValue: _temp, decoration: InputDecoration(labelText: t('reg.temperature'), errorText: _errors['vehicleTemperature']), items: [for (final v in ['dry', 'cold']) DropdownMenuItem(value: v, child: Text(t('temp.$v')))], onChanged: (v) => setState(() => _temp = v)),
          ],
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: TextField(controller: _plate, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.plate')))),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: _nid, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.national_id')))),
          ]),
          const SizedBox(height: 18),
          Text(t('reg.services'), style: const TextStyle(color: JR.muted, fontSize: 13)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in svcs)
              FilterChip(label: Text(t('svc.${s['key']}')), selected: _services.contains(s['key']), selectedColor: JR.accent.withValues(alpha: 0.2), checkmarkColor: JR.accent, side: const BorderSide(color: JR.line), onSelected: (v) => setState(() => v ? _services.add(s['key'] as String) : _services.remove(s['key']))),
          ]),
          if (_errors['services'] != null) Text(_errors['services']!, style: const TextStyle(color: JR.danger, fontSize: 12)),
          const SizedBox(height: 18),
          SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('reg.terms_title'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(termsText.isEmpty ? t('reg.terms_default_driver') : termsText, style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.5)),
            CheckboxListTile(key: const Key('terms'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: JR.accent, checkColor: JR.accentInk, value: _terms, onChanged: (v) => setState(() => _terms = v ?? false), title: Text(t('reg.terms_accept'), style: const TextStyle(fontSize: 14))),
          ])),
          const SizedBox(height: 20),
          FilledButton(key: const Key('register'), onPressed: ok && !_busy ? _submit : null, child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('reg.submit'))),
        ]),
      ),
    );
  }
}
