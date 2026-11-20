import 'package:flutter/material.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../widgets/common.dart';

/// A driver of a courier office does not own a wallet: his office is paid. Either source says so — `GET /wallet` (`managedByOffice`) or the overview
/// (`walletManagedByOffice`).
bool walletManagedByOffice(Json? wallet, Overview? overview) => wallet?['managedByOffice'] == true || overview?.walletManagedByOffice == true;

/// The office's name when the server gives it (wallet or overview), else null.
String? walletOfficeName(Json? wallet, Overview? overview) {
  final w = wallet?['officeName'];
  if (w is String && w.trim().isNotEmpty) return w.trim();
  final o = wallet?['office'];
  if (o is Map && o['name'] is String && (o['name'] as String).trim().isNotEmpty) return (o['name'] as String).trim();
  final n = overview?.officeName;
  return n == null || n.trim().isEmpty ? null : n.trim();
}

/// The calm card that replaces the wallet figures of an office driver: "Your wallet is managed by your office", the office's name, and where to ask about pay.
class ManagedWalletCard extends StatelessWidget {
  const ManagedWalletCard({super.key, this.officeName});
  final String? officeName;
  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final office = officeName;
    return SectionCard(key: const Key('wallet-managed'), border: JR.cyan, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 44, height: 44, decoration: BoxDecoration(color: JR.cyan.withValues(alpha: 0.14), shape: BoxShape.circle), child: const Icon(Icons.apartment_outlined, color: JR.cyan, size: 24)),
        const SizedBox(width: 12),
        Expanded(child: Padding(padding: const EdgeInsets.only(top: 2), child: Text(t('drs.managed_title'), key: const Key('wallet-managed-title'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, height: 1.3)))),
      ]),
      const SizedBox(height: 10),
      Text(t('drs.managed_body'), key: const Key('wallet-managed-body'), style: const TextStyle(color: JR.muted, height: 1.45)),
      if (office != null) ...[const SizedBox(height: 12), Pill(t('drs.managed_office', {'office': office}), key: const Key('wallet-managed-office'), tone: Tone.info)],
      const SizedBox(height: 10),
      Text(office != null ? t('drs.managed_hint_office', {'office': office}) : t('drs.managed_hint'), key: const Key('wallet-managed-hint'), style: const TextStyle(color: JR.muted, fontSize: 13, height: 1.4)),
    ]));
  }
}
