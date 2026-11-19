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
final prefsProvider = Provider<SharedPreferences>((_) => throw UnimplementedError('override in main'));

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.baseUrl,
      tokens: ref.watch(tokenStoreProvider),
      onUnauthorized: () => ref.read(authProvider.notifier).expire(),
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
    // Best effort with a short leash: a driver with no signal must still be able to sign out immediately.
    await ref.read(apiProvider).logout().timeout(const Duration(seconds: 4), onTimeout: () {});
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState());
  }

  /// Keeps the cached account in sync after the driver edits their profile (name/city/email).
  void updateUser(Json user) {
    final cur = state.value;
    state = AsyncData(AuthState(user: {...?cur?.user, ...user}));
  }

  void expire() {
    ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState(expired: true));
  }
}

final authProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);

// ── data (auto-refreshing via invalidate after actions) ──
final overviewProvider = FutureProvider.autoDispose<Overview>((ref) => ref.watch(apiProvider).overview());
final offersProvider = FutureProvider.autoDispose<List<Job>>((ref) => ref.watch(apiProvider).offers());
final activeJobsProvider = FutureProvider.autoDispose<List<Job>>((ref) => ref.watch(apiProvider).jobs(active: true));
final historyJobsProvider = FutureProvider.autoDispose<List<Job>>((ref) => ref.watch(apiProvider).jobs(active: false));
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
