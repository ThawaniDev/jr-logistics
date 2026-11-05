import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Session token storage. Secure (Keychain/Keystore) in the app; in-memory for tests.
abstract class TokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? s]) : _s = s ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  static const _k = 'jr_session';
  @override
  Future<String?> read() => _s.read(key: _k);
  @override
  Future<void> write(String token) => _s.write(key: _k, value: token);
  @override
  Future<void> clear() => _s.delete(key: _k);
}

class MemoryTokenStore implements TokenStore {
  String? _t;
  @override
  Future<String?> read() async => _t;
  @override
  Future<void> write(String token) async => _t = token;
  @override
  Future<void> clear() async => _t = null;
}
