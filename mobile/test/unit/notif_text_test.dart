import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/i18n.dart';
import 'package:jr_driver/core/notif_text.dart';
import 'package:jr_driver/data/models_extra.dart';
import '../helpers_extra.dart';

/// The notification text never shows a raw `{placeholder}` (same rule as web/src/lib/notif-text.ts).
Strings _en() => Strings('en', {
      'notif.offer_new': 'New job offer {ref}: {parcels} parcels, {pickupCity} → {deliveryCity}',
      'notif.offer_new__short': 'New job offer {ref}: {pickupCity} → {deliveryCity}',
      'notif.cod_received': 'Cash received {ref}: SAR {amount}',
      'city.riyadh': 'Riyadh', 'city.jeddah': 'Jeddah', 'um.notif_generic': 'You have a new update',
    }, const {});
AppNotification _n(String type, Map<String, dynamic>? data) => AppNotification(mkNotification('x', type, data: data));

void main() {
  test('full data: the template, cities localized, amount from amountCents', () {
    expect(notificationText(_en(), _n('offer_new', {'ref': 'JR-1', 'parcels': 14, 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'})), 'New job offer JR-1: 14 parcels, Riyadh → Jeddah');
    expect(notificationText(_en(), _n('cod_received', {'ref': 'JR-1', 'amountCents': 12550})), 'Cash received JR-1: SAR 125.50');
  });
  test('no parcel count (vehicle-day offer): the short variant', () {
    expect(notificationText(_en(), _n('offer_new', {'ref': 'JR-2', 'pickupCity': 'riyadh', 'deliveryCity': 'jeddah'})), 'New job offer JR-2: Riyadh → Jeddah');
  });
  test('an old row with only a reference or nothing: the text up to the missing part; unknown type: the generic text', () {
    expect(notificationText(_en(), _n('offer_new', {'ref': 'JR-3', 'requestId': 'r'})), 'New job offer JR-3');
    expect(notificationText(_en(), _n('cod_received', {})), 'Cash received');
    expect(notificationText(_en(), _n('from_a_newer_server', {'ref': 'x'})), 'You have a new update');
  });
  test('never a brace, whatever is missing', () {
    for (final d in <Map<String, dynamic>>[{}, {'ref': 'A'}, {'parcels': 3}, {'ref': 'A', 'parcels': ''}, {'ref': null, 'pickupCity': 'riyadh'}]) {
      expect(notificationText(_en(), _n('offer_new', d)), isNot(contains('{')));
    }
  });
}
