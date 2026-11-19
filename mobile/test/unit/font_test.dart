import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/theme.dart';

void main() {
  test('the whole app is set in Cairo, with a fallback for glyphs it lacks', () {
    final t = buildTheme();
    expect(t.textTheme.bodyMedium?.fontFamily, 'Cairo');
    expect(t.textTheme.titleLarge?.fontFamily, 'Cairo');
    expect(t.textTheme.labelLarge?.fontFamily, 'Cairo');
    expect(t.textTheme.bodyMedium?.fontFamilyFallback, isNotEmpty);
  });

  test('every weight the app uses ships as a bundled font file, declared with its weight, together with the licence', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(pubspec, contains('family: Cairo'));
    for (final (name, weight) in const [('Regular', null), ('Medium', 500), ('SemiBold', 600), ('Bold', 700), ('ExtraBold', 800)]) {
      final file = File('assets/fonts/Cairo-$name.ttf');
      expect(file.existsSync(), isTrue, reason: 'missing Cairo-$name.ttf');
      expect(file.lengthSync(), greaterThan(50 * 1024), reason: 'Cairo-$name.ttf looks truncated');
      expect(file.readAsBytesSync().sublist(0, 4), [0, 1, 0, 0], reason: 'Cairo-$name.ttf is not a TrueType font');
      expect(pubspec, contains('asset: assets/fonts/Cairo-$name.ttf'));
      if (weight != null) expect(RegExp('Cairo-$name\\.ttf\\s+weight: $weight').hasMatch(pubspec), isTrue, reason: 'Cairo-$name must be declared with weight $weight');
    }
    expect(File('assets/fonts/OFL.txt').readAsStringSync(), contains('SIL Open Font License'));
    expect(pubspec, contains('assets/fonts/OFL.txt'));
  });

  test('weights used in the UI (600/700/800) all exist in the family', () {
    final used = <int>{};
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
      for (final m in RegExp(r'FontWeight\.w(\d00)').allMatches(f.readAsStringSync())) { used.add(int.parse(m.group(1)!)); }
    }
    expect(used.difference({400, 500, 600, 700, 800}), isEmpty, reason: 'a weight Cairo is not bundled in: $used');
  });

  testWidgets('text in the running app theme resolves to Cairo', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: const Scaffold(body: Text('مرحبا Hello'))));
    final style = DefaultTextStyle.of(tester.element(find.text('مرحبا Hello'))).style;
    expect(style.fontFamily, 'Cairo');
  });
}
