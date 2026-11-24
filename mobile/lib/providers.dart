import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/app_info.dart';
import 'core/config.dart';
import 'core/i18n.dart';
import 'core/version_gate.dart';
import 'data/api_client.dart';
import 'data/driver_api.dart';
import 'data/legal_api.dart';
import 'data/models.dart';
import 'data/token_store.dart';

/// Riverpod 3 retries a failed provider up to 10 times (~1 minute of spinner) by default, and even for errors that can never
/// succeed (401, 404, 422). For a driver on a weak signal that is the worst of both worlds, so: only transient failures are
/// retried, once, after a second (the API client already retries reads on dropped connections), and everything else surfaces at
/// once as an error screen with a Retry button — or, if data is already shown, as a stale-data strip.
Duration? appRetry(int retryCount, Object error) => error is ApiException && error.isTransient && retryCount < 1 ? const Duration(seconds: 1) : null;

final tokenStoreProvider = Provider<TokenStore>((_) => SecureTokenStore());
/// Written to shared_preferences on the first launch of an install. iOS keeps keychain items when the app is deleted but wipes its preferences, so a missing
/// marker means "fresh install": a session token left over from an earlier install is dropped instead of signing the next owner of the phone in.
const installMarkerKey = 'install_marker';
/// Set while an account-deletion request of this driver is open (see `PrivacyScreen`). When the session then ends with a 401 the sign-in page can say that the
/// request may have been approved (the account is erased and its token stops working) instead of the usual "session expired".
const deletionRequestKey = 'privacy_deletion_requested';
final prefsProvider = Provider<SharedPreferences>((_) => throw UnimplementedError('override in main'));

/// Which build is running (version, build, platform): read from the app bundle in `main`; the pubspec values until then and in tests.
final appInfoProvider = Provider<AppInfo>((_) => AppInfo.fallback());

/// Set when the app must be updated (a `426 UPGRADE_REQUIRED` from the server, or the catalog minimum above the installed version): the whole app is then
/// replaced by the update screen. Only an update (a new process) or a lower minimum on the server clears it.
class UpgradeNotifier extends Notifier<UpgradeInfo?> {
  @override
  UpgradeInfo? build() => null;
  /// Keeps what is already known (a bare 426 must not erase the store link the catalog gave).
  void require(UpgradeInfo u) {
    final cur = state;
    if (cur == null) { state = u; return; }
    state = UpgradeInfo(minVersion: u.minVersion.isNotEmpty ? u.minVersion : cur.minVersion, currentVersion: u.currentVersion.isNotEmpty ? u.currentVersion : cur.currentVersion, platform: u.platform.isNotEmpty ? u.platform : cur.platform, storeUrl: u.storeUrl.isNotEmpty ? u.storeUrl : cur.storeUrl);
  }
  void clear() { if (state != null) state = null; }
}

final upgradeProvider = NotifierProvider<UpgradeNotifier, UpgradeInfo?>(UpgradeNotifier.new);

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.baseUrl,
      app: ref.watch(appInfoProvider),
      tokens: ref.watch(tokenStoreProvider),
      onUpgradeRequired: (u) => ref.read(upgradeProvider.notifier).require(u),
      onUnauthorized: () => ref.read(authProvider.notifier).expire(),
      onPasswordChange: () => ref.read(authProvider.notifier).requirePasswordChange(),
      onConnectivity: (ok) => ref.read(onlineProvider.notifier).set(ok),
    ));
final apiProvider = Provider<DriverApi>((ref) => DriverApi(ref.watch(apiClientProvider)));

/// False while the last request failed for lack of connectivity; true again as soon as the server answers anything.
class OnlineNotifier extends Notifier<bool> {
  @override
  bool build() => true;
  void set(bool v) { if (state != v) state = v; }
}

final onlineProvider = NotifierProvider<OnlineNotifier, bool>(OnlineNotifier.new);

// ── locale ──
class LocaleNotifier extends Notifier<String> {
  @override
  String build() {
    final saved = ref.read(prefsProvider).getString('lang');
    return supportedCodes.contains(saved) ? saved! : 'ar';
  }

  Future<void> set(String code) async {
    state = code;
    await ref.read(prefsProvider).setString('lang', code);
  }
}

final localeProvider = NotifierProvider<LocaleNotifier, String>(LocaleNotifier.new);
final stringsProvider = FutureProvider<Strings>((ref) => Strings.load(ref.watch(localeProvider)));

// ── auth ──
class AuthState {
  const AuthState({this.user, this.expired = false, this.afterDeletionRequest = false, this.legalPending = const []});
  final Json? user;
  final bool expired;
  /// The session ended while an account-deletion request was open: most likely the team approved it.
  final bool afterDeletionRequest;
  /// Terms / privacy-policy versions the driver has to accept again (`GET /auth/me` → `legal.pending`): while there are any, the app shows the acceptance screen.
  final List<PendingLegal> legalPending;
  bool get signedIn => user != null;
  bool get isDriver => user?['role'] == 'driver';
  AuthState copyWith({Json? user, List<PendingLegal>? legalPending}) => AuthState(user: user ?? this.user, expired: expired, afterDeletionRequest: afterDeletionRequest, legalPending: legalPending ?? this.legalPending);
}

class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    final store = ref.read(tokenStoreProvider);
    final prefs = ref.read(prefsProvider);
    if (prefs.getString(installMarkerKey) == null) {
      await store.clear();
      await prefs.setString(installMarkerKey, '1');
      return const AuthState();
    }
    if (await store.read() == null) return const AuthState();
    try {
      final me = await ref.read(apiProvider).me();
      final u = me['user'];
      if (u is! Map) throw ApiException('BAD_RESPONSE', 'no user in /auth/me');
      return AuthState(user: u.cast<String, dynamic>(), legalPending: PendingLegal.parse(me));
    } on ApiException catch (e) {
      // Only a definite "your session is invalid" signs the driver out. Offline, slow, a 5xx or a malformed answer must NOT
      // destroy a valid session (a server blip on app start would otherwise log every driver out): show the retry screen instead.
      if (!e.isAuth) rethrow;
      await store.clear();
      return const AuthState();
    }
  }

  Future<void> signIn(String token, Json user) async {
    await ref.read(tokenStoreProvider).write(token);
    // Terms the driver has to accept again are known only to /auth/me: ask before the first screen so the acceptance page replaces the home page without a flash.
    // Best effort and short: a weak signal must never keep a driver from signing in (the next resume / start asks again).
    final pending = await _pendingLegal().timeout(const Duration(seconds: 4), onTimeout: () => const <PendingLegal>[]);
    state = AsyncData(AuthState(user: user, legalPending: pending));
    final lang = user['language'];
    if (lang is String && supportedCodes.contains(lang)) await ref.read(localeProvider.notifier).set(lang);
  }

  Future<void> signOut() async {
    // Best effort with short leashes: a driver with no signal must still be able to sign out at once.
    final api = ref.read(apiProvider);
    // A driver who signs out is no longer reachable on this phone: take him offline and drop his last location first (decision D2), while the session is still valid.
    // (A session the server already ended — the 401 path, see [expire] — cannot do this: there is no token left to ask with.)
    await api.goOffline().timeout(const Duration(seconds: 3), onTimeout: () {});
    await api.logout().timeout(const Duration(seconds: 4), onTimeout: () {});
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState());
  }

  Future<List<PendingLegal>> _pendingLegal() async {
    try { return PendingLegal.parse(await ref.read(apiProvider).me()); } catch (_) { return const []; }
  }

  /// Asks the server which terms are waiting for the driver (after sign-in, when the app comes back to the front, and after a stale acceptance). Never throws.
  /// A failed answer keeps what is known: no signal must neither open nor close the acceptance screen.
  Future<void> refreshLegal() async {
    final cur = state.value;
    if (cur == null || !cur.signedIn) return;
    try {
      final me = await ref.read(apiProvider).me();
      final now = state.value;
      if (now == null || !now.signedIn) return;
      state = AsyncData(now.copyWith(legalPending: PendingLegal.parse(me)));
    } catch (_) {/* keep what is known */}
  }

  /// The pending list after the driver accepted (or from the server's answer): an empty list opens the app.
  void setLegalPending(List<PendingLegal> pending) {
    final cur = state.value;
    if (cur == null || !cur.signedIn) return;
    state = AsyncData(cur.copyWith(legalPending: pending));
  }

  /// Keeps the cached account in sync after the driver edits their profile (name/city/email).
  void updateUser(Json user) {
    final cur = state.value;
    state = AsyncData(AuthState(user: {...?cur?.user, ...user}, legalPending: cur?.legalPending ?? const []));
  }

  /// The server wants a new password before it answers anything else (`403 PASSWORD_CHANGE_REQUIRED`): the router then shows "choose a new password".
  void requirePasswordChange() {
    final cur = state.value;
    if (cur == null || !cur.signedIn || cur.user?['mustChangePassword'] == true) return;
    updateUser({'mustChangePassword': true});
  }

  void expire() {
    // Only a signed-in session can expire: a straggler request that answers 401 after the driver signed out on purpose must not turn the sign-in
    // screen into "your session expired".
    if (state.value?.signedIn != true) return;
    ref.read(tokenStoreProvider).clear();
    final prefs = ref.read(prefsProvider);
    final afterRequest = prefs.getBool(deletionRequestKey) == true;
    if (afterRequest) prefs.remove(deletionRequestKey);
    state = AsyncData(AuthState(expired: true, afterDeletionRequest: afterRequest));
  }
}

final authProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);

// ── data (auto-refreshing via invalidate after actions) ──
final overviewProvider = FutureProvider.autoDispose<Overview>((ref) => ref.watch(apiProvider).overview());
final offersProvider = FutureProvider.autoDispose<List<Job>>((ref) => ref.watch(apiProvider).offers());
final activeJobsProvider = FutureProvider.autoDispose<List<Job>>((ref) => ref.watch(apiProvider).jobs(active: true));
/// The driver's finished jobs, newest first. The server pages at 100; the first page loads with the screen and [HistoryJobs.loadMore] appends the next ones.
final historyJobsProvider = AsyncNotifierProvider.autoDispose<HistoryJobs, List<Job>>(HistoryJobs.new);

class HistoryJobs extends AsyncNotifier<List<Job>> {
  int _total = 0, _pageSize = 0, _page = 1;
  /// The server answered an empty page: nothing is left, whatever the total said (jobs that moved between pages can leave it off by a few).
  bool _done = false;
  /// There are older jobs on the server than the ones loaded.
  bool get hasMore {
    if (_done) return false;
    final n = state.value?.length ?? 0;
    return _total > 0 ? n < _total : (_pageSize > 0 && n >= _pageSize * _page);
  }
  int get total => _total;

  @override
  Future<List<Job>> build() async {
    final p = await ref.watch(apiProvider).jobsPage(active: false);
    _total = p.total; _pageSize = p.pageSize; _page = 1; _done = false;
    return p.items;
  }

  /// Appends the next page (jobs already shown are skipped, so a new job arriving meanwhile never duplicates a row). Throws like any API call.
  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || !hasMore) return;
    final p = await ref.read(apiProvider).jobsPage(active: false, page: _page + 1);
    final seen = {for (final j in cur) j.offerId};
    _page += 1;
    _total = p.total > 0 ? p.total : _total;
    if (p.items.isEmpty) { _done = true; state = AsyncData([...cur]); return; } // rebuilds the list, so the "Load more" row goes
    state = AsyncData([...cur, for (final j in p.items) if (!seen.contains(j.offerId)) j]);
  }
}
final opportunitiesProvider = FutureProvider.autoDispose<List<Json>>((ref) => ref.watch(apiProvider).opportunities());
final jobProvider = FutureProvider.autoDispose.family<Job, String>((ref, id) => ref.watch(apiProvider).job(id));
final profileProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).profile());
final custodyProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, id) => ref.watch(apiProvider).custody(id));
final walletProvider = FutureProvider.autoDispose<Json>((ref) => ref.watch(apiProvider).wallet());
final catalogProvider = FutureProvider<Json>((ref) => ref.watch(apiProvider).catalog());

// ── legal texts (driver terms, privacy policy) ──
final legalApiProvider = Provider<LegalApi>((ref) => LegalApi(ref.watch(apiProvider).c));
/// One text in one language. Autodisposed: a reader that is closed does not keep a long markdown text in memory.
final legalDocProvider = FutureProvider.autoDispose.family<LegalDoc, ({String slug, String lang})>((ref, k) => ref.watch(legalApiProvider).doc(k.slug, k.lang));

void refreshAll(WidgetRef ref) {
  ref.invalidate(overviewProvider);
  ref.invalidate(offersProvider);
  ref.invalidate(activeJobsProvider);
  ref.invalidate(historyJobsProvider);
  ref.invalidate(opportunitiesProvider);
  ref.invalidate(walletProvider);
}
