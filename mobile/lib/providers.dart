import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/config.dart';
import 'core/i18n.dart';
import 'data/api_client.dart';
import 'data/driver_api.dart';
import 'data/models.dart';
import 'data/token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((_) => SecureTokenStore());
final prefsProvider = Provider<SharedPreferences>((_) => throw UnimplementedError('override in main'));

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.baseUrl,
      tokens: ref.watch(tokenStoreProvider),
      onUnauthorized: () => ref.read(authProvider.notifier).expire(),
    ));
final apiProvider = Provider<DriverApi>((ref) => DriverApi(ref.watch(apiClientProvider)));

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
      return AuthState(user: (me['user'] as Map).cast<String, dynamic>());
    } on ApiException catch (e) {
      if (e.isNetwork) rethrow; // keep the token; the user is probably just offline
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
    await ref.read(apiProvider).logout();
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState());
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
