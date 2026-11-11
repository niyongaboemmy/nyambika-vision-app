# Native release guide (E38: iOS + Android shell)

The app is a Capacitor 8.5.3 shell (`apps/native`, app id **`rw.nyambika.app`**) around the production PWA (ADR-03, ADR-0008). This guide covers signing, store privacy declarations mapped to our consent purposes, review notes and build commands. Engineering details: `apps/native/README.md`.

> Status: the projects are generated and validated offline, but **neither app has been compiled or run yet** (no Android SDK, no working `xcodebuild` on the authoring machine). The first build in Xcode / Android Studio is part of the release checklist below.

## 1. Accounts, identifiers and secrets

| Item | iOS | Android |
|---|---|---|
| Bundle / application id | `rw.nyambika.app`; widget extension `rw.nyambika.app.widgets` | `rw.nyambika.app` |
| Capabilities | Push Notifications, Associated Domains (`applinks:` + `webcredentials:` for nyambika.rw, www, staging), App Groups (`group.rw.nyambika.app`), Background Modes → Remote notifications. Widget extension: App Groups. | FCM project; Play App Signing |
| Push credentials (API env) | APNs **token key** (.p8): `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_TOPIC=rw.nyambika.app`, `APNS_ENV=production` (sandbox for TestFlight-from-Xcode debug builds). One key covers alerts and Live Activities. | `FCM_SERVICE_ACCOUNT_JSON` (service account with `firebase.messaging` scope); `google-services.json` in `android/app/` (not committed) |
| Web Push (PWA) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate once with `npx web-push generate-vapid-keys`; rotating them invalidates every browser subscription). | same |
| Link verification (web env) | `APPLE_TEAM_ID` → `/.well-known/apple-app-site-association` | `ANDROID_CERT_SHA256` (comma separated: Play app-signing **and** upload key) → `/.well-known/assetlinks.json` |
| Signing | Automatic signing, distribution certificate + App Store profile for both targets | Upload keystore in the team vault; Play App Signing holds the app key |

`PUSH_PROVIDER=live` is the production default. Without credentials the API logs a warning and pushes go to the outbox only, so a missing secret never breaks ordering.

## 2. Build and run

```bash
pnpm install && pnpm --filter @nyambika/contracts build
cd apps/native
NYAMBIKA_SERVER_URL=https://nyambika.rw pnpm sync
python3 scripts/ios-plist.py && ruby scripts/ios-targets.rb
pnpm validate && ./scripts/swift-check.sh && npx cap doctor

# iOS
pnpm open:ios            # set the team on App + NyambikaWidgets, set aps-environment via Xcode (Release → production)
# Product → Archive → Distribute (TestFlight)

# Android
cp ~/secrets/google-services.json android/app/
pnpm open:android        # or: cd android && ./gradlew bundleRelease
```

Bump `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` (both iOS targets) and `versionCode`/`versionName` (`android/app/build.gradle`) per release. The app's UI updates with every web deploy; a store release is only needed for native changes (plugins, widgets, permissions, icons).

### First-build checklist (not yet done)
- [ ] Xcode resolves SPM (`capacitor-swift-pm` 8.5.3) and builds **App** + **NyambikaWidgets**; widget appears in the gallery; Live Activity starts from an order page and updates from an APNs `liveactivity` push.
- [ ] Android Studio syncs Gradle (Kotlin 2.2.21, Compose compiler, Glance 1.1.1, firebase-messaging 25.0.1) and builds; Live Update shows on an Android 16 device, ongoing progress notification on Android 13; widget renders.
- [ ] Universal link / App Link from WhatsApp opens `/m/<handle>`, `/looks/<id>`, `/confirm/<token>`, `/c/<token>` inside the app (`adb shell pm get-app-links rw.nyambika.app`).
- [ ] Passkey sign-in works inside WKWebView (needs the `webcredentials` association) and Android WebView.
- [ ] Camera (twin capture, product photos) and microphone (voice Muse) prompts show the localised strings in RW/EN/FR.
- [ ] Replace the 390×362 logo with a vector / 1024 px master and re-run `pnpm icons` (the current icons are upscaled).

## 3. Privacy declarations, mapped to our consent purposes

The shell itself collects nothing beyond the web app; it adds push tokens and an installation id. Firebase Analytics collection and advertising id are disabled in the manifest; **no tracking, no ads SDKs, no cross-app tracking (ATT prompt not needed)**.

| Data (store category) | Why | Consent / control in the product | Linked to user | iOS label | Play data safety |
|---|---|---|---|---|---|
| Phone number (contact info) | Sign-in OTP, order updates on WhatsApp/SMS | Account; deletion in trust centre | Yes | Contact Info → App Functionality | Personal info → Phone number, required |
| Name, delivery address (contact info) | Fulfilment by the maker (OP-5: only what the order needs) | Per order; saved addresses deletable | Yes | Contact Info → App Functionality | Personal info → Name, Address |
| Photos (twin, product photos) | Private twin and AI try-on | `TWIN_PROCESSING`, `TRYON_GENERATION`; encrypted at rest, never shared with makers | Yes | User Content → Photos, App Functionality | Photos, optional, encrypted in transit |
| 3D twin | 3D try-on / AR mirror | `AVATAR_3D` | Yes | User Content → Other | Photos & videos → other, optional |
| Audio (voice Muse) | Speech to text, **deleted immediately, never stored** | `VOICE_PROCESSING` | Not stored | Audio Data → App Functionality (not retained) | Audio → Voice, processed ephemerally |
| Body measurements | Tailor orders; time-limited share with one tailor | Measurement profile + share consents | Yes | User Content → Other (garment sizes, not health data) | Personal info → Other |
| Purchase history | Orders paid directly to makers | Retained for accounting, pseudonymised on deletion | Yes | Purchases → App Functionality | Financial info → Purchase history |
| Device push token + installation id (identifiers) | Notifications only | Trust centre → Notifications (per category + live activity), removed on sign-out and deletion, never exported raw | Yes | Identifiers → Device ID, App Functionality | Device or other IDs, required for push |
| Marketing messages | Maker broadcasts | `MARKETING` / per-maker opt-in | Yes | Contact Info → App Functionality (opt-in maker updates on WhatsApp, not developer advertising) | Not used for advertising |
| Crash/diagnostics | Not collected by the shell | — | — | None | None |

Data is encrypted in transit (TLS; App-Bound Domains on iOS, cleartext refused). Users can request deletion in-app (trust centre → Delete my account) which also deletes push devices and notification settings.

## 4. App Review / Play review notes (paste into the submission)

- **Not a thin wrapper (Guideline 4.2):** native push notifications, a lock-screen **Live Activity** and Dynamic Island for orders, a home-screen **widget**, native share sheet, haptics, camera capture for the private twin, deep links into Maker Spaces, polls and agent confirmations.
- **AI-generated images:** every try-on look is labelled "AI preview" on the image and carries **C2PA Content Credentials** (signed manifest; ADR-10). Looks are rendered only on the shopper's own photo-twin (or synthetic models), are private to the shopper and never shared with makers. Guardrails withhold images that fail identity/quality checks. No generation of other real people.
- **Payments:** physical goods. Mobile Money payments go **directly to the maker's merchant account** (MTN MoMo / Airtel, M-Pesa in Kenya); Stripe export checkout uses the maker's own connected account. No digital goods are sold in the app, so IAP does not apply. Page plans for makers are purchased on the web.
- **Demo account:** provide a staging shopper phone and the dev OTP flow on `staging.nyambika.rw` (OTP shown on screen only in staging); the simulated handset at `/dev/handset` approves Mobile Money prompts.
- **Permissions:** camera and microphone are requested only when the shopper starts twin capture / holds the mic; notifications only after "Tell me when it's paid" or in the trust centre.
- **Kinyarwanda** is the first language; RW/FR copy is pending native-speaker review.

## 5. Operations

- Token hygiene: providers report `Unregistered`/`410`/`BadDeviceToken` → the device row is revoked automatically; failures are counted on `PushDevice.failures`.
- Every push (dev or live) writes an outbox row (`Notification`, channel `PUSH`, no raw tokens) for audit and support.
- Kill switch: set `PUSH_PROVIDER=dev` to stop all native/web delivery instantly (WhatsApp/SMS keep working).
