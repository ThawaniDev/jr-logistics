import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

/// Edit the account fields a driver may change: contact, vehicle, services and payout (bank + IBAN).
/// Availability is not here — going online has its own flow (verification, suspension, location consent).
class EditProfileScreen extends ConsumerWidget {
  const EditProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(profileProvider);
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('m.edit_profile'))),
      body: AsyncBody(value: p, onRetry: () => ref.invalidate(profileProvider), builder: (d) => _EditForm(data: d)),
    );
  }
}

class _EditForm extends ConsumerStatefulWidget {
  const _EditForm({required this.data});
  final Json data;
  @override
  ConsumerState<_EditForm> createState() => _EditFormState();
}

class _EditFormState extends ConsumerState<_EditForm> {
  late final Json _user = ((widget.data['user'] as Map?) ?? const {}).cast<String, dynamic>();
  late final Json _p = ((widget.data['profile'] as Map?) ?? const {}).cast<String, dynamic>();
  late final _name = TextEditingController(text: '${_user['name'] ?? ''}');
  late final _email = TextEditingController(text: '${_user['email'] ?? ''}');
  late final _plate = TextEditingController(text: '${_p['vehiclePlate'] ?? ''}');
  late final _nid = TextEditingController(text: '${_p['nationalId'] ?? ''}');
  late final _bank = TextEditingController(text: '${_p['bankName'] ?? ''}');
  late final _iban = TextEditingController(text: '${_p['iban'] ?? ''}');
  late String? _city = _user['city'] as String?;
  late String? _vehicle = _p['vehicleType'] as String?;
  late String? _temp = _p['vehicleTemperature'] as String?;
  late final Set<String> _services = {...((_p['services'] as List?) ?? const []).cast<String>()};
  bool _busy = false, _submitted = false;
  Map<String, String> _server = {};

  bool get _needTemp => _vehicle == 'van' || _vehicle == 'dyna';
  bool get _ibanOk => _iban.text.trim().isEmpty || normalizeIban(_iban.text) != null;
  bool get _emailOk => _email.text.trim().isEmpty || RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(_email.text.trim());
  bool get _valid => _name.text.trim().length >= 2 && _ibanOk && _emailOk && _services.isNotEmpty && (!_needTemp || _temp != null);

  @override
  void dispose() {
    for (final c in [_name, _email, _plate, _nid, _bank, _iban]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() { _submitted = true; _server = {}; });
    if (!_valid) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(apiProvider).updateProfile({
        'name': _name.text.trim(), if (_city != null) 'city': _city, 'email': _email.text.trim(),
        if (_vehicle != null) 'vehicleType': _vehicle, if (_needTemp) 'vehicleTemperature': _temp,
        'vehiclePlate': _plate.text.trim(), 'nationalId': _nid.text.trim(), 'services': _services.toList(),
        'bankName': _bank.text.trim(), if (_iban.text.trim().isNotEmpty) 'iban': normalizeIban(_iban.text),
      });
      if (r['user'] is Map) ref.read(authProvider.notifier).updateUser((r['user'] as Map).cast<String, dynamic>());
      ref.invalidate(profileProvider);
      ref.invalidate(overviewProvider);
      if (!mounted) return;
      toast(context, context.tr('common.saved'));
      Navigator.of(context).maybePop();
    } catch (e) {
      if (!mounted) return;
      final d = e is ApiException ? e.details : const <String, dynamic>{};
      final field = d['field'];
      // Validation errors come keyed by field: show them next to the input, and toast the general message too.
      if (field is String) setState(() => _server = {field: '${d[field] ?? ''}'});
      toast(context, errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final cat = ref.watch(catalogProvider).value;
    final cities = ((cat?['cities'] as List?) ?? const []).cast<Map>();
    final vehicles = ((cat?['vehicleTypes'] as List?) ?? const []).cast<String>();
    final svcs = ((cat?['services'] as List?) ?? const []).cast<Map>().where((s) => s['driverless'] != true);
    String? err(String field, bool localInvalid, String localMsg) => _submitted || _server.containsKey(field) ? (localInvalid ? localMsg : _server[field]) : null;
    final changedIban = '${_p['iban'] ?? ''}'.isNotEmpty && normalizeIban(_iban.text) != _p['iban'];
    return SafeArea(
      child: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(key: const Key('edit-name'), controller: _name, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: t('reg.full_name'), errorText: _submitted && _name.text.trim().length < 2 ? t('err.VALIDATION') : null)),
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(initialValue: cities.any((c) => c['key'] == _city) ? _city : null, decoration: InputDecoration(labelText: t('reg.city')), items: [for (final c in cities) DropdownMenuItem(value: c['key'] as String, child: Text('${c[lang]}'))], onChanged: (v) => setState(() => _city = v)),
        const SizedBox(height: 14),
        TextField(key: const Key('edit-email'), controller: _email, onChanged: (_) => setState(() {}), keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('profile.email'), errorText: err('email', !_emailOk, t('profile.invalid_email')))),
        const SizedBox(height: 22),
        Text(t('profile.vehicle_section'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: vehicles.contains(_vehicle) ? _vehicle : null, decoration: InputDecoration(labelText: t('reg.vehicle')), items: [for (final v in vehicles) DropdownMenuItem(value: v, child: Text(t('vehicle.$v')))], onChanged: (v) => setState(() { _vehicle = v; if (!_needTemp) _temp = null; })),
        if (_needTemp) ...[
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(key: const Key('edit-temp'), initialValue: _temp, decoration: InputDecoration(labelText: t('reg.temperature'), errorText: err('vehicleTemperature', _temp == null, t('profile.temp_required'))), items: [for (final v in ['dry', 'cold']) DropdownMenuItem(value: v, child: Text(t('temp.$v')))], onChanged: (v) => setState(() => _temp = v)),
        ],
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: TextField(key: const Key('edit-plate'), controller: _plate, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.plate')))),
          const SizedBox(width: 12),
          Expanded(child: TextField(key: const Key('edit-nid'), controller: _nid, keyboardType: TextInputType.number, inputFormatters: digitsOnly(max: 12), textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('reg.national_id')))),
        ]),
        const SizedBox(height: 16),
        Text(t('reg.services'), style: const TextStyle(color: JR.muted, fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final s in svcs) FilterChip(label: Text(t('svc.${s['key']}')), selected: _services.contains(s['key']), selectedColor: JR.accent.withValues(alpha: 0.2), checkmarkColor: JR.accent, side: const BorderSide(color: JR.line), onSelected: (v) => setState(() => v ? _services.add(s['key'] as String) : _services.remove(s['key']))),
        ]),
        if ((_submitted && _services.isEmpty) || _server.containsKey('services')) Padding(padding: const EdgeInsets.only(top: 4), child: Text(t('profile.services_required'), style: const TextStyle(color: JR.danger, fontSize: 12))),
        const SizedBox(height: 22),
        Text(t('profile.payout_section'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        TextField(key: const Key('edit-bank'), controller: _bank, decoration: InputDecoration(labelText: t('profile.bank'))),
        const SizedBox(height: 14),
        TextField(key: const Key('edit-iban'), controller: _iban, onChanged: (_) => setState(() {}), textCapitalization: TextCapitalization.characters, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: t('profile.iban'), hintText: 'SA…', helperText: t('profile.iban_hint'), errorText: !_ibanOk ? t('profile.iban_invalid') : (_server.containsKey('iban') ? t('profile.iban_invalid') : null))),
        if (changedIban) Padding(padding: const EdgeInsets.only(top: 10), child: Banner2(text: t('profile.iban_change_warn'))),
        const SizedBox(height: 24),
        FilledButton(key: const Key('edit-save'), onPressed: _busy ? null : _save, child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: JR.accentInk)) : Text(t('common.save'))),
      ]),
    );
  }
}
