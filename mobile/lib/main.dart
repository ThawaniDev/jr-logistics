import 'package:flutter/foundation.dart' show LicenseEntryWithLineBreaks, LicenseRegistry;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'app.dart';
import 'core/app_info.dart';
import 'core/config.dart';
import 'core/crash_reporter.dart';
import 'providers.dart';
import 'services_notify.dart';

void main() {
  // Crash reporting (self-hosted): nothing that is thrown and not caught — in a widget, in an async gap, anywhere in this zone — ends the app; a scrubbed
  // report goes to `POST /api/v1/app/errors`. The reporter learns the real app version as soon as the bundle has been read.
  late final CrashReporter reporter;
  reporter = CrashReporter(app: AppInfo.fallback(), send: httpReportSender(baseUrl: AppConfig.baseUrl, app: () => reporter.app));
  runGuarded(reporter, () => _start(reporter));
}

Future<void> _start(CrashReporter reporter) async {
  WidgetsFlutterBinding.ensureInitialized();
  if (AppConfig.misconfigured) {
    runApp(const MaterialApp(home: Scaffold(body: Center(child: Padding(padding: EdgeInsets.all(24), child: Text('This build has no server address (API_BASE_URL). Rebuild with --dart-define=API_BASE_URL=https://your-server.', textAlign: TextAlign.center))))));
    return;
  }
  installCrashHandlers(reporter);
  // Cairo is bundled under the SIL Open Font License, which asks that its text travels with the font.
  LicenseRegistry.addLicense(() async* { yield LicenseEntryWithLineBreaks(const ['Cairo font'], await rootBundle.loadString('assets/fonts/OFL.txt')); });
  final prefs = await SharedPreferences.getInstance();
  final app = await AppInfo.read(); // the version of the installed build (sent with every request so the server can ask an old app to update)
  reporter.app = app;
  // Local notifications for new offers (E12). init() never asks for permission (the home screen does, politely) and never throws.
  final notifier = DeviceLocalNotifier();
  await notifier.init();
  runApp(ProviderScope(retry: appRetry, overrides: [prefsProvider.overrideWithValue(prefs), localNotifierProvider.overrideWithValue(notifier), appInfoProvider.overrideWithValue(app)], child: const JrApp()));
}
