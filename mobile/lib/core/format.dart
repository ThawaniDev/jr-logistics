import 'package:intl/intl.dart';

/// Money is always integer halalas; Latin digits keep amounts unambiguous for drivers.
String fmtMoney(int? cents, String lang) {
  if (cents == null) return '—';
  final n = NumberFormat.currency(locale: 'en_US', symbol: '', decimalDigits: 2).format(cents / 100).trim();
  return lang == 'en' ? 'SAR $n' : '$n ر.س';
}

const _months = {
  'en': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  'ar': ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  'ur': ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
};

DateTime _ksa(String iso) => DateTime.parse(iso).toUtc().add(const Duration(hours: 3)); // Saudi time, no tz database needed
String _two(int n) => n.toString().padLeft(2, '0');

/// Manual formatting: no intl locale-data initialisation to forget, Latin digits, localized month names.
String fmtDateTime(String? iso, String lang) {
  if (iso == null) return '—';
  final d = _ksa(iso);
  return '${d.day} ${(_months[lang] ?? _months['en']!)[d.month - 1]} ${d.year} · ${_two(d.hour)}:${_two(d.minute)}';
}

String fmtTime(String? iso) {
  if (iso == null) return '—';
  final d = _ksa(iso);
  return '${_two(d.hour)}:${_two(d.minute)}';
}

String fmtKm(num meters) => '${(meters / 1000).toStringAsFixed(1)} km';

String fmtDuration(num seconds) {
  final m = (seconds / 60).round();
  if (m < 60) return '$m min';
  return '${m ~/ 60} h ${m % 60} min';
}

/// Parses SAR typed by the user into integer halalas without float drift.
int? sarToCents(String input) {
  final s = input.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(s)) return null;
  final parts = s.split('.');
  final whole = int.parse(parts[0]);
  final frac = parts.length > 1 ? int.parse(parts[1].padRight(2, '0')) : 0;
  return whole * 100 + frac;
}

