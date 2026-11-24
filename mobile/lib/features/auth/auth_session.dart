import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/api_client.dart';
import '../../providers.dart';

/// Where the username of the last successful sign-in is remembered on the device (shared_preferences; never the password).
const lastUsernameKey = 'last_username';

extension AuthStateAuth on AuthState {
  /// A staff-created or staff-reset account carries a temporary password: the app shows "choose a new password" before anything else.
  bool get mustChangePassword => user?['mustChangePassword'] == true;
}

/// The one-time notice on the sign-in screen after the password was changed and the session had to be closed ("sign in with the new password").
class PasswordChangedNotice extends Notifier<bool> {
  @override
  bool build() => false;
  void set(bool v) => state = v;
}

final passwordChangedNoticeProvider = NotifierProvider<PasswordChangedNotice, bool>(PasswordChangedNotice.new);

/// Router redirect rules for the auth state (pure, so they are unit-tested): signed out -> sign-in; signed in on a public page -> home;
/// a pending password change locks every other page until it is done, and so does a newer version of the terms / privacy policy that has not been
/// accepted yet (`/legal-accept`). The legal texts themselves (`/legal/…`) are readable signed in or out — the registration page links to them and the
/// acceptance page opens them.
String? authRedirect({required bool loading, required AuthState? auth, required String location}) {
  if (loading) return null;
  final signedIn = auth?.signedIn == true;
  final authOnly = location == '/login' || location == '/register';
  final shared = location.startsWith('/legal/');
  if (!signedIn) return authOnly || shared ? null : '/login';
  if (auth!.mustChangePassword) return location == '/change-password' ? null : '/change-password';
  if (auth.legalPending.isNotEmpty) return location == '/legal-accept' || shared ? null : '/legal-accept';
  if (location == '/legal-accept') return '/';
  return authOnly ? '/' : null;
}

enum PasswordChangeOutcome { sessionKept, signedInAgain, signedOut }

/// `POST /auth/change-password`, then keeps the driver going whatever the server did with the sessions: a fresh `{token, user}` in the answer wins,
/// else the current session if it still works (`/auth/me`), else a new sign-in with the new password, and only as a last resort a sign-out with a
/// notice on the login screen. Throws the `ApiException` of the change itself (wrong current password, rule not met, offline…).
Future<PasswordChangeOutcome> changePasswordAndContinue(WidgetRef ref, String current, String next) async {
  final api = ref.read(apiProvider);
  final auth = ref.read(authProvider.notifier);
  final username = ref.read(authProvider).value?.user?['username'];
  final r = await api.changePassword(current, next);
  final token = r['token'], fresh = r['user'];
  if (token is String && fresh is Map) { await auth.signIn(token, fresh.cast<String, dynamic>()); return PasswordChangeOutcome.sessionKept; }
  try {
    final me = (await api.me())['user'];
    if (me is Map) { auth.updateUser({...me.cast<String, dynamic>(), 'mustChangePassword': false}); return PasswordChangeOutcome.sessionKept; }
  } on ApiException catch (_) {/* sessions were revoked (or no signal): try a fresh sign-in below */}
  if (username is String && username.isNotEmpty) {
    try {
      final l = await api.login(username, next);
      final t = l['token'], u = l['user'];
      if (t is String && u is Map) { await auth.signIn(t, u.cast<String, dynamic>()); return PasswordChangeOutcome.signedInAgain; }
    } on ApiException catch (_) {/* fall through */}
  }
  ref.read(passwordChangedNoticeProvider.notifier).set(true);
  await auth.signOut();
  return PasswordChangeOutcome.signedOut;
}

/// After a `401` from `/auth/change-password`: is the *session* gone (true) or was it the typed current password (false)?
/// Both answer UNAUTHENTICATED, so ask the server who we are. Offline counts as "session fine" (the typed password is the likelier culprit).
Future<bool> sessionExpired(WidgetRef ref) async {
  try { await ref.read(apiProvider).me(); return false; } on ApiException catch (e) { return e.isAuth; }
}
