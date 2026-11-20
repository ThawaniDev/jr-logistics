import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';

/// Shared by the live API tests and the simulator end-to-end test: sign in as a seeded demo account with username + password.
/// The username of an account is found by its phone number on the public demo card (`GET /auth/demo-accounts`, demo mode only), so the tests
/// keep working whatever readable usernames the seed gives the demo accounts. Falls back to the migration rule `u<digits of the phone>`.
String intlDigits(String phone) {
  final d = phone.replaceAll(RegExp(r'\D'), '');
  return d.startsWith('966') ? d : d.startsWith('0') ? '966${d.substring(1)}' : d;
}

Future<({String username, String password})> demoCredentials(ApiClient client, String phone) async {
  const fallbackPassword = 'Demo#Pass2026';
  try {
    final items = (await client.get('/auth/demo-accounts'))['items'];
    if (items is List) {
      for (final i in items) {
        if (i is Map && i['phone'] is String && intlDigits('${i['phone']}') == intlDigits(phone) && i['username'] is String) {
          return (username: '${i['username']}', password: i['password'] is String ? '${i['password']}' : fallbackPassword);
        }
      }
    }
  } on ApiException catch (_) {/* not a demo deployment: use the rule below */}
  return (username: 'u${intlDigits(phone)}', password: fallbackPassword);
}

/// An [ApiClient] holding a fresh session of the demo account with this [phone] (e.g. `0500000011`).
Future<ApiClient> signedInClient(String baseUrl, String phone, {TokenStore? tokens}) async {
  final store = tokens ?? MemoryTokenStore();
  final client = ApiClient(baseUrl: baseUrl, tokens: store);
  final cred = await demoCredentials(client, phone);
  final r = await DriverApi(client).login(cred.username, cred.password);
  await store.write(r['token'] as String);
  return client;
}
