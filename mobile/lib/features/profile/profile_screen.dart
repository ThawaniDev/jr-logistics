import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/config.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';
import 'language_sheet.dart';

final invitesProvider = FutureProvider.autoDispose((ref) async => ((await ref.watch(apiProvider).invites())['items'] as List).cast<Map>());

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final user = ref.watch(authProvider).value?.user;
    final ov = ref.watch(overviewProvider).value;
    final invites = ref.watch(invitesProvider).value ?? const [];
    return Scaffold(
      appBar: AppBar(title: Text(t('nav.profile'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SectionCard(child: Row(children: [
          CircleAvatar(radius: 28, backgroundColor: JR.accent, child: Text('${user?['name'] ?? '?'}'.characters.first, style: const TextStyle(color: JR.accentInk, fontSize: 22, fontWeight: FontWeight.w800))),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${user?['name'] ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text('${user?['phone'] ?? ''}', textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted)),
            const SizedBox(height: 6),
            if (ov != null) Pill(ov.verified ? t('m.verified_ok') : t('m.not_verified'), tone: ov.verified ? Tone.success : Tone.warn),
          ])),
        ])),
        const SizedBox(height: 12),
        if (ov != null) Row(children: [
          Expanded(child: SectionCard(child: Column(children: [Text('${ov.jobsCompleted}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: JR.accent)), Text(t('driver.completed'), style: const TextStyle(color: JR.muted, fontSize: 12), textAlign: TextAlign.center)]))),
          const SizedBox(width: 12),
          Expanded(child: SectionCard(child: Column(children: [Text('${ov.rating ?? '—'}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: JR.gold)), Text(t('driver.rating'), style: const TextStyle(color: JR.muted, fontSize: 12))]))),
        ]),
        for (final i in invites) ...[
          const SizedBox(height: 12),
          SectionCard(border: JR.cyan, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t('driver.invite_from', {'name': (i['officeName'] ?? '')}), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4), Text(t('driver.invite_effect'), style: const TextStyle(color: JR.muted, fontSize: 13)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: FilledButton(onPressed: () async { await guarded(context, () => ref.read(apiProvider).respondInvite('${i['id']}', true), success: 'common.saved'); ref.invalidate(invitesProvider); ref.invalidate(overviewProvider); }, child: Text(t('act.accept')))),
              const SizedBox(width: 10),
              Expanded(child: OutlinedButton(onPressed: () async { await guarded(context, () => ref.read(apiProvider).respondInvite('${i['id']}', false)); ref.invalidate(invitesProvider); }, child: Text(t('act.decline')))),
            ]),
          ])),
        ],
        const SizedBox(height: 16),
        _tile(Icons.description_outlined, t('nav.documents'), () => context.push('/documents')),
        _tile(Icons.notifications_outlined, t('nav.notifications'), () => context.push('/notifications')),
        _tile(Icons.language, t('m.language'), () => showLanguageSheet(context, ref), trailing: Text(langNames[ref.watch(localeProvider)]!, style: const TextStyle(color: JR.muted))),
        _tile(Icons.logout, t('auth.logout'), () async {
          final ok = await showDialog<bool>(context: context, builder: (d) => AlertDialog(content: Text(d.tr('m.logout_confirm')), actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: Text(d.tr('common.cancel'))), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(100, 44)), onPressed: () => Navigator.pop(d, true), child: Text(d.tr('auth.logout')))]));
          if (ok == true) await ref.read(authProvider.notifier).signOut();
        }, danger: true),
        const SizedBox(height: 16),
        Center(child: Text('${t('m.version', {'v': AppConfig.version})}\n${AppConfig.baseUrl}', textAlign: TextAlign.center, textDirection: TextDirection.ltr, style: const TextStyle(color: JR.muted, fontSize: 11))),
      ]),
    );
  }

  Widget _tile(IconData i, String title, VoidCallback onTap, {Widget? trailing, bool danger = false}) => Padding(padding: const EdgeInsets.only(bottom: 8), child: SectionCard(padding: EdgeInsets.zero, onTap: onTap, child: ListTile(leading: Icon(i, color: danger ? JR.danger : JR.cyan), title: Text(title, style: TextStyle(color: danger ? JR.danger : null, fontWeight: FontWeight.w600)), trailing: trailing ?? const Icon(Icons.chevron_right, color: JR.muted))));
}
