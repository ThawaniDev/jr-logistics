import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/home/shell.dart';
import 'features/home/today_screen.dart';
import 'features/jobs/chat_screen.dart';
import 'features/jobs/job_detail_screen.dart';
import 'features/jobs/jobs_screen.dart';
import 'features/jobs/offers_screen.dart';
import 'features/jobs/route_screen.dart';
import 'features/profile/documents_screen.dart';
import 'features/profile/notifications_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/wallet/wallet_screen.dart';
import 'providers.dart';

/// Re-evaluates redirects whenever auth state changes.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) { ref.listen(authProvider, (_, _) => notifyListeners()); }
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _AuthListenable(ref);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: listenable,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      if (auth.isLoading) return null;
      final signedIn = auth.value?.signedIn == true;
      final loc = state.matchedLocation;
      final public = loc == '/login' || loc == '/register';
      if (!signedIn && !public) return '/login';
      if (signedIn && public) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (c, s) { final x = (s.extra as Map?) ?? const {}; return RegisterScreen(token: '${x['token'] ?? ''}', phone: '${x['phone'] ?? ''}'); }),
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
      GoRoute(path: '/job/:id', builder: (_, s) => JobDetailScreen(offerId: s.pathParameters['id']!), routes: [GoRoute(path: 'chat', builder: (_, s) => ChatScreen(offerId: s.pathParameters['id']!))]),
      GoRoute(path: '/route', builder: (_, _) => const RouteScreen()),
      GoRoute(path: '/documents', builder: (_, _) => const DocumentsScreen()),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
    ],
  );
});
