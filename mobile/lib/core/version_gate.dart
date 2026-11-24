import 'app_info.dart';

// Tolerant readers (the same rule as `data/api_client.dart`, which imports this file — so they are repeated here instead of imported).
Map<String, dynamic>? _map(Object? v) => v is Map ? v.cast<String, dynamic>() : null;
String? _str(Object? v) => v is String ? v : null;

/// A version number as the server reads it (`web/src/server/ops-tools/app-version.ts`, which this mirrors): up to four dot-separated numbers and an optional `+build`.
class ParsedVersion {
  const ParsedVersion(this.parts, this.build);
  final List<int> parts;
  final int? build;
}

final _versionPattern = RegExp(r'^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:\+(\d{1,9}))?$');

/// "1.2.3", "1.2", "v1.2.3+45", "1.2.3.4" → parts (a missing one is 0) and the optional build number; anything else → null.
ParsedVersion? parseVersion(Object? raw) {
  final m = _versionPattern.firstMatch('${raw ?? ''}'.trim());
  if (m == null) return null;
  int part(int i) => int.tryParse(m.group(i) ?? '') ?? 0;
  return ParsedVersion([part(1), part(2), part(3), part(4)], m.group(5) == null ? null : int.tryParse(m.group(5)!));
}

/// True when [current] is older than [min]. An unreadable current version counts as older; the build number only counts when the minimum names one.
bool isVersionBelow(ParsedVersion? current, ParsedVersion min) {
  if (current == null) return true;
  for (var i = 0; i < 4; i++) {
    if (current.parts[i] != min.parts[i]) return current.parts[i] < min.parts[i];
  }
  return min.build != null && (current.build ?? 0) < min.build!;
}

/// Why the app must be updated: the `details` of `426 UPGRADE_REQUIRED`, or the catalog's minimum read at start-up.
class UpgradeInfo {
  const UpgradeInfo({this.minVersion = '', this.currentVersion = '', this.platform = '', this.storeUrl = ''});
  final String minVersion, currentVersion, platform, storeUrl;

  factory UpgradeInfo.fromDetails(Map<String, dynamic> d) => UpgradeInfo(minVersion: _str(d['minVersion']) ?? '', currentVersion: _str(d['currentVersion']) ?? '', platform: _str(d['platform']) ?? '', storeUrl: _str(d['storeUrl']) ?? '');

  /// A https link only: the button opens it, so anything else (a typo, `javascript:`) is dropped and the screen says to open the store by hand.
  Uri? get storeUri {
    final u = Uri.tryParse(storeUrl.trim());
    return u != null && u.hasScheme && (u.scheme == 'https' || u.scheme == 'http') && u.host.isNotEmpty ? u : null;
  }
}

/// `catalog.policy.app = { minVersion: {ios, android}, storeUrl: {ios, android} }` against the installed [app]: the update screen's cold-start check
/// (the catalog is exempt from the server's 426, so an outdated app can still read it). Null = up to date, no minimum, or a malformed one (never enforced).
UpgradeInfo? upgradeFromCatalog(Map<String, dynamic> catalog, AppInfo app) {
  final pol = _map(_map(catalog['policy'])?['app']);
  if (pol == null) return null;
  final mins = _map(pol['minVersion']), urls = _map(pol['storeUrl']);
  final raw = (_str(mins?[app.platform]) ?? '').trim();
  final min = parseVersion(raw);
  if (raw.isEmpty || min == null) return null;
  if (!isVersionBelow(parseVersion(app.full), min)) return null;
  final url = (_str(urls?[app.platform]) ?? '').trim();
  return UpgradeInfo(minVersion: raw, currentVersion: app.full, platform: app.platform, storeUrl: url);
}
