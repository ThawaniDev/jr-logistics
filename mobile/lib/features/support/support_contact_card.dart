import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../data/company.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// "Contact support": call / WhatsApp / e-mail buttons for the channels the company published (Settings › Company on the web, `catalog.company`), and the
/// support hours. Shown on the sign-in page (a driver who cannot sign in has nobody else to ask) and in Profile; nothing at all while no channel is filled in.
class SupportContactCard extends ConsumerWidget {
  const SupportContactCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.tr;
    final lang = ref.watch(localeProvider);
    final contact = SupportContact.fromCatalog(ref.watch(catalogProvider).value, lang);
    if (!contact.any) return const SizedBox.shrink();
    final links = ref.read(linkOpenerProvider);

    Future<void> go(Future<bool> Function() open, String shown) async {
      final ok = await open();
      if (!ok && context.mounted) toast(context, t('lm.contact_failed', {'value': shown}), error: true);
    }

    Widget button(Key key, IconData icon, String label, VoidCallback onTap) => OutlinedButton.icon(key: key, style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)), onPressed: onTap, icon: Icon(icon, size: 20), label: Text(label, textAlign: TextAlign.center));

    return SectionCard(key: const Key('support-contact'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Icon(Icons.support_agent, color: JR.cyan),
        const SizedBox(width: 12),
        Expanded(child: Text(t('lm.contact_title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5))),
      ]),
      if (contact.hours.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(t('co.help_hours', {'hours': contact.hours}), key: const Key('support-hours'), style: TextStyle(color: JR.muted, fontSize: 13, height: 1.4))),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (contact.phone.isNotEmpty) button(const Key('contact-call'), Icons.call_outlined, t('lm.contact_call'), () => go(() => links.call(contact.phone), contact.phone)),
        if (contact.whatsappUri != null) button(const Key('contact-whatsapp'), Icons.chat_outlined, t('co.help_whatsapp'), () => go(() => links.open(contact.whatsappUri!), contact.whatsapp)),
        if (contact.emailUri != null) button(const Key('contact-email'), Icons.mail_outline, t('lm.contact_email'), () => go(() => links.open(contact.emailUri!), contact.email)),
      ]),
    ]));
  }
}
