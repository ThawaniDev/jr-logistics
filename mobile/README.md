# JR Driver — Flutter app

Driver-facing Android/iOS app. Talks only to the Next.js API (`../web`) — no separate source of truth. UI state is **server-driven** (`actions` on each job), so the web portal and the app can never disagree about the next step.
Brand tokens (`lib/core/theme.dart`) match the web design tokens; strings come from the web dictionaries (`assets/i18n/*.json`, exported by `npm run i18n:export`), Arabic RTL / English / Urdu RTL.

**Features:** phone-OTP sign-in & registration · online/offline with explicit location consent · offers & open requests with terms · one-clear-next-step job screen (check-in, confirm loaded, report delivered with big stepper) · WhatsApp **hand-off** (prefilled localized message; we never send or read replies) · "can't reach recipient" exception · multi-stop **route planning** (Google Routes via server when configured, otherwise a clearly labelled estimate; the driver reviews the order before navigation) · in-app chat · earnings, withdrawals · documents (camera/gallery) · notifications.

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000       # Android emulator default: http://10.0.2.2:3000
flutter analyze && flutter test                                    # 38 unit + widget tests
./tool/live_test.sh                                                # spins up the real server + test DB, runs 6 live API tests
./tool/live_test.sh --e2e                                          # + full journey on the iOS simulator (DEVICE="iPhone 17 Pro")
```
Release builds require HTTPS (cleartext is only allowed in the Android debug manifest). Store listing, signing, push notifications and offline mode are not part of this version (see `../memory/DECISIONS.md` #15).
