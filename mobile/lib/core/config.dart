import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kReleaseMode;

/// Build-time configuration. Override with --dart-define=API_BASE_URL=https://api.example.com
class AppConfig {
  static const _override = String.fromEnvironment('API_BASE_URL');
  /// Must equal the `version:` of pubspec.yaml (without the build number) — `test/unit/audit_a6_test.dart` checks it.
  static const version = '1.0.0';

  /// A release build that was not given `--dart-define=API_BASE_URL=https://…` would talk to localhost and fail as "no connection" with no hint:
  /// `main()` shows a plain configuration error instead (this never reaches a driver when the release is built the documented way).
  static bool get misconfigured => kReleaseMode && _override.isEmpty;

  /// Android emulators reach the host machine at 10.0.2.2; iOS simulators use localhost.
  static String get baseUrl {
    if (_override.isNotEmpty) return _override;
    try {
      if (Platform.isAndroid) return 'http://10.0.2.2:3000';
    } catch (_) {}
    return 'http://localhost:3000';
  }
}
