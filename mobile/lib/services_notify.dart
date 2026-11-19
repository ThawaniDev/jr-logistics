import 'dart:async';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform, visibleForTesting;
import 'package:flutter/material.dart' show GlobalKey, ScaffoldMessengerState;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/i18n.dart';
import 'data/models_extra.dart';
import 'providers.dart';
import 'providers_extra.dart';
import 'widgets/common.dart' show HapticKind, haptic;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// New-offer alerts (E12). Honest scope: while the app process is alive (foreground, or shortly after it was put in the background) it polls
// `GET /notifications?unreadOnly=1` and raises a LOCAL notification for every unseen `offer_new`. True background push — a phone that is locked for
// an hour, or an app the OS has killed — needs FCM (Android) / APNs (iOS) credentials: an owner item, see mobile/README.md.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/// What to show in the system tray.
class LocalNotice {
  const LocalNotice({required this.id, required this.title, required this.body, this.payload, this.channelName = 'New offers', this.channelDescription = 'New job offers'});
  final int id;
  final String title, body, channelName, channelDescription;
  /// Handed back by [LocalNotifier.taps] when the driver taps the notification.
  final String? payload;
}

/// The device notification centre, behind an interface so screens and the poller are testable without a platform channel.
abstract class LocalNotifier {
  /// Payloads of notifications the driver tapped while the app was running.
  Stream<String?> get taps;
  /// The payload of the notification that STARTED the app (cold start), once; null otherwise.
  Future<String?> takeLaunchPayload();
  /// True / false = the OS lets us post notifications; null = unknown or not supported on this platform (then no prompt is shown).
  Future<bool?> granted();
  /// Asks the OS (Android 13+ / iOS). Returns whether notifications are allowed afterwards.
  Future<bool> requestPermission();
  Future<void> show(LocalNotice n);
  Future<void> cancelAll();
  /// Opens the OS notification settings of this app (to re-enable what the driver denied).
  Future<bool> openSettings();
}

/// Default: does nothing (tests, unsupported platforms, or when the plugin failed to initialise).
class NoopNotifier implements LocalNotifier {
  final shown = <LocalNotice>[];
  @override
  Stream<String?> get taps => const Stream.empty();
  @override
  Future<String?> takeLaunchPayload() async => null;
  @override
  Future<bool?> granted() async => null;
  @override
  Future<bool> requestPermission() async => false;
  @override
  Future<void> show(LocalNotice n) async { shown.add(n); }
  @override
  Future<void> cancelAll() async {}
  @override
  Future<bool> openSettings() async => false;
}

/// `flutter_local_notifications`: Android channel "offers" (high importance, sound, vibration), iOS alert + sound + badge.
/// Created and initialised once in `main()`; every method is failure-proof — a notification problem must never break the app.
class DeviceLocalNotifier implements LocalNotifier {
  final _plugin = FlutterLocalNotificationsPlugin();
  final _taps = StreamController<String?>.broadcast();
  String? _launch;
  bool _ready = false;

  /// [true] when the plugin is usable. Permission is NOT requested here (the home screen asks politely, at a sensible moment).
  Future<bool> init() async {
    try {
      final ok = await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('ic_stat_notify'),
          iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false),
        ),
        onDidReceiveNotificationResponse: (r) => _taps.add(r.payload),
      );
      final d = await _plugin.getNotificationAppLaunchDetails();
      if (d?.didNotificationLaunchApp == true) _launch = d?.notificationResponse?.payload ?? 'offers';
      _ready = ok != false;
    } catch (_) {
      _ready = false;
    }
    return _ready;
  }

  @override
  Stream<String?> get taps => _taps.stream;

  @override
  Future<String?> takeLaunchPayload() async { final p = _launch; _launch = null; return p; }

  @override
  Future<bool?> granted() async {
    if (!_ready) return null;
    try {
      switch (defaultTargetPlatform) {
        case TargetPlatform.android:
          return await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.areNotificationsEnabled();
        case TargetPlatform.iOS:
          return (await _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()?.checkPermissions())?.isEnabled;
        default:
          return null;
      }
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> requestPermission() async {
    if (!_ready) return false;
    try {
      switch (defaultTargetPlatform) {
        case TargetPlatform.android:
          return await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission() ?? false;
        case TargetPlatform.iOS:
          return await _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()?.requestPermissions(alert: true, badge: true, sound: true) ?? false;
        default:
          return false;
      }
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> show(LocalNotice n) async {
    if (!_ready) return;
    try {
      await _plugin.show(
        id: n.id, title: n.title, body: n.body, payload: n.payload,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails('offers', n.channelName, channelDescription: n.channelDescription, importance: Importance.high, priority: Priority.high, playSound: true, enableVibration: true, category: AndroidNotificationCategory.recommendation, icon: 'ic_stat_notify'),
          iOS: const DarwinNotificationDetails(presentAlert: true, presentSound: true, presentBadge: true),
        ),
      );
    } catch (_) {/* a notification that cannot be shown is not worth a crash */}
  }

  @override
  Future<void> cancelAll() async { if (_ready) { try { await _plugin.cancelAll(); } catch (_) {} } }

  @override
  Future<bool> openSettings() async {
    if (!_ready) return false;
    try {
      return await switch (defaultTargetPlatform) {
            TargetPlatform.android => _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.openAppNotificationSettings(),
            TargetPlatform.iOS => _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()?.openAppNotificationSettings(),
            _ => Future<bool?>.value(false),
          } ?? false;
    } catch (_) {
      return false;
    }
  }
}

/// Overridden in `main()` with the initialised [DeviceLocalNotifier].
final localNotifierProvider = Provider<LocalNotifier>((_) => NoopNotifier());

/// Whether the OS allows notifications (null = unknown / unsupported → no prompt).
final notifyGrantedProvider = FutureProvider.autoDispose<bool?>((ref) => ref.watch(localNotifierProvider).granted());

// ── dedupe ──

/// The ids of notifications already handled, remembered across app restarts (oldest first).
abstract class SeenStore {
  List<String> load();
  Future<void> save(List<String> ids);
}

class PrefsSeenStore implements SeenStore {
  PrefsSeenStore(this.prefs, {this.key = 'notif_seen_ids'});
  final SharedPreferences prefs;
  final String key;
  @override
  List<String> load() => prefs.getStringList(key) ?? const [];
  @override
  Future<void> save(List<String> ids) async { await prefs.setStringList(key, ids); }
}

class MemorySeenStore implements SeenStore {
  MemorySeenStore([List<String>? initial]) : _ids = [...?initial];
  List<String> _ids;
  @override
  List<String> load() => _ids;
  @override
  Future<void> save(List<String> ids) async { _ids = [...ids]; }
}

typedef PeriodicFactory = Timer Function(Duration every, void Function() tick);
Timer _defaultPeriodic(Duration every, void Function() tick) => Timer.periodic(every, (_) => tick());

/// Polls for unread notifications and reports each unseen `offer_new` exactly once (also across restarts).
///
/// * foreground: every [interval] (≈ 20 s); in the background (process still alive) every [backgroundInterval]; immediately on resume;
/// * an `offer_new` older than [maxAge] is remembered but not announced (a fresh install must not replay yesterday's offers);
/// * one poll at a time; errors are swallowed (the next tick retries) — a flaky network must never surface as an error to the driver;
/// * [stop] ends it for good: a poll that is still in flight when the driver signs out is ignored.
///
/// Clock, timer, API and storage are injected, so the whole behaviour is unit-testable with fakes.
class OfferPoller {
  OfferPoller({
    required this.fetch, required this.seen, required this.onAlerts,
    this.interval = const Duration(seconds: 20), this.backgroundInterval = const Duration(seconds: 60),
    this.maxAge = const Duration(hours: 6), this.maxSeen = 300, DateTime Function()? now, PeriodicFactory? periodic,
  })  : _now = now ?? DateTime.now, _periodic = periodic ?? _defaultPeriodic;

  final Future<List<AppNotification>> Function() fetch;
  final SeenStore seen;
  /// New offers, oldest first (so the newest ends up on top of the notification shade).
  final FutureOr<void> Function(List<AppNotification> offers) onAlerts;
  final Duration interval, backgroundInterval, maxAge;
  final int maxSeen;
  final DateTime Function() _now;
  final PeriodicFactory _periodic;

  Timer? _timer;
  bool _running = false, _busy = false, _foreground = true;
  int polls = 0;

  bool get running => _running;
  bool get foreground => _foreground;
  Duration get currentInterval => _foreground ? interval : backgroundInterval;

  void start({bool immediate = true}) {
    if (_running) return;
    _running = true;
    _schedule();
    if (immediate) unawaited(pollOnce());
  }

  void stop() {
    _running = false;
    _timer?.cancel();
    _timer = null;
  }

  /// The app went to / came back from the background. Coming back polls at once.
  void setForeground(bool foreground) {
    if (_foreground == foreground) return;
    _foreground = foreground;
    if (!_running) return;
    _schedule();
    if (foreground) unawaited(pollOnce());
  }

  void _schedule() {
    _timer?.cancel();
    _timer = _periodic(currentInterval, () => unawaited(pollOnce()));
  }

  Future<void> pollOnce() async {
    if (!_running || _busy) return;
    _busy = true;
    polls++;
    try {
      final items = await fetch();
      if (!_running) return; // signed out while the request was in flight
      final ids = [...seen.load()];
      final known = ids.toSet();
      final fresh = <AppNotification>[];
      var remembered = false;
      for (final n in items) {
        if (n.type != 'offer_new' || n.id.isEmpty || known.contains(n.id)) continue;
        known.add(n.id);
        ids.add(n.id);
        remembered = true;
        final created = n.created;
        final stale = created != null && _now().difference(created) > maxAge;
        if (n.unread && !stale) fresh.add(n);
      }
      // Remembered BEFORE the alert is raised: a crash while showing it must not make the same offer ring again on the next start.
      if (remembered) await seen.save(ids.length > maxSeen ? ids.sublist(ids.length - maxSeen) : ids);
      if (fresh.isNotEmpty && _running) await onAlerts(fresh.reversed.toList()); // the server answers newest first
    } catch (_) {
      // network / server hiccup: stay quiet, try again on the next tick
    } finally {
      _busy = false;
    }
  }

  @visibleForTesting
  Timer? get debugTimer => _timer;
}

/// A stable positive 31-bit id for the OS notification (FNV-1a): the same notification never stacks twice.
int stableNotificationId(String s) {
  var h = 0x811c9dc5;
  for (final u in s.codeUnits) { h ^= u; h = (h * 0x01000193) & 0xffffffff; }
  h &= 0x7fffffff;
  return h == 0 ? 1 : h;
}

/// Title and text of the device notification / in-app banner for one new offer: `notif.offer_new` with `{ref} {parcels} {pickupCity} {deliveryCity}`.
({String title, String body}) offerNotice(Strings t, AppNotification n) => (
      title: t('fmb.notify_offer_title'),
      body: t.has('notif.offer_new') ? t('notif.offer_new', n.vars(city: (k) => t.has('city.$k') ? t('city.$k') : k)) : t('um.notif_generic'),
    );

// ── state shared with the UI ──

/// The signed-in driver's id (null = signed out, or not a driver). Everything below restarts when it changes.
final authUserIdProvider = Provider<String?>((ref) => ref.watch(authProvider.select((a) { final v = a.value; return v != null && v.isDriver ? '${v.user?['id']}' : null; })));

/// One raised alert, for the in-app banner. [seq] changes on every alert, so listeners can tell a new one from a rebuild.
class OfferAlertsState {
  const OfferAlertsState({this.unseen = 0, this.seq = 0, this.banner, this.count = 0});
  /// Offers announced since the driver last opened the Offers tab (the dot on the tab).
  final int unseen;
  final int seq;
  final String? banner;
  final int count;
}

class OfferAlerts extends Notifier<OfferAlertsState> {
  @override
  OfferAlertsState build() { ref.watch(authUserIdProvider); return const OfferAlertsState(); }
  void raise(int n, String banner) => state = OfferAlertsState(unseen: state.unseen + n, seq: state.seq + 1, banner: banner, count: n);
  /// The driver looked at the Offers tab.
  void clear() { if (state.unseen != 0) state = OfferAlertsState(seq: state.seq); }
}

final offerAlertsProvider = NotifierProvider<OfferAlerts, OfferAlertsState>(OfferAlerts.new);

/// The `ScaffoldMessenger` of the whole app — lets an alert show its banner no matter which screen is open.
final rootMessengerKeyProvider = Provider<GlobalKey<ScaffoldMessengerState>>((_) => GlobalKey<ScaffoldMessengerState>());

/// Max separate notifications per poll; more than this collapse into one "+N more" line.
const maxSeparateAlerts = 3;

/// Builds and starts the poller for the signed-in driver; null (and the old one stopped) when signed out. Watch it from a widget that lives for the whole session.
final offerPollerProvider = Provider<OfferPoller?>((ref) {
  final uid = ref.watch(authUserIdProvider);
  if (uid == null) return null;
  final notifier = ref.read(localNotifierProvider);
  var alive = true;
  final poller = OfferPoller(
    fetch: () => ref.read(extraApiProvider).unreadNotifications(),
    seen: PrefsSeenStore(ref.read(prefsProvider)),
    onAlerts: (offers) async {
      if (!alive) return;
      final Strings t = await ref.read(stringsProvider.future);
      if (!alive) return;
      final shown = offers.length <= maxSeparateAlerts ? offers : offers.sublist(offers.length - maxSeparateAlerts + 1);
      final channel = t('fmb.notify_channel'), channelDesc = t('fmb.notify_channel_desc');
      if (offers.length > shown.length) {
        await notifier.show(LocalNotice(id: stableNotificationId('offers-more'), title: t('fmb.notify_offer_title'), body: t('fmb.notify_more', {'n': offers.length - shown.length}), payload: 'offers', channelName: channel, channelDescription: channelDesc));
      }
      for (final n in shown) {
        final m = offerNotice(t, n);
        await notifier.show(LocalNotice(id: stableNotificationId(n.id), title: m.title, body: m.body, payload: 'offers', channelName: channel, channelDescription: channelDesc));
      }
      haptic(HapticKind.success);
      final last = offerNotice(t, offers.last);
      ref.read(offerAlertsProvider.notifier).raise(offers.length, offers.length == 1 ? last.body : t('fmb.notify_banner_many', {'n': offers.length}));
      // The list, the tab badge and the home screen must show the new offer right away, not at their next refresh.
      ref.invalidate(offersProvider);
      ref.invalidate(offersInfoProvider);
      ref.invalidate(overviewProvider);
    },
  );
  ref.onDispose(() { alive = false; poller.stop(); notifier.cancelAll(); });
  poller.start();
  return poller;
});
