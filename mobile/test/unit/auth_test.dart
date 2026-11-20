import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jr_driver/data/api_client.dart';
import 'package:jr_driver/data/driver_api.dart';
import 'package:jr_driver/data/token_store.dart';
import 'package:jr_driver/features/auth/auth_rules.dart';
import 'package:jr_driver/features/auth/auth_session.dart';
import 'package:jr_driver/providers.dart';
import '../helpers.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  RequestOptions? last;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? body, Future<void>? cancel) async { last = o; return respond(o); }
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, String body) => ResponseBody.fromString(body, status, headers: {Headers.contentTypeHeader: ['application/json']});
ApiException _err(String code, {int status = 400, Map<String, dynamic> details = const {}}) => ApiException(code, 'x', status: status, details: details);

void main() {
  group('username rules (server: 3-30 chars of [a-z0-9._-], starts with a letter or digit)', () {
    test('valid and invalid shapes', () {
      for (final ok in ['abc', 'demo.driver', 'u966500000011', 'a-b_c.d', '9lives', 'a' * 30]) { expect(usernameValid(ok), isTrue, reason: ok); }
      for (final bad in ['', 'ab', 'a' * 31, '.abc', '-abc', '_abc', 'ab c', 'Abc', 'abc!', 'عمر12', 'a@b.c']) { expect(usernameValid(bad), isFalse, reason: bad); }
    });
    test('normalizeUsername trims, lower-cases and converts Arabic-Indic digits', () {
      expect(normalizeUsername('  Demo.Driver '), 'demo.driver');
      expect(normalizeUsername('U٩٦٦٥'), 'u9665');
    });
    test('UsernameFormatter keeps only allowed characters, lower-cased, at most 30', () {
      const f = UsernameFormatter();
      TextEditingValue run(String s) => f.formatEditUpdate(TextEditingValue.empty, TextEditingValue(text: s, selection: TextSelection.collapsed(offset: s.length)));
      expect(run('Omar Test!').text, 'omartest');
      expect(run('a.b-c_d').text, 'a.b-c_d');
      expect(run('x' * 40).text.length, 30);
      expect(run('OMAR٢').text, 'omar2');
      expect(run('omar').selection.baseOffset, 4);
    });
  });

  group('password rules (server passwordProblem: 10+ chars, a Latin letter and a digit)', () {
    test('every combination', () {
      expect(checkPassword('').ok, isFalse);
      expect(checkPassword('short1').long, isFalse);
      expect(checkPassword('Abcdefghi1').ok, isTrue, reason: 'exactly 10 characters');
      expect(checkPassword('Abcdefgh1').long, isFalse, reason: '9 characters');
      final noDigit = checkPassword('abcdefghijkl');
      expect((noDigit.long, noDigit.letter, noDigit.digit, noDigit.ok), (true, true, false, false));
      final noLetter = checkPassword('1234567890123');
      expect((noLetter.long, noLetter.letter, noLetter.digit, noLetter.ok), (true, false, true, false));
      expect(checkPassword('كلمةمرور١٢٣٤٥').ok, isFalse, reason: 'only Latin letters and ASCII digits count, like the server');
      expect(checkPassword('Demo#Pass2026').ok, isTrue);
      expect(checkPassword('a1' * 101).long, isFalse, reason: 'the server caps a password at 200 characters');
    });
  });

  group('phone', () {
    test('9-15 digits, optional +, separators ignored, any digit script', () {
      expect(phoneValid('0500000011'), isTrue);
      expect(phoneValid('+966 50 000 0011'), isTrue);
      expect(phoneValid('(050) 000-0011'), isTrue);
      expect(phoneValid('٠٥٠٠٠٠٠٠١١'), isTrue);
      expect(phoneValid('05000'), isFalse);
      expect(phoneValid('abc'), isFalse);
      expect(phoneValid('1' * 16), isFalse);
      expect(phoneDigits('+966 50-000 0011'), '+966500000011');
    });
  });

  group('error mapping', () {
    test('sign-in failures map to their own dictionary keys; connectivity falls through to the generic messages', () {
      expect(loginErrorKey(_err('UNAUTHENTICATED', status: 401)), 'm.au_err_credentials');
      expect(loginErrorKey(_err('VALIDATION', status: 422)), 'm.au_err_credentials');
      expect(loginErrorKey(_err('RATE_LIMITED', status: 429)), 'm.au_err_rate');
      expect(loginErrorKey(_err('FORBIDDEN', status: 403)), 'm.au_err_suspended');
      for (final c in ['NETWORK', 'TIMEOUT', 'UNAVAILABLE', 'INTERNAL', 'BAD_RESPONSE']) { expect(loginErrorKey(_err(c)), isNull, reason: c); }
      expect(loginErrorKey(StateError('boom')), isNull);
    });
    test('every key the auth screens use exists in all three dictionaries', () {
      for (final lang in ['en', 'ar', 'ur']) {
        final d = loadDict(lang);
        for (final k in ['m.au_err_credentials', 'm.au_err_rate', 'm.au_err_suspended', 'm.au_un_taken', 'm.au_un_reserved', 'm.au_un_rules', 'm.au_un_checking', 'm.au_un_ok', 'm.au_un_unchecked', 'm.au_err_phone_taken', 'm.au_err_email_taken', 'm.au_err_field', 'm.au_phone_invalid', 'm.au_pw_mismatch', 'm.au_cp_wrong_current', 'm.au_cp_done', 'm.au_password_changed']) {
          expect(d[k]?.trim(), isNotEmpty, reason: '$lang $k');
        }
      }
    });
    test('sign-up: 409 field errors become inline text for that field only; 422 details are localized per field', () {
      final t = strings('en');
      expect(registerFieldErrors(t, _err('CONFLICT', status: 409, details: {'field': 'username'})), {'username': 'That username is already taken.'});
      expect(registerFieldErrors(t, _err('CONFLICT', status: 409, details: {'field': 'phone'})), {'phone': 'An account with this mobile number already exists.'});
      expect(registerFieldErrors(t, _err('CONFLICT', status: 409, details: {'field': 'email'})).keys, ['email']);
      expect(registerFieldErrors(t, _err('CONFLICT', status: 409)), isEmpty, reason: 'no field: the general toast says it');
      final v = registerFieldErrors(t, _err('VALIDATION', status: 422, details: {'field': 'vehicleTemperature', 'vehicleTemperature': 'Required for this vehicle'}));
      expect(v, {'vehicleTemperature': 'Please check this field.'}, reason: 'raw server text is never shown');
      expect(registerFieldErrors(t, _err('VALIDATION', status: 422, details: {'username': 'Too short'})).keys, ['username']);
      expect(registerFieldErrors(t, _err('RATE_LIMITED', status: 429)), isEmpty);
      expect(registerFieldErrors(t, StateError('x')), isEmpty);
    });
  });

  group('router redirects', () {
    const driver = AuthState(user: {'role': 'driver', 'name': 'Omar'});
    const temp = AuthState(user: {'role': 'driver', 'mustChangePassword': true});
    String? go(AuthState? a, String loc, {bool loading = false}) => authRedirect(loading: loading, auth: a, location: loc);
    test('signed out: only /login and /register are reachable', () {
      expect(go(const AuthState(), '/'), '/login');
      expect(go(const AuthState(), '/wallet'), '/login');
      expect(go(const AuthState(), '/change-password'), '/login');
      expect(go(null, '/jobs'), '/login');
      expect(go(const AuthState(), '/login'), isNull);
      expect(go(const AuthState(), '/register'), isNull);
      expect(go(const AuthState(expired: true), '/'), '/login');
    });
    test('signed in: public pages lead home, everything else is open (including the voluntary change-password page)', () {
      expect(go(driver, '/login'), '/');
      expect(go(driver, '/register'), '/');
      expect(go(driver, '/'), isNull);
      expect(go(driver, '/profile'), isNull);
      expect(go(driver, '/change-password'), isNull);
    });
    test('mustChangePassword locks every page except /change-password', () {
      for (final loc in ['/', '/jobs', '/wallet', '/profile', '/job/o1', '/login', '/register']) { expect(go(temp, loc), '/change-password', reason: loc); }
      expect(go(temp, '/change-password'), isNull);
      expect(temp.mustChangePassword, isTrue);
      expect(driver.mustChangePassword, isFalse);
    });
    test('while the session is being restored nothing redirects', () {
      expect(go(null, '/jobs', loading: true), isNull);
      expect(go(temp, '/', loading: true), isNull);
    });
  });

  group('DriverApi — auth request shapes', () {
    late _Adapter ad;
    DriverApi make(ResponseBody Function(RequestOptions) f) {
      ad = _Adapter(f);
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = ad;
      return DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio));
    }
    test('login, username availability, register and change-password hit the contract paths; no OTP endpoint is left', () async {
      final api = make((_) => _json(200, '{"available":true,"token":"t","user":{"role":"driver"},"ok":true}'));
      final r = await api.login('demo.driver', 'Demo#Pass2026');
      expect((ad.last!.method, ad.last!.path), ('POST', '/auth/login'));
      expect(ad.last!.data, {'username': 'demo.driver', 'password': 'Demo#Pass2026'});
      expect(r['token'], 't');
      await api.usernameAvailable('omar.test');
      expect((ad.last!.method, ad.last!.path), ('GET', '/auth/username-available'));
      expect(ad.last!.queryParameters, {'username': 'omar.test'});
      await api.register({'role': 'driver', 'username': 'omar.test', 'password': 'Secret#Pass2026'});
      expect((ad.last!.method, ad.last!.path), ('POST', '/auth/register'));
      expect(ad.last!.data, containsPair('username', 'omar.test'));
      expect(ad.last!.data, isNot(contains('registrationToken')));
      await api.changePassword('old', 'new');
      expect((ad.last!.method, ad.last!.path), ('POST', '/auth/change-password'));
      expect(ad.last!.data, {'currentPassword': 'old', 'newPassword': 'new'});
    });
    test('a 401 on /auth/login is a plain UNAUTHENTICATED error and never signs the app out', () async {
      var signedOut = 0;
      ad = _Adapter((_) => _json(401, '{"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials","details":{}}}'));
      final dio = Dio(BaseOptions(baseUrl: 'http://x/api/v1'))..httpClientAdapter = ad;
      final api = DriverApi(ApiClient(baseUrl: 'http://x', tokens: MemoryTokenStore(), dio: dio, onUnauthorized: () => signedOut++));
      await expectLater(api.login('a', 'b'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNAUTHENTICATED').having((e) => e.status, 'status', 401)));
      await expectLater(api.changePassword('a', 'b'), throwsA(isA<ApiException>().having((e) => e.isAuth, 'auth', true)));
      expect(signedOut, 0);
    });
    test('429 and 409 keep their codes and details', () async {
      final api = make((o) => o.path.endsWith('login') ? _json(429, '{"error":{"code":"RATE_LIMITED","message":"slow","details":{}}}') : _json(409, '{"error":{"code":"CONFLICT","message":"taken","details":{"field":"username"}}}'));
      await expectLater(api.login('a', 'b'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'RATE_LIMITED')));
      await expectLater(api.register({}), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CONFLICT').having((e) => e.details['field'], 'field', 'username')));
    });
  });
}
