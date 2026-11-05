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
