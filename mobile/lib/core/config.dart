import 'dart:io' show Platform;

/// Build-time configuration. Override with --dart-define=API_BASE_URL=https://api.example.com
class AppConfig {
  static const _override = String.fromEnvironment('API_BASE_URL');
  static const version = '1.0.0';

  /// Android emulators reach the host machine at 10.0.2.2; iOS simulators use localhost.
  static String get baseUrl {
    if (_override.isNotEmpty) return _override;
    try {
      if (Platform.isAndroid) return 'http://10.0.2.2:3000';
    } catch (_) {}
    return 'http://localhost:3000';
  }
}
