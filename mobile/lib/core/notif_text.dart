import '../data/models_extra.dart' show AppNotification;
import 'i18n.dart';

/// The text of an in-app notification — the same rule as the web (`web/src/lib/notif-text.ts`): a raw `{placeholder}` is NEVER shown.
///  1. full template when every placeholder has a value (cities by their localized name, `amount` from `amountCents`);
///  2. else the short variant `notif.<type>__short` when it exists and is fully supplied (a vehicle-day offer has no parcel count);
///  3. else the template cut before its first missing placeholder ("New job offer JR-000012");
///  4. nothing usable left, or a type this build has no text for → [genericKey].
final _placeholder = RegExp(r'\{([A-Za-z_][A-Za-z0-9_]*)\}');
List<String> placeholdersOf(String template) => {for (final m in _placeholder.allMatches(template)) m.group(1)!}.toList();

String notificationText(Strings t, AppNotification n, {String? type, String genericKey = 'um.notif_generic'}) {
  final key = 'notif.${type ?? n.type}';
  if (!t.has(key)) return t(genericKey);
  final vars = <String, Object?>{...n.vars(city: (k) => t.has('city.$k') ? t('city.$k') : k)}..removeWhere((_, v) => '${v ?? ''}'.isEmpty);
  final raw = t(key);
  final full = placeholdersOf(raw);
  if (full.every(vars.containsKey)) return t(key, vars);
  final shortKey = '${key}__short';
  if (t.has(shortKey) && placeholdersOf(t(shortKey)).every(vars.containsKey)) return t(shortKey, vars);
  final at = full.where((p) => !vars.containsKey(p)).map((p) => raw.indexOf('{$p}')).reduce((a, b) => a < b ? a : b);
  var head = raw.substring(0, at);
  vars.forEach((k, v) => head = head.replaceAll('{$k}', '$v'));
  head = head.replaceAll(RegExp(r'[\s:：\-–—,،;؛.]+$'), '');
  return head.length >= 3 && placeholdersOf(head).isEmpty ? head : t(genericKey);
}
