import 'dart:math' as math;
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'i18n.dart';

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

/// Saudi time (Asia/Riyadh is UTC+3 all year, no DST, so no tz database is needed). Null for unparseable input.
DateTime? _ksa(String iso) => DateTime.tryParse(iso)?.toUtc().add(const Duration(hours: 3));
String _two(int n) => n.toString().padLeft(2, '0');

/// Manual formatting: no intl locale-data initialisation to forget, Latin digits, localized month names.
String fmtDateTime(String? iso, String lang) {
  final d = iso == null ? null : _ksa(iso);
  if (d == null) return '—';
  return '${d.day} ${(_months[lang] ?? _months['en']!)[d.month - 1]} ${d.year} · ${_two(d.hour)}:${_two(d.minute)}';
}

String fmtTime(String? iso) {
  final d = iso == null ? null : _ksa(iso);
  if (d == null) return '—';
  return '${_two(d.hour)}:${_two(d.minute)}';
}

/// "m:ss" for a countdown.
String fmtCountdown(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Driving distance in the driver's language ("4.2 km" / "4.2 كم"). The unit comes from the dictionary, the number is always Latin digits
/// (so it never flips inside right-to-left text). One decimal; whole km from 100 km up.
String fmtDist(Strings t, num meters) => t('rm.km', {'n': (meters / 1000).toStringAsFixed(meters >= 100000 ? 0 : 1)});

/// Short straight-line distance for the geofence read-out: "340 m" under a kilometre, "1.2 km" above (Latin digits, localized unit).
String fmtMeters(Strings t, num meters) => meters < 1000 ? t('fma.m', {'n': meters.round()}) : fmtDist(t, meters);

/// Driving time in the driver's language ("12 min", "1 h 5 min"). A real but very short leg reads "1 min", never "0 min".
String fmtTravel(Strings t, num seconds) {
  final m = seconds <= 0 ? 0 : math.max(1, (seconds / 60).round());
  if (m < 60) return t('rm.min', {'n': m});
  final h = m ~/ 60, r = m % 60;
  return r == 0 ? t('rm.hours', {'h': h}) : t('rm.h_min', {'h': h, 'm': r});
}

/// Saudi IBAN: SA + 22 digits. Returns the canonical (no spaces, upper-case) form or null — same rule as the server.
String? normalizeIban(String raw) {
  final v = raw.replaceAll(RegExp(r'\s'), '').toUpperCase();
  return RegExp(r'^SA\d{22}$').hasMatch(v) ? v : null;
}

/// Parses SAR typed by the user into integer halalas without float drift.
int? sarToCents(String input) {
  final s = latinDigits(input).trim().replaceAll(',', '.');
  // At most 9 whole digits (the server accepts up to SAR 10 000 000): a longer string used to overflow `int` or throw in `int.parse`.
  if (!RegExp(r'^\d{1,9}(\.\d{1,2})?$').hasMatch(s)) return null;
  final parts = s.split('.');
  final whole = int.parse(parts[0]);
  final frac = parts.length > 1 ? int.parse(parts[1].padRight(2, '0')) : 0;
  return whole * 100 + frac;
}


/// Arabic-Indic (٠-٩) and Persian/Urdu (۰-۹) digits -> Latin. Numeric keyboards in Arabic/Urdu locales can type these, and every
/// server-side rule (phone, OTP, amounts, IDs) expects ASCII digits; without this a typed code would silently fail or be dropped.
String latinDigits(String s) {
  final b = StringBuffer();
  for (final r in s.runes) {
    if (r >= 0x0660 && r <= 0x0669) { b.writeCharCode(r - 0x0660 + 0x30); }
    else if (r >= 0x06F0 && r <= 0x06F9) { b.writeCharCode(r - 0x06F0 + 0x30); }
    else if (r == 0x066B || r == 0x060C) { b.write(r == 0x066B ? '.' : ','); } // Arabic decimal / comma
    else { b.writeCharCode(r); }
  }
  return b.toString();
}

/// Converts Arabic-Indic digits to Latin as the user types (apply before any digit-only filter).
class LatinDigitsFormatter extends TextInputFormatter {
  const LatinDigitsFormatter();
  @override
  TextEditingValue formatEditUpdate(TextEditingValue old, TextEditingValue next) {
    final t = latinDigits(next.text);
    return t == next.text ? next : next.copyWith(text: t);
  }
}

/// Digits only (Latin), optionally capped: the formatter list for OTP / phone / ID fields.
List<TextInputFormatter> digitsOnly({int? max}) => [const LatinDigitsFormatter(), FilteringTextInputFormatter.digitsOnly, if (max != null) LengthLimitingTextInputFormatter(max)];
