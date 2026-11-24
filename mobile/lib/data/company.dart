import 'api_client.dart';

/// How to reach the platform's support team: the `company` block of `GET /catalog` (Settings › Company on the web). Every channel is optional; an empty one is hidden.
class SupportContact {
  const SupportContact({this.phone = '', this.whatsapp = '', this.email = '', this.hours = ''});
  final String phone, whatsapp, email, hours;
  static const none = SupportContact();

  /// Hidden while no channel is filled in (hours alone are not a way to reach anyone).
  bool get any => phone.isNotEmpty || whatsapp.isNotEmpty || email.isNotEmpty;

  /// WhatsApp deep link: digits only (the number is stored with the country code, e.g. `9665…`; a leading `+` / `00` / spaces are ignored).
  Uri? get whatsappUri {
    var d = whatsapp.replaceAll(RegExp(r'[^0-9]'), '');
    if (d.startsWith('00')) d = d.substring(2);
    return d.length < 7 ? null : Uri.parse('https://wa.me/$d');
  }
  Uri? get emailUri => email.contains('@') ? Uri(scheme: 'mailto', path: email) : null;

  /// Reads `catalog.company`; hours in Arabic for the Arabic app, English for the others (the web does the same).
  factory SupportContact.fromCatalog(Json? catalog, String lang) {
    final c = mapOf(catalog?['company']);
    if (c == null) return none;
    String f(String k) => (strOf(c[k]) ?? '').trim();
    final hours = lang == 'ar' ? (f('supportHoursAr').isNotEmpty ? f('supportHoursAr') : f('supportHoursEn')) : (f('supportHoursEn').isNotEmpty ? f('supportHoursEn') : f('supportHoursAr'));
    return SupportContact(phone: f('supportPhone'), whatsapp: f('supportWhatsapp'), email: f('supportEmail'), hours: hours);
  }
}
