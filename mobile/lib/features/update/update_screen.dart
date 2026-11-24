import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../core/version_gate.dart';
import '../../providers.dart';
import '../../services.dart';
import '../../widgets/common.dart';

/// Replaces the whole app while it is too old for the server (`426 UPGRADE_REQUIRED`, or the catalog's minimum is above the installed version).
/// Full screen and not dismissable: no back button leaves it for the app, and nothing underneath is reachable. The store button opens the link the
/// platform's settings give; when there is none (not set yet) the screen says to open the store by hand.
class UpdateGate extends ConsumerStatefulWidget {
  const UpdateGate({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends ConsumerState<UpdateGate> {
  @override
  void initState() {
    super.initState();
    // Cold start: the catalog is exempt from the 426, so it can tell an outdated app before the first protected call fails. Re-evaluated whenever the catalog reloads.
    ref.listenManual(catalogProvider, (_, next) {
      final c = next.value;
      if (c == null) return;
      final u = upgradeFromCatalog(c, ref.read(appInfoProvider));
      if (u != null) Future.microtask(() { if (mounted) ref.read(upgradeProvider.notifier).require(u); });
    }, fireImmediately: true);
  }

  @override
  Widget build(BuildContext context) {
    final up = ref.watch(upgradeProvider);
    return up == null ? widget.child : UpdateRequiredScreen(info: up);
  }
}

class UpdateRequiredScreen extends ConsumerStatefulWidget {
  const UpdateRequiredScreen({super.key, required this.info});
  final UpgradeInfo info;
  @override
  ConsumerState<UpdateRequiredScreen> createState() => _UpdateRequiredScreenState();
}

class _UpdateRequiredScreenState extends ConsumerState<UpdateRequiredScreen> {
  bool _opening = false, _checking = false;

  Future<void> _openStore() async {
    final uri = widget.info.storeUri;
    if (uri == null || _opening) return;
    setState(() => _opening = true);
    final ok = await ref.read(linkOpenerProvider).open(uri);
    if (!mounted) return;
    setState(() => _opening = false);
    if (!ok) toast(context, context.tr('lm.update_open_failed'), error: true);
  }

  /// "I have updated": reads the catalog again. A new build never gets here (it starts a new process); this is for a lowered minimum or a store link set meanwhile.
  Future<void> _recheck() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      ref.invalidate(catalogProvider);
      final cat = await ref.read(catalogProvider.future).timeout(const Duration(seconds: 8));
      final u = upgradeFromCatalog(cat, ref.read(appInfoProvider));
      if (u == null) {
        ref.read(upgradeProvider.notifier).clear();
        if (ref.read(authProvider).hasError) ref.invalidate(authProvider); // the start-up read that was refused with the 426 is repeated
        return;
      }
      ref.read(upgradeProvider.notifier).require(u);
      if (mounted) toast(context, context.tr('lm.update_still_old'), error: true);
    } catch (e) {
      if (mounted) toast(context, errMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final info = widget.info;
    final app = ref.watch(appInfoProvider);
    final platform = info.platform.isNotEmpty ? info.platform : app.platform;
    final current = info.currentVersion.isNotEmpty ? info.currentVersion : app.full;
    final buttonKey = platform == 'ios' ? 'lm.update_btn_ios' : platform == 'android' ? 'lm.update_btn_android' : 'lm.update_btn';
    final hasLink = info.storeUri != null;
    return PopScope(
      canPop: false,
      child: Scaffold(
        key: const Key('update-required'),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Center(child: ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.asset('assets/logo.png', width: 84, height: 84, errorBuilder: (_, _, _) => Icon(Icons.local_shipping, size: 64, color: JR.accent)))),
                  const SizedBox(height: 24),
                  Center(child: Container(
                    width: 64, height: 64, decoration: BoxDecoration(color: JR.accent.withValues(alpha: 0.14), shape: BoxShape.circle),
                    child: Icon(Icons.system_update_alt, size: 32, color: JR.accent),
                  )),
                  const SizedBox(height: 20),
                  Text(t('lm.update_title'), key: const Key('update-title'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, height: 1.25)),
                  const SizedBox(height: 10),
                  Text(t('lm.update_body'), key: const Key('update-body'), textAlign: TextAlign.center, style: TextStyle(color: JR.muted, height: 1.5, fontSize: 15)),
                  if (info.minVersion.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Text(t('lm.update_versions', {'current': current, 'min': info.minVersion}), key: const Key('update-versions'), textAlign: TextAlign.center, textDirection: TextDirection.ltr, style: TextStyle(color: JR.muted, fontSize: 13)),
                  ],
                  const SizedBox(height: 28),
                  if (hasLink)
                    FilledButton.icon(key: const Key('update-store'), style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54)), onPressed: _opening ? null : _openStore, icon: busyIcon(_opening, Icons.open_in_new), label: Text(t(buttonKey), textAlign: TextAlign.center))
                  else
                    Banner2(key: const Key('update-no-link'), tone: Tone.warn, text: t('lm.update_no_link')),
                  const SizedBox(height: 12),
                  TextButton.icon(key: const Key('update-recheck'), style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: _checking ? null : _recheck, icon: busyIcon(_checking, Icons.refresh, color: JR.accent), label: Text(t('lm.update_recheck'), textAlign: TextAlign.center)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
