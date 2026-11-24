import 'dart:io' show Platform;
import 'package:package_info_plus/package_info_plus.dart';
import 'config.dart';

/// Which build of the app is running: sent as `X-App-Version` / `X-App-Platform` on every request (the server answers `426 UPGRADE_REQUIRED` to a build below the
/// platform's minimum) and attached to crash reports. [version] and [build] come from the app's own bundle, so `flutter build --build-name/--build-number` is honoured.
class AppInfo {
  const AppInfo({required this.version, required this.build, required this.platform, this.osVersion = ''});
  final String version, build;
  /// `ios` | `android` — the words the server's settings use.
  final String platform;
  /// The OS release, for crash reports only (never sent as a header).
  final String osVersion;

  /// `1.0.0+1` — what the server compares (the build number only matters when the minimum names one).
  String get full => build.isEmpty ? version : '$version+$build';

  /// What the pubspec says; used until (and in tests where) the bundle cannot be read.
  factory AppInfo.fallback() => AppInfo(version: AppConfig.version, build: AppConfig.build, platform: platformName(), osVersion: osVersionText());

  /// The running app's real version. Never throws: a plugin failure falls back to the pubspec values.
  static Future<AppInfo> read() async {
    try {
      final p = await PackageInfo.fromPlatform();
      final base = AppInfo.fallback();
      return AppInfo(version: p.version.isEmpty ? base.version : p.version, build: p.buildNumber, platform: base.platform, osVersion: base.osVersion);
    } catch (_) {
      return AppInfo.fallback();
    }
  }

  static String platformName() {
    try { return Platform.isIOS ? 'ios' : 'android'; } catch (_) { return 'android'; }
  }

  static String osVersionText() {
    try {
      final v = Platform.operatingSystemVersion.replaceAll(RegExp(r'\s+'), ' ').trim();
      return v.length > 120 ? v.substring(0, 120) : v;
    } catch (_) { return ''; }
  }
}
