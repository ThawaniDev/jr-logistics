import 'package:flutter/foundation.dart' show LicenseEntryWithLineBreaks, LicenseRegistry;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'app.dart';
import 'providers.dart';
import 'services_notify.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Cairo is bundled under the SIL Open Font License, which asks that its text travels with the font.
  LicenseRegistry.addLicense(() async* { yield LicenseEntryWithLineBreaks(const ['Cairo font'], await rootBundle.loadString('assets/fonts/OFL.txt')); });
  final prefs = await SharedPreferences.getInstance();
  // Local notifications for new offers (E12). init() never asks for permission (the home screen does, politely) and never throws.
  final notifier = DeviceLocalNotifier();
  await notifier.init();
  runApp(ProviderScope(retry: appRetry, overrides: [prefsProvider.overrideWithValue(prefs), localNotifierProvider.overrideWithValue(notifier)], child: const JrApp()));
}
