import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/config.dart';
import 'core/i18n.dart';
import 'data/api_client.dart';
import 'data/driver_api.dart';
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
final prefsProvider = Provider<SharedPreferences>((_) => throw UnimplementedError('override in main'));

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.baseUrl,
      tokens: ref.watch(tokenStoreProvider),
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
  const AuthState({this.user, this.expired = false});
  final Json? user;
  final bool expired;
  bool get signedIn => user != null;
  bool get isDriver => user?['role'] == 'driver';
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
      return AuthState(user: u.cast<String, dynamic>());
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
    state = AsyncData(AuthState(user: user));
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

  /// Keeps the cached account in sync after the driver edits their profile (name/city/email).
  void updateUser(Json user) {
    final cur = state.value;
    state = AsyncData(AuthState(user: {...?cur?.user, ...user}));
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
    state = const AsyncData(AuthState(expired: true));
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

void refreshAll(WidgetRef ref) {
  ref.invalidate(overviewProvider);
  ref.invalidate(offersProvider);
  ref.invalidate(activeJobsProvider);
  ref.invalidate(historyJobsProvider);
  ref.invalidate(opportunitiesProvider);
  ref.invalidate(walletProvider);
}
