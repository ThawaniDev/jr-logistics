import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

/// Update L / M — store hygiene: what the App Store and Google Play read out of the project files. These are text checks of the files themselves (a native
/// build is the lead's job); each one pins a decision so a later edit cannot undo it silently.
String _read(String p) => File(p).readAsStringSync();
String _plistValue(String plist, String key) => RegExp('<key>$key</key>\\s*(<[^>]+>[^<]*</[^>]+>|<true/>|<false/>)').firstMatch(plist)?.group(1) ?? '';

void main() {
  group('iOS', () {
    final plist = _read('ios/Runner/Info.plist');

    test('export compliance: the app only uses the platform\'s standard encryption (HTTPS), so the build is not held for a questionnaire', () {
      expect(_plistValue(plist, 'ITSAppUsesNonExemptEncryption'), '<false/>');
    });

    test('the app is localized in English, Arabic and Urdu, and each language has its permission texts', () {
      for (final l in ['en', 'ar', 'ur']) { expect(RegExp('<string>$l</string>').hasMatch(plist.substring(plist.indexOf('CFBundleLocalizations'))), isTrue, reason: l); }
      for (final l in ['en', 'ar', 'ur']) {
        final f = File('ios/Runner/$l.lproj/InfoPlist.strings');
        expect(f.existsSync(), isTrue, reason: l);
        final s = f.readAsStringSync();
        for (final k in ['NSLocationWhenInUseUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSLocalNetworkUsageDescription']) {
          expect(RegExp('^"$k" = ".{12,}";\$', multiLine: true).hasMatch(s), isTrue, reason: '$l $k');
        }
      }
      expect(RegExp(r'[؀-ۿ]').hasMatch(_read('ios/Runner/ar.lproj/InfoPlist.strings')), isTrue);
      expect(RegExp(r'[؀-ۿ]').hasMatch(_read('ios/Runner/ur.lproj/InfoPlist.strings')), isTrue);
      expect(_read('ios/Runner/ar.lproj/InfoPlist.strings'), isNot(_read('ios/Runner/ur.lproj/InfoPlist.strings')), reason: 'Urdu is its own text, not a copy of the Arabic');
      // the Info.plist keeps the English texts as the fallback for every other language
      for (final k in ['NSLocationWhenInUseUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) { expect(plist, contains(k)); }
    });

    test('the project bundles the privacy manifest and the three InfoPlist.strings, and knows the Arabic and Urdu regions', () {
      final p = _read('ios/Runner.xcodeproj/project.pbxproj');
      expect(p, contains('PrivacyInfo.xcprivacy in Resources'));
      expect(p, contains('InfoPlist.strings in Resources'));
      expect(RegExp(r'path = (en|ar|ur)\.lproj/InfoPlist\.strings').allMatches(p).length, 3);
      final regions = RegExp(r'knownRegions = \(([^)]*)\)').firstMatch(p)!.group(1)!;
      for (final r in ['en', 'ar', 'ur']) { expect(regions, contains(r)); }
    });

    test('the privacy manifest: no tracking, the UserDefaults reason, and the data the app collects (all for the app\'s own function)', () {
      final m = _read('ios/Runner/PrivacyInfo.xcprivacy');
      expect(_plistValue(m, 'NSPrivacyTracking'), '<false/>');
      expect(m, contains('NSPrivacyTrackingDomains'));
      expect(m, contains('NSPrivacyAccessedAPICategoryUserDefaults'));
      expect(m, contains('<string>CA92.1</string>'));
      for (final t in ['PreciseLocation', 'Name', 'PhoneNumber', 'PhotosorVideos', 'CrashData']) { expect(m, contains('NSPrivacyCollectedDataType$t')); }
      expect(m, isNot(contains('PurposeThirdPartyAdvertising')));
      expect(m, isNot(contains('PurposeDeveloperAdvertising')));
      expect(m, isNot(contains('PurposeAnalytics')));
      expect(RegExp('NSPrivacyCollectedDataTypeTracking</key>\\s*<true/>').hasMatch(m), isFalse);
    });

    test('minimum OS is iOS 15 everywhere (project, framework plist, Podfile)', () {
      final p = _read('ios/Runner.xcodeproj/project.pbxproj');
      final targets = RegExp(r'IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);').allMatches(p).map((m) => m.group(1)).toSet();
      expect(targets, {'15.0'});
      expect(_read('ios/Flutter/AppFrameworkInfo.plist'), contains('<string>15.0</string>'));
      expect(_read('ios/Podfile'), contains("platform :ios, '15.0'"));
      expect(_read('ios/Podfile'), isNot(contains("# platform :ios")));
    });

    test('background location stays OFF (owner decision D1): no UIBackgroundModes, only the when-in-use text', () {
      expect(plist, isNot(contains('UIBackgroundModes')));
      expect(plist, isNot(contains('NSLocationAlwaysAndWhenInUseUsageDescription')));
      expect(plist, isNot(contains('NSLocationAlwaysUsageDescription')));
    });
  });

  group('Android', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    final gradle = _read('android/app/build.gradle.kts');

    test('minimum OS is Android 8 (API 26)', () {
      expect(RegExp(r'minSdk\s*=\s*26\b').hasMatch(gradle), isTrue);
    });

    test('the camera is optional (parcels can be typed), so no phone is filtered out of the listing for lacking one', () {
      expect(manifest, contains('android:name="android.hardware.camera" android:required="false"'));
    });

    test('nothing is backed up or copied to a new phone: allowBackup is off and both rule files exclude everything', () {
      expect(manifest, contains('android:allowBackup="false"'));
      expect(manifest, contains('android:dataExtractionRules="@xml/data_extraction_rules"'));
      expect(manifest, contains('android:fullBackupContent="@xml/backup_rules"'));
      final ext = _read('android/app/src/main/res/xml/data_extraction_rules.xml');
      expect(ext, contains('<cloud-backup>'));
      expect(ext, contains('<device-transfer>'));
      final back = _read('android/app/src/main/res/xml/backup_rules.xml');
      for (final d in ['root', 'file', 'database', 'sharedpref', 'external']) {
        expect(back, contains('<exclude domain="$d"'));
        expect(RegExp('<exclude domain="$d"').allMatches(ext).length, 2, reason: '$d in cloud-backup and device-transfer');
      }
      expect(ext, isNot(contains('<include')));
      expect(back, isNot(contains('<include')));
    });

    test('background location stays OFF (owner decision D1)', () {
      expect(manifest, isNot(contains('ACCESS_BACKGROUND_LOCATION')));
      expect(manifest, isNot(contains('FOREGROUND_SERVICE')));
    });

    test('release signing and the application id are owner items, documented in the README', () {
      final readme = _read('README.md');
      expect(readme, contains('applicationId'));
      expect(readme, contains('signing'));
      expect(readme, contains('ITSAppUsesNonExemptEncryption'));
    });
  });
}
