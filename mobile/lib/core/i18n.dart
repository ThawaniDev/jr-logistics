import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter/widgets.dart';

const supportedCodes = ['ar', 'en', 'ur'];
const langNames = {'ar': 'العربية', 'en': 'English', 'ur': 'اردو'};
bool isRtl(String code) => code == 'ar' || code == 'ur';

/// Same dictionaries as the web app (exported from the web source of truth).
class Strings {
  Strings(this.code, this._dict, this._fallback);
  final String code;
  final Map<String, String> _dict;
  final Map<String, String> _fallback;

  String call(String key, [Map<String, Object?>? vars]) {
    var s = _dict[key] ?? _fallback[key] ?? key;
    vars?.forEach((k, v) => s = s.replaceAll('{$k}', '$v'));
    return s;
  }

  bool has(String key) => _dict.containsKey(key);

  /// The key exists in the active language or in the English fallback (a key that exists nowhere would be shown as itself).
  bool knows(String key) => _dict.containsKey(key) || _fallback.containsKey(key);

  /// `t('<ns>.<value>')` for a [value] the SERVER chose (a status, a reason, a type…). A value this app has no text for yet (a newer server added one)
  /// reads as the value itself ("new status"), never as a raw dictionary key ("jobstatus.new_status").
  String val(String ns, Object? value, [Map<String, Object?>? vars]) {
    final v = '${value ?? ''}';
    if (v.isEmpty) return '';
    final key = '$ns.$v';
    return knows(key) ? call(key, vars) : v.replaceAll('_', ' ');
  }

  static Future<Map<String, String>> _load(String code, [AssetBundle? bundle]) async {
    final raw = await (bundle ?? rootBundle).loadString('assets/i18n/$code.json');
    return (jsonDecode(raw) as Map<String, dynamic>).map((k, v) => MapEntry(k, v as String));
  }

  static Future<Strings> load(String code, {AssetBundle? bundle}) async {
    final en = await _load('en', bundle);
    return Strings(code, code == 'en' ? en : await _load(code, bundle), en);
  }

  static Strings fromMaps(String code, Map<String, String> d, Map<String, String> en) => Strings(code, d, en);
}

class StringsScope extends InheritedWidget {
  const StringsScope({super.key, required this.strings, required super.child});
  final Strings strings;
  static Strings of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<StringsScope>()!.strings;
  @override
  bool updateShouldNotify(StringsScope old) => old.strings.code != strings.code;
}

extension StringsX on BuildContext {
  Strings get tr => StringsScope.of(this);
}
