import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models_extra.dart';
import 'cash_risk_banner.dart';

/// `403 CASH_LIMIT` on accept / apply: the driver holds too much cash (or cash past its handover time), so new jobs are paused. A dialog says why — with the
/// figures the server sent (`details.cash`) — and takes him to "Cash with me". Returns after the dialog is closed.
Future<void> showCashLimitDialog(BuildContext context, ApiException e, String lang) async {
  final cash = CashRisk.of(e.details['cash']);
  final go = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
    key: const Key('cash-limit-dialog'),
    title: Text(d.tr('cr.paused_title')),
    content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(d.tr('err.CASH_LIMIT'), style: const TextStyle(height: 1.4)),
      if (cash != null && cash.atRisk) ...[const SizedBox(height: 10), Text(cashRiskTexts(d.tr, cash, lang).text, key: const Key('cash-limit-detail'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.4))],
    ])),
    actions: [
      TextButton(style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.close'))),
      FilledButton(key: const Key('cash-limit-open'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('cr.banner_open'), textAlign: TextAlign.center)),
    ],
  ));
  if (go == true && context.mounted) context.push('/cash');
}

/// `409 CASH_OUTSTANDING` on a withdrawal: part of the balance is held back because of overdue cash. Says how much can be taken out now and why.
Future<void> showCashOutstandingDialog(BuildContext context, ApiException e, String lang) async {
  final max = numOf(e.details['maxCents'])?.toInt() ?? 0, overdue = numOf(e.details['overdueCents'])?.toInt() ?? 0;
  final go = await showDialog<bool>(context: context, builder: (d) => AlertDialog(
    key: const Key('cash-outstanding-dialog'),
    title: Text(d.tr('cr.banner_overdue_title')),
    content: SingleChildScrollView(child: Text(d.tr('lm.cash_withdraw_limited', {'max': fmtMoney(max, lang), 'overdue': fmtMoney(overdue, lang)}), key: const Key('cash-outstanding-text'), style: const TextStyle(height: 1.4))),
    actions: [
      TextButton(style: TextButton.styleFrom(minimumSize: const Size(88, 48)), onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.close'))),
      FilledButton(key: const Key('cash-outstanding-open'), style: FilledButton.styleFrom(minimumSize: const Size(110, 48)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('cr.banner_open'), textAlign: TextAlign.center)),
    ],
  ));
  if (go == true && context.mounted) context.push('/cash');
}
