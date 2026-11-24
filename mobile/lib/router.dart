import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'features/auth/auth_session.dart';
import 'features/auth/change_password_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/cash/cash_screen.dart';
import 'features/home/shell.dart';
import 'features/home/today_screen.dart';
import 'features/legal/legal_gate_screen.dart';
import 'features/legal/legal_reader.dart';
import 'features/privacy/privacy_screen.dart';
import 'features/jobs/chat_screen.dart';
import 'features/jobs/job_detail_screen.dart';
import 'features/jobs/jobs_screen.dart';
import 'features/jobs/offers_screen.dart';
import 'features/jobs/route_map_screen.dart';
import 'features/profile/documents_screen.dart';
import 'features/profile/edit_profile_screen.dart';
import 'features/profile/notifications_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/support/new_ticket_screen.dart';
import 'features/support/support_screen.dart';
import 'features/support/ticket_screen.dart';
import 'features/wallet/wallet_screen.dart';
import 'core/crash_reporter.dart' show CurrentRoute;
import 'providers.dart';

/// Re-evaluates redirects whenever auth state changes.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) { ref.listen(authProvider, (_, _) => notifyListeners()); }
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _AuthListenable(ref);
  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: listenable,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      return authRedirect(loading: auth.isLoading, auth: auth.value, location: state.matchedLocation);
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/change-password', builder: (_, _) => const ChangePasswordScreen()),
      // The driver terms and the privacy policy: readable before signing in (registration) and from Profile. `/legal-accept` is the blocking re-acceptance page.
      GoRoute(path: '/legal-accept', builder: (_, _) => const LegalGateScreen()),
      GoRoute(path: '/legal/:kind', builder: (_, s) => LegalReaderScreen(slug: s.pathParameters['kind']!)),
      GoRoute(path: '/privacy', builder: (_, _) => const PrivacyScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const TodayScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/jobs', builder: (_, _) => const JobsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/offers', builder: (_, _) => const OffersScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/wallet', builder: (_, _) => const WalletScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen())]),
        ],
      ),
      GoRoute(path: '/job/:id', builder: (_, s) => JobDetailScreen(offerId: s.pathParameters['id']!), routes: [
        GoRoute(path: 'chat', builder: (_, s) => ChatScreen(offerId: s.pathParameters['id']!)),
        GoRoute(path: 'map', builder: (_, s) => RouteMapScreen(offerId: s.pathParameters['id']!)),
      ]),
      GoRoute(path: '/profile/edit', builder: (_, _) => const EditProfileScreen()),
      GoRoute(path: '/documents', builder: (_, _) => const DocumentsScreen()),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/cash', builder: (_, _) => const CashScreen()),
      // '/support/new' is declared before '/support/:id' so "new" is never read as a ticket id.
      GoRoute(path: '/support', builder: (_, _) => const SupportScreen(), routes: [
        GoRoute(path: 'new', builder: (_, s) => NewTicketScreen(offerId: s.uri.queryParameters['offerId'])),
        GoRoute(path: ':id', builder: (_, s) => TicketScreen(ticketId: s.pathParameters['id']!)),
      ]),
    ],
  );
  // The screen the driver is on goes into crash reports (ids removed).
  void track() => CurrentRoute.set(router.routerDelegate.currentConfiguration.uri.toString());
  router.routerDelegate.addListener(track);
  ref.onDispose(() => router.routerDelegate.removeListener(track));
  return router;
});
