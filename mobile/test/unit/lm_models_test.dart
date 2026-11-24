import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/core/notif_text.dart';
import 'package:jr_driver/data/company.dart';
import 'package:jr_driver/data/models.dart';
import 'package:jr_driver/data/models_extra.dart';
import 'package:jr_driver/data/privacy_repo.dart';
import 'package:jr_driver/features/profile/notifications_screen.dart' show notificationIcon;
import '../helpers.dart';

/// Update L / M — the new server fields (cash risk, SMS off, invitations, privacy, support contact), the new notification types, and the texts.
Map<String, Object?> _cash({String state = 'warn', bool blocks = false, String? reason, int outstanding = 240000, int lien = 0, int overdue = 0, int days = 1}) => {
      'outstandingCents': outstanding, 'orders': 2, 'enabled': true, 'limitCents': 300000, 'warnPct': 80, 'maxDays': 3, 'pct': 80, 'oldestDays': days, 'oldestAt': '2026-11-20T08:00:00.000Z',
      'overdueCents': overdue, 'state': state, 'blocksOffers': blocks, 'reason': reason, 'lienCents': lien,
    };

AppNotification _n(String type, [Map<String, Object?> data = const {}]) => AppNotification({'id': 'n-$type', 'type': type, 'data': data, 'readAt': null, 'createdAt': '2026-11-22T06:00:00.000Z'});

final _newTypes = <String, Map<String, Object?>>{
  'cash_limit_warning': {'amount': '2400.00', 'limit': '3000.00', 'pct': 80, 'days': 1, 'maxDays': 3},
  'cash_overdue': {'amount': '2400.00', 'limit': '3000.00', 'pct': 80, 'days': 4, 'maxDays': 3},
  'cash_blocked': {'amount': '3100.00', 'limit': '3000.00', 'pct': 103, 'days': 1, 'maxDays': 3},
  'document_expiring': {'documentId': 'd1', 'docType': 'national_id', 'days': 7, 'expiresOn': '2026-11-29', 'threshold': 7},
  'balance_moved_to_office': {'amountCents': 12550, 'office': 'Najd Express'},
  'stop_marked_delivered': {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'},
  'stop_marked_failed': {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'},
  'parcels_added': {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'count': 3},
  'recipient_corrected': {'offerId': 'o1', 'requestId': 'r1', 'ref': 'JR-000042', 'code': 'JR-000042-003'},
  'offer_rescheduled': {'requestId': 'r1', 'ref': 'JR-000042'},
  'broadcast': {'message': 'The warehouse is closed on Friday', 'broadcastId': 'b1'},
  'privacy_request_received': {'requestId': 'p1'},
  'privacy_request_rejected': {'reason': 'You still hold cash'},
};

void main() {
  group('cash risk (GET /driver/overview → cash)', () {
    test('every field of the block is read; money in halalas', () {
      final c = CashRisk(_cash(state: 'overdue', blocks: true, reason: 'overdue', lien: 50000, overdue: 90000, days: 4));
      expect([c.outstandingCents, c.orders, c.enabled, c.limitCents, c.warnPct, c.maxDays, c.pct, c.oldestDays, c.overdueCents, c.lienCents], [240000, 2, true, 300000, 80, 3, 80, 4, 90000, 50000]);
      expect([c.state, c.blocksOffers, c.reason, c.atRisk], [CashState.overdue, true, 'overdue', true]);
      expect(c.oldestAt, '2026-11-20T08:00:00.000Z');
    });

    test('the four states', () {
      expect(CashRisk(_cash(state: 'ok')).state, CashState.ok);
      expect(CashRisk(_cash(state: 'ok')).atRisk, isFalse);
      expect(CashRisk(_cash(state: 'warn')).state, CashState.warn);
      expect(CashRisk(_cash(state: 'over_limit')).state, CashState.overLimit);
      expect(CashRisk(_cash(state: 'overdue')).state, CashState.overdue);
      expect(CashRisk(const {'state': 'something_new'}).state, CashState.ok, reason: 'an unknown state never raises a banner');
    });

    test('an older server sends only {outstandingCents, orders}: it reads as ok and never throws', () {
      final c = CashRisk.of({'outstandingCents': 5000, 'orders': 1})!;
      expect([c.state, c.blocksOffers, c.lienCents, c.limitCents, c.pct, c.atRisk], [CashState.ok, false, 0, 0, null, false]);
      expect(CashRisk.of(null), isNull);
      expect(CashRisk.of('x'), isNull);
      expect(CashRisk.of({'outstandingCents': 'many', 'state': 7})!.atRisk, isFalse);
    });

    test('Overview.cashRisk reads overview.cash; CashBrief still reads the same block', () {
      final o = Overview({'cash': _cash(), 'wallet': {}});
      expect(o.cashRisk!.state, CashState.warn);
      expect(CashBrief.fromOverview(o.j)!.outstandingCents, 240000);
      expect(Overview(const {}).cashRisk, isNull);
    });

    test('offers answer {items: [], cashBlocked: true, cash}: paused, with the block', () {
      final i = OffersInfo.fromJson({'items': [], 'hidden': false, 'activeJob': null, 'cashBlocked': true, 'cash': _cash(state: 'over_limit', blocks: true, reason: 'limit')});
      expect([i.cashBlocked, i.cash!.state, i.cash!.reason, i.items], [true, CashState.overLimit, 'limit', isEmpty]);
      expect(OffersInfo.fromJson({'items': []}).cashBlocked, isFalse);
      expect(OffersInfo.none.cashBlocked, isFalse);
    });

    test('GET /driver/cash orders carry ageDays', () {
      expect(CashOrder({'offerId': 'o1', 'outstandingCents': 100, 'ageDays': 5}).ageDays, 5);
      expect(CashOrder({'offerId': 'o1'}).ageDays, isNull);
    });
  });

  group('SMS off (stops and the job)', () {
    test('a stop without a delivery code says why: sms_off or warehouse', () {
      final off = Stop(mkStop(1, current: true, extra: {'needsOtp': false, 'proofMode': 'scan', 'canResend': false, 'otpOffReason': 'sms_off'}));
      expect([off.needsOtp, off.otpOffReason, off.smsOff, off.canResend, off.proofMode], [false, 'sms_off', true, false, 'scan']);
      final wh = Stop(mkStop(1, current: true, extra: {'needsOtp': false, 'proofMode': 'scan', 'otpOffReason': 'warehouse'}));
      expect([wh.smsOff, wh.otpOffReason], [false, 'warehouse']);
      final normal = Stop(mkStop(1, current: true));
      expect([normal.needsOtp, normal.smsOff, normal.otpOffReason], [true, false, null]);
    });

    test('the job carries deliveryCode {required, offReason, smsActive}; an older server reads as "a code is required"', () {
      final j = mkManifestJob(extra: {'deliveryCode': {'required': false, 'offReason': 'sms_off', 'smsActive': false}});
      expect([j.deliveryCode.required, j.deliveryCode.offReason, j.deliveryCode.smsActive, j.deliveryCode.smsOff], [false, 'sms_off', false, true]);
      final old = mkManifestJob();
      expect([old.deliveryCode.required, old.deliveryCode.smsOff, old.deliveryCode.smsActive], [true, false, true]);
    });
  });

  group('invitations from an office (GET /driver/invites)', () {
    test('items and the wallet block', () {
      final i = InvitesInfo.fromJson({'items': [{'id': 'i1', 'officeName': 'Najd Express'}], 'walletBlock': {'availableCents': 12500, 'heldCents': 500, 'pendingWithdrawals': 1, 'blocks': true}});
      expect([i.items.length, i.walletBlock.blocks, i.walletBlock.totalCents, i.walletBlock.pendingWithdrawals], [1, true, 13000, 1]);
    });
    test('no block, no key, odd shapes: not blocked', () {
      expect(InvitesInfo.fromJson({'items': []}).walletBlock.blocks, isFalse);
      expect(InvitesInfo.fromJson({'items': 'x', 'walletBlock': 'y'}).items, isEmpty);
      expect(WalletBlock.fromJson({'blocks': false, 'availableCents': 0}).blocks, isFalse);
    });
  });

  group('privacy (GET /privacy/status)', () {
    final status = PrivacyStatus({
      'role': 'driver', 'export': {'available': true, 'lastAt': '2026-11-20T08:00:00.000Z'},
      'deletion': {'supported': true, 'eligible': false, 'canRequest': false, 'blockers': [{'code': 'wallet_funds', 'amountCents': 12500}, {'code': 'open_jobs', 'count': 2}, 'junk'], 'request': {'id': 'p1', 'status': 'requested', 'reason': 'leaving', 'requestedAt': '2026-11-21T08:00:00.000Z'}},
      'retention': {'notificationDays': 90, 'recipientPiiMonths': 24, 'closedAccountYears': 5}, 'contact': {'privacyEmail': ' privacy@jr.test ', 'phone': null},
    });
    test('reads the blockers, the open request, the retention periods and the contact', () {
      expect(status.blockers.map((b) => [b.code, b.count, b.amountCents]), [['wallet_funds', 0, 12500], ['open_jobs', 2, 0]]);
      expect([status.deletionSupported, status.canRequest, status.eligible, status.request!.open, status.lastExportAt], [true, false, false, true, '2026-11-20T08:00:00.000Z']);
      expect([status.notificationDays, status.recipientPiiMonths, status.closedAccountYears, status.hasRetention, status.privacyEmail], [90, 24, 5, true, 'privacy@jr.test']);
    });
    test('an empty or odd answer degrades, it never throws', () {
      final e = PrivacyStatus(const {});
      expect([e.blockers, e.request, e.hasRetention, e.privacyEmail, e.canRequest], [isEmpty, isNull, false, isNull, false]);
      expect(PrivacyStatus({'deletion': {'supported': false}}).deletionSupported, isFalse);
      expect(DeletionRequest(const {'status': 'rejected', 'decisionNote': 'Cash'}).rejected, isTrue);
    });
  });

  group('support contact (catalog.company)', () {
    final company = {'company': {'supportPhone': ' 0112345678 ', 'supportWhatsapp': '+966 55 000 1111', 'supportEmail': 'help@jr.test', 'supportHoursAr': 'من ٩ إلى ٥', 'supportHoursEn': '9 to 5'}};
    test('channels are trimmed; hours follow the language (Arabic for ar, English for the others, the other as a fallback)', () {
      final ar = SupportContact.fromCatalog(company, 'ar'), en = SupportContact.fromCatalog(company, 'en'), ur = SupportContact.fromCatalog(company, 'ur');
      expect([ar.phone, ar.email, ar.any], ['0112345678', 'help@jr.test', true]);
      expect([ar.hours, en.hours, ur.hours], ['من ٩ إلى ٥', '9 to 5', '9 to 5']);
      expect(SupportContact.fromCatalog({'company': {'supportPhone': '1', 'supportHoursAr': 'ar only'}}, 'en').hours, 'ar only');
    });
    test('WhatsApp and e-mail links', () {
      final c = SupportContact.fromCatalog(company, 'en');
      expect(c.whatsappUri.toString(), 'https://wa.me/966550001111');
      expect(c.emailUri.toString(), 'mailto:help@jr.test');
      expect(SupportContact.fromCatalog({'company': {'supportWhatsapp': '00966550001111'}}, 'en').whatsappUri.toString(), 'https://wa.me/966550001111');
      expect(const SupportContact(whatsapp: '12').whatsappUri, isNull);
      expect(const SupportContact(email: 'nope').emailUri, isNull);
    });
    test('hidden while no channel is filled in (hours alone are not a way to reach anyone); absent on older servers', () {
      expect(SupportContact.fromCatalog({'company': {'supportPhone': '', 'supportWhatsapp': ' ', 'supportEmail': '', 'supportHoursEn': '9 to 5', 'legalNameEn': 'JR'}}, 'en').any, isFalse);
      expect(SupportContact.fromCatalog({}, 'en').any, isFalse);
      expect(SupportContact.fromCatalog(null, 'en').any, isFalse);
      expect(SupportContact.fromCatalog({'company': 'x'}, 'en').any, isFalse);
    });
  });

  group('new notification types', () {
    for (final lang in ['en', 'ar', 'ur']) {
      test('$lang: every new type has its own text, with no raw {placeholder} and the values filled in', () {
        final t = strings(lang);
        _newTypes.forEach((type, data) {
          final text = notificationText(t, _n(type, data));
          expect(text, isNot(contains('{')), reason: '$type: $text');
          expect(text, isNot(t('um.notif_generic')), reason: '$type fell back to the generic text');
          expect(text.length, greaterThan(8), reason: type);
        });
        expect(notificationText(t, _n('cash_limit_warning', _newTypes['cash_limit_warning']!)), allOf(contains('2400.00'), contains('3000.00')));
        expect(notificationText(t, _n('cash_overdue', _newTypes['cash_overdue']!)), allOf(contains('2400.00'), contains('4')));
        expect(notificationText(t, _n('balance_moved_to_office', _newTypes['balance_moved_to_office']!)), allOf(contains('125.50'), contains('Najd Express')));
        expect(notificationText(t, _n('parcels_added', _newTypes['parcels_added']!)), allOf(contains('JR-000042'), contains('3')));
        expect(notificationText(t, _n('stop_marked_failed', _newTypes['stop_marked_failed']!)), allOf(contains('JR-000042'), contains('JR-000042-003')));
        expect(notificationText(t, _n('broadcast', _newTypes['broadcast']!)), 'The warehouse is closed on Friday', reason: 'the message arrives already in the driver\'s language');
        expect(notificationText(t, _n('privacy_request_rejected', _newTypes['privacy_request_rejected']!)), contains('You still hold cash'));
      });
    }

    test('document_expiring shows the document type by its localized name (not the key), the date and the days left', () {
      final en = notificationText(strings('en'), _n('document_expiring', _newTypes['document_expiring']!));
      expect(en, allOf(contains('National ID / Iqama'), contains('2026-11-29'), contains('7'), isNot(contains('national_id'))));
      final ar = notificationText(strings('ar'), _n('document_expiring', _newTypes['document_expiring']!));
      expect(ar, allOf(contains('الهوية / الإقامة'), isNot(contains('national_id'))));
      // an unknown document type reads as itself, never as "doc.xyz"
      expect(notificationText(strings('en'), _n('document_expiring', {..._newTypes['document_expiring']!, 'docType': 'new_kind'})), allOf(contains('new_kind'), isNot(contains('doc.'))));
    });

    test('a missing value never shows a raw placeholder: the text is cut or falls back to the short variant', () {
      final t = strings('en');
      expect(notificationText(t, _n('document_expiring', {'documentId': 'd1'})), allOf(isNot(contains('{')), contains('expires')));
      expect(notificationText(t, _n('cash_overdue', {})), isNot(contains('{')));
    });

    test('where a tap goes', () {
      String? r(String type, [Map<String, Object?>? d]) => notificationRoute(_n(type, d ?? _newTypes[type] ?? {}));
      expect([r('cash_limit_warning'), r('cash_overdue'), r('cash_blocked')], ['/cash', '/cash', '/cash']);
      expect(r('document_expiring'), '/documents');
      expect(r('balance_moved_to_office'), '/wallet');
      expect([r('stop_marked_delivered'), r('stop_marked_failed'), r('parcels_added'), r('recipient_corrected')], ['/job/o1', '/job/o1', '/job/o1', '/job/o1']);
      expect(r('offer_rescheduled'), '/offers', reason: 'an open offer: the driver looks at his offers');
      expect(r('privacy_request_received'), '/privacy');
      expect(r('privacy_request_rejected'), '/privacy');
      expect(r('broadcast'), isNull, reason: 'no link: nothing to open');
      expect(r('broadcast', {'message': 'x', 'link': '/driver/opportunities'}), '/offers');
      expect(r('broadcast', {'message': 'x', 'link': '/driver/cash?x=1'}), '/cash');
      expect(r('broadcast', {'message': 'x', 'link': '/admin/secret'}), isNull, reason: 'a page the app does not have');
      expect(r('offer_new'), '/offers');
    });

    test('appRouteOfWebLink maps the driver pages of the web portal', () {
      expect({for (final l in ['/driver', '/driver/jobs', '/driver/wallet', '/driver/documents', '/driver/notifications', '/driver/support', '/driver/profile/']) l: appRouteOfWebLink(l)},
          {'/driver': '/', '/driver/jobs': '/jobs', '/driver/wallet': '/wallet', '/driver/documents': '/documents', '/driver/notifications': '/notifications', '/driver/support': '/support', '/driver/profile/': '/profile'});
      expect([appRouteOfWebLink(null), appRouteOfWebLink(''), appRouteOfWebLink('https://evil.example')], [null, null, null]);
    });

    test('each new type has its own icon (not the bell)', () {
      for (final type in _newTypes.keys) { expect(notificationIcon(type), isNot(Icons.notifications_none), reason: type); }
    });
  });

  group('texts', () {
    final en = loadDict('en'), ar = loadDict('ar'), ur = loadDict('ur');
    final lm = en.keys.where((k) => k.startsWith('lm.')).toList();

    test('the app\'s own keys (lm.*) exist in all three languages with the same placeholders, and Arabic / Urdu are real translations', () {
      expect(lm.length, greaterThan(30));
      String ph(String s) => (RegExp(r'\{(\w+)\}').allMatches(s).map((m) => m.group(1)!).toList()..sort()).join(',');
      for (final k in lm) {
        expect(ar.containsKey(k), isTrue, reason: 'ar $k');
        expect(ur.containsKey(k), isTrue, reason: 'ur $k');
        expect(ph(ar[k]!), ph(en[k]!), reason: 'ar placeholders $k');
        expect(ph(ur[k]!), ph(en[k]!), reason: 'ur placeholders $k');
        if (!const {'lm.update_btn_ios', 'lm.update_btn_android'}.contains(k)) {
          expect(ar[k], isNot(en[k]), reason: 'ar $k is a copy of English');
          expect(ur[k], isNot(en[k]), reason: 'ur $k is a copy of English');
        }
        expect(RegExp(r'[؀-ۿ]').hasMatch(ar[k]!), isTrue, reason: 'ar $k has Arabic letters');
        expect(RegExp(r'[؀-ۿ]').hasMatch(ur[k]!), isTrue, reason: 'ur $k has Arabic-script letters');
      }
    });

    test('every reused text the app reads exists in all three languages (cash, privacy, legal, support, errors)', () {
      const keys = [
        'cr.banner_warn_title', 'cr.banner_warn', 'cr.banner_over_limit_title', 'cr.banner_over_limit', 'cr.banner_over_limit_block_title', 'cr.banner_over_limit_block', 'cr.banner_overdue_title', 'cr.banner_overdue',
        'cr.banner_overdue_block_title', 'cr.banner_overdue_block', 'cr.banner_bar', 'cr.banner_lien', 'cr.banner_open', 'cr.todo_title', 'cr.todo_1', 'cr.todo_2', 'cr.paused_title', 'cr.paused_limit', 'cr.paused_overdue',
        'pv.card_title', 'pv.card_sub', 'pv.export_title', 'pv.export_body', 'pv.export_btn', 'pv.export_last', 'pv.export_done', 'pv.delete_title', 'pv.delete_body', 'pv.delete_blocked_title', 'pv.delete_blocked_body',
        'pv.reason_label', 'pv.delete_btn', 'pv.confirm_title', 'pv.confirm_body', 'pv.confirm_btn', 'pv.req_open_title', 'pv.req_open_body', 'pv.req_withdraw', 'pv.req_rejected_title', 'pv.req_sent', 'pv.req_withdrawn',
        'pv.retention_body', 'pv.contact', 'pv.policy_link', 'lg.gate_title', 'lg.gate_sub', 'lg.gate_accept', 'lg.gate_continue', 'lg.gate_signout', 'lg.gate_stale', 'lg.gate_failed', 'lg.what_changed', 'lg.version', 'lg.effective',
        'lg.read', 'lg.reg_accept', 'lg.builtin_notice', 'gp.invite_blocked_title', 'gp.invite_blocked_body', 'co.help_whatsapp', 'co.help_hours', 'fma.scan_proof_note', 'common.close',
      ];
      for (final d in [en, ar, ur]) { for (final k in keys) { expect(d.containsKey(k), isTrue, reason: k); } }
      for (final code in const ['role_not_supported', 'already_anonymised', 'open_requests', 'returns_pending', 'open_jobs', 'open_office_jobs', 'linked_drivers', 'wallet_funds', 'wallet_debt', 'pending_withdrawals', 'pending_topups', 'unsettled', 'outstanding_cash', 'cash_with_drivers', 'unpaid_invoices']) {
        for (final d in [en, ar, ur]) { expect(d.containsKey('pv.blocker_$code'), isTrue, reason: code); }
      }
    });

    test('every error code the server can send has a localized message (err.<CODE>) in all three languages', () {
      final f = File('../web/src/lib/errors.ts');
      if (!f.existsSync()) { markTestSkipped('web/src/lib/errors.ts is not next to the app'); return; }
      final union = RegExp(r'export type ErrorCode =(.*?);', dotAll: true).firstMatch(f.readAsStringSync())!.group(1)!;
      final codes = RegExp(r'"([A-Z][A-Z0-9_]+)"').allMatches(union).map((m) => m.group(1)!).toList();
      expect(codes.length, greaterThan(40));
      for (final c in ['CASH_LIMIT', 'CASH_OUTSTANDING', 'WALLET_NOT_EMPTY', 'UPGRADE_REQUIRED', 'ERASURE_BLOCKED']) { expect(codes, contains(c)); }
      for (final c in codes) {
        for (final d in {'en': en, 'ar': ar, 'ur': ur}.entries) { expect(d.value.containsKey('err.$c'), isTrue, reason: 'err.$c in ${d.key}'); }
      }
    });
  });

  test('the exported dictionaries are valid JSON of strings (the sync with the web is checked by the web test)', () {
    for (final l in ['en', 'ar', 'ur']) {
      final m = jsonDecode(File('assets/i18n/$l.json').readAsStringSync()) as Map<String, dynamic>;
      expect(m.values.every((v) => v is String), isTrue, reason: l);
    }
  });
}
