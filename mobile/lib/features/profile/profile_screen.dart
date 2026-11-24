import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/config.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/theme_mode.dart';
import '../../core/format.dart';
import '../../data/models_extra.dart';
import '../../providers.dart';
import '../../providers_extra.dart';
import '../../widgets/common.dart';
import '../privacy/privacy_widgets.dart';
import '../support/support_contact_card.dart';
import 'language_sheet.dart';
import 'theme_sheet.dart';

/// Invitations from courier offices and the wallet block (`GET /driver/invites` → `{items, walletBlock}`). A missing / odd `items` is "no invitations", not a crash.
final invitesProvider = FutureProvider.autoDispose<InvitesInfo>((ref) async => InvitesInfo.fromJson(await ref.watch(apiProvider).invites()));

/// First letter of the name for the avatar; an empty/blank name must not crash the screen.
String _initial(String name) { final n = name.trim(); return n.isEmpty ? '?' : n.characters.first; }

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final user = ref.watch(authProvider).value?.user;
    final ov = ref.watch(overviewProvider).value;
    final invitesInfo = ref.watch(invitesProvider).value ?? const InvitesInfo();
    final invites = invitesInfo.items;
    final block = invitesInfo.walletBlock;
    final lang = ref.watch(localeProvider);
    final supportUnread = ref.watch(unreadTicketRefsProvider).isNotEmpty; // a reply / resolution on one of the driver's tickets
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.profile'))),
      body: ListView(key: const Key('profile-list'), padding: const EdgeInsets.all(16), children: [
        SectionCard(child: Row(children: [
          CircleAvatar(radius: 28, backgroundColor: JR.accent, child: Text(_initial('${user?['name'] ?? ''}'), style: TextStyle(color: JR.accentInk, fontSize: 22, fontWeight: FontWeight.w800))),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${user?['name'] ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text('${user?['phone'] ?? ''}', textDirection: TextDirection.ltr, style: TextStyle(color: JR.muted)),
            if (user?['username'] is String) Text(t('m.au_username_is', {'name': user!['username']}), key: const Key('profile-username'), style: TextStyle(color: JR.muted, fontSize: 13)),
            const SizedBox(height: 6),
            if (ov != null) Pill(ov.verified ? t('m.verified_ok') : t('m.not_verified'), tone: ov.verified ? Tone.success : Tone.warn),
          ])),
        ])),
        const SizedBox(height: 12),
        if (ov != null) Row(children: [
          Expanded(child: SectionCard(child: Column(children: [Text('${ov.jobsCompleted}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: JR.accent)), Text(t('driver.completed'), style: TextStyle(color: JR.muted, fontSize: 12), textAlign: TextAlign.center)]))),
          const SizedBox(width: 12),
          Expanded(child: SectionCard(child: Column(children: [Text('${ov.rating ?? '—'}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: JR.gold)), Text(t('driver.rating'), style: TextStyle(color: JR.muted, fontSize: 12))]))),
        ]),
        for (final i in invites) ...[
          const SizedBox(height: 12),
          SectionCard(key: Key('invite-${i['id']}'), border: JR.cyan, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('driver.invite_from', {'name': (i['officeName'] ?? '')}), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4), Text(t('driver.invite_effect'), style: TextStyle(color: JR.muted, fontSize: 13)),
            // Money in the wallet (or a withdrawal waiting) stops him from joining: his earnings would go to the office and he could never see or withdraw it. Say so, and keep Accept off.
            if (block.blocks) ...[
              const SizedBox(height: 10),
              Banner2(key: const Key('invite-wallet-block'), tone: Tone.warn, title: t('gp.invite_blocked_title'), text: t('gp.invite_blocked_body', {'amount': fmtMoney(block.totalCents, lang), 'n': block.pendingWithdrawals})),
            ],
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: FilledButton(key: Key('invite-accept-${i['id']}'), onPressed: block.blocks ? null : () async { await guarded(context, () => ref.read(apiProvider).respondInvite('${i['id']}', true), success: 'common.saved'); ref.invalidate(invitesProvider); ref.invalidate(overviewProvider); }, child: Text(t('act.accept')))),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton(key: Key('invite-decline-${i['id']}'), onPressed: () async { await guarded(context, () => ref.read(apiProvider).respondInvite('${i['id']}', false)); ref.invalidate(invitesProvider); }, child: Text(t('act.decline')))),
            ]),
          ])),
        ],
        const SizedBox(height: 16),
        _tile(Icons.edit_outlined, t('m.edit_profile'), () => context.push('/profile/edit')),
        _tile(Icons.description_outlined, t('nav.documents'), () => context.push('/documents')),
        _tile(Icons.notifications_outlined, t('nav.notifications'), () => context.push('/notifications')),
        _tile(Icons.support_agent, t('nav.support'), () => context.push('/support'), trailing: supportUnread
            ? Row(mainAxisSize: MainAxisSize.min, children: [Container(key: const Key('support-unread-dot'), width: 10, height: 10, decoration: BoxDecoration(color: JR.accent, shape: BoxShape.circle)), const SizedBox(width: 6), Icon(Icons.chevron_right, color: JR.muted)])
            : null),
        _tile(Icons.lock_outline, t('m.au_cp_title'), () => context.push('/change-password')),
        _tile(Icons.language, t('m.language'), () => showLanguageSheet(context, ref), trailing: Text(langNames[ref.watch(localeProvider)]!, style: TextStyle(color: JR.muted))),
        _tile(Icons.brightness_6_outlined, t('m.theme_title'), () => showThemeSheet(context), key: const Key('profile-theme'), trailing: Text(themeModeLabel(context, ref.watch(themeModeProvider)), style: TextStyle(color: JR.muted))),
        _tile(Icons.gavel_outlined, t('lm.terms_title'), () => context.push('/legal/driver'), key: const Key('profile-terms')),
        _tile(Icons.privacy_tip_outlined, t('lm.privacy_policy_title'), () => context.push('/legal/privacy'), key: const Key('profile-privacy-policy')),
        const SizedBox(height: 4),
        const SupportContactCard(),
        const SizedBox(height: 12),
        const PrivacyCard(),
        const SizedBox(height: 12),
        _tile(Icons.logout, t('auth.logout'), () async {
          final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(content: Text(d.tr('m.logout_confirm')), actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(100, 44)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('auth.logout')))]));
          if (ok == true) await ref.read(authProvider.notifier).signOut();
        }, danger: true),
        const SizedBox(height: 16),
        Center(child: Text('${t('m.version', {'v': AppConfig.version})}\n${AppConfig.baseUrl}', textAlign: TextAlign.center, textDirection: TextDirection.ltr, style: TextStyle(color: JR.muted, fontSize: 11))),
      ]),
    );
  }

  Widget _tile(IconData i, String title, VoidCallback onTap, {Widget? trailing, bool danger = false, Key? key}) => Padding(key: key, padding: const EdgeInsets.only(bottom: 8), child: SectionCard(padding: EdgeInsets.zero, onTap: onTap, child: ListTile(leading: Icon(i, color: danger ? JR.danger : JR.cyan), title: Text(title, style: TextStyle(color: danger ? JR.danger : null, fontWeight: FontWeight.w600)), trailing: trailing ?? Icon(Icons.chevron_right, color: JR.muted))));
}
