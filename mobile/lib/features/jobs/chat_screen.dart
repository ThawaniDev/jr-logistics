import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../../widgets/common.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.offerId});
  final String offerId;
  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _c = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _msgs = [];
  Object? _error;
  bool _loading = true, _sending = false;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _load();
    _t = Timer.periodic(const Duration(seconds: 8), (_) => _load(silent: true));
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _load({bool silent = false}) async {
    try {
      final m = await ref.read(apiProvider).messages(widget.offerId);
      if (!mounted) return;
      setState(() { _msgs = m; _error = null; _loading = false; });
      WidgetsBinding.instance.addPostFrameCallback((_) { if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent); });
    } catch (e) {
      if (mounted && !silent) setState(() { _error = e; _loading = false; });
    }
  }

  Future<void> _send() async {
    final text = _c.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    final ok = await guarded(context, () async { await ref.read(apiProvider).sendMessage(widget.offerId, text); return true; });
    if (ok == true) { _c.clear(); await _load(); }
    if (mounted) setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tr;
    final me = ref.watch(authProvider).value?.user?['id'];
    return Scaffold(
      appBar: AppBar(title: Text(t('chat.title'))),
      body: Column(children: [
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator(color: JR.accent)) : _error != null ? ErrorView(error: _error!, onRetry: _load) : _msgs.isEmpty ? EmptyView(title: t('chat.empty'), icon: Icons.chat_bubble_outline) : ListView.builder(controller: _scroll, padding: const EdgeInsets.all(16), itemCount: _msgs.length, itemBuilder: (_, i) {
          final m = _msgs[i]; final mine = m['senderId'] == me;
          return Align(alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart, child: Container(
            margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10), constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
            decoration: BoxDecoration(color: mine ? JR.accent.withValues(alpha: 0.18) : JR.card, borderRadius: BorderRadius.circular(16), border: Border.all(color: mine ? JR.accent.withValues(alpha: 0.4) : JR.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (!mine) Text('${m['senderName']} · ${t('role.${m['senderRole']}')}', style: const TextStyle(color: JR.muted, fontSize: 11)),
              Text('${m['body']}', style: const TextStyle(fontSize: 15, height: 1.35)),
              Align(alignment: AlignmentDirectional.centerEnd, child: Text(fmtTime(m['createdAt'] as String), style: const TextStyle(color: JR.muted, fontSize: 10))),
            ]),
          ));
        })),
        SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 8), child: Row(children: [
          Expanded(child: TextField(key: const Key('chat-input'), controller: _c, maxLength: 1000, onChanged: (_) => setState(() {}), decoration: InputDecoration(hintText: t('m.chat_hint'), counterText: ''), onSubmitted: (_) => _send())),
          const SizedBox(width: 8),
          IconButton.filled(key: const Key('chat-send'), style: IconButton.styleFrom(backgroundColor: JR.accent, foregroundColor: JR.accentInk, minimumSize: const Size(54, 54)), onPressed: _sending || _c.text.trim().isEmpty ? null : _send, icon: Icon(Icons.send, textDirection: Directionality.of(context) == TextDirection.rtl ? TextDirection.ltr : TextDirection.rtl)),
        ]))),
      ]),
    );
  }
}
