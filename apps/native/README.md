# Nyambika native shell (E38)

Capacitor 8.5.3 app (`rw.nyambika.app`) for iOS and Android around the deployed PWA (ADR-03 "PWA first, native shell in R3", ADR-0008). The web app is the only UI: the shell loads `NYAMBIKA_SERVER_URL`, and web code talks to native features through `apps/web/lib/native.ts` (bridge detection, haptics, share, status bar, live activity plugin). No screen is forked.

| What | Where |
|---|---|
| Config (server URL, offline page, splash, status bar, push) | `capacitor.config.ts` |
| Offline fallback (RW/EN/FR, bundled) | `www/offline.html` (+ `www/config.js` from `scripts/prepare-www.mjs`) |
| Icons + splash from `docs/nyambika_icon.png` | `scripts/icons.mjs` |
| iOS Info.plist keys, permission strings RW/EN/FR, entitlements | `scripts/ios-plist.py` → `ios/App/App/{Info.plist,*.lproj/InfoPlist.strings,App.entitlements}` |
| Xcode targets (plugin files, widget extension, embed phase) | `scripts/ios-targets.rb` (xcodeproj gem, idempotent) |
| iOS Live Activity plugin + bridge VC | `ios/App/App/NyambikaLiveActivityPlugin.swift`, `NyambikaBridgeViewController.swift`, `AppDelegate.swift` (APNs token + silent widget refresh) |
| Shared wire model (= `LiveActivityContentState` in `packages/contracts/src/ambient.ts`) | `ios/App/Shared/OrderActivityAttributes.swift`, `WidgetOrderStore.swift` |
| WidgetKit extension: lock-screen Live Activity + Dynamic Island, "Today's look / order" widget | `ios/App/NyambikaWidgets/*` (iOS 17+) |
| Android ongoing notification / Android 16 Live Update | `android/app/src/main/java/rw/nyambika/app/ambient/OrderNotifier.kt` |
| Android FCM data messages → Live Update + widget | `ambient/NyambikaMessagingService.kt` (extends the push plugin's service) |
| Android Glance widget | `widget/TodayWidget.kt`, `res/xml/nyambika_widget_info.xml` |
| Android plugin with the same JS API as iOS | `ambient/NyambikaLiveActivityPlugin.kt`, registered in `MainActivity.java` |
| Deep links / App Links / universal links | `AndroidManifest.xml`, `App.entitlements`; served files: `apps/web/app/.well-known/*` |

## How the ambient moment flows

1. Shopper holds to buy; while the MoMo PIN is pending the order page asks once: "Tell me when it's paid" (`components/push-ask.tsx`). Never on load.
2. The API's order lifecycle (`PushService.orderUpdate`) computes one `AmbientOrderState` (contracts) and fans it out per device:
   - Web Push (VAPID) → `public/sw.js` shows a tagged notification that updates in place;
   - Android FCM data message → `NyambikaMessagingService` updates the ongoing Live Update and the widget;
   - iOS APNs alert / background push, and `liveactivity` pushes to the activity's own token (start via push-to-start on iOS 17.2+, then update, then end with a 4 h dismissal).
3. The web order page renders the same state (`components/ambient-order.tsx`) and, inside the app, starts/updates the Live Activity and widget directly through the plugin.

## Commands

```bash
pnpm install                                   # from the repo root (apps/native is a workspace package)
pnpm --filter @nyambika/contracts build
cd apps/native
NYAMBIKA_SERVER_URL=https://nyambika.rw pnpm sync   # writes www/config.js, then `cap sync`
python3 scripts/ios-plist.py && ruby scripts/ios-targets.rb   # re-run after `cap add ios` / template changes
pnpm icons                                     # regenerate icons + splash
pnpm validate                                  # 50+ offline checks (config, permissions, links, wire format)
./scripts/swift-check.sh                       # swiftc typecheck of all Swift (no Xcode build needed)
npx cap doctor
pnpm open:ios      # Xcode: select team, build NyambikaWidgets + App
pnpm open:android  # Android Studio: add google-services.json, build
```

Local device testing against `next dev`: `NYAMBIKA_SERVER_URL=http://10.0.2.2:3101 pnpm sync` (Android emulator) or `http://localhost:3101` (iOS simulator). Cleartext is refused for any non-local host.

## What was verified here, and what was not

Verified on the authoring machine (no Android SDK, `xcodebuild` broken by a system framework mismatch):
- `npx cap add ios|android`, `npx cap sync`, `npx cap doctor` (both platforms "looking great"), `cap config` resolution;
- `scripts/validate.mjs` (config, plist/entitlements, permission strings RW/EN/FR, App Links ⇔ `.well-known`, plugin names/methods on iOS + Android + web, ContentState keys TS = Swift = Kotlin);
- `scripts/swift-check.sh`: the widget extension typechecks against the real iOS 26.5 simulator SDK (WidgetKit/ActivityKit/SwiftUI); the app target typechecks against the real SDK plus a Capacitor **signature stub** copied from Capacitor 8.5.3.

**Not compiled:** the Xcode project was never built or run (SPM resolution, linking, signing, the widget extension's embedding), and **none of the Kotlin/Gradle code has been compiled** (Kotlin 2.2.21, Compose compiler plugin, Glance 1.1.1, Android 16 `Notification.ProgressStyle` / `setRequestPromotedOngoing` / `setShortCriticalText`). Expect small fixes on the first Android Studio / Xcode build. No push has been delivered to a real device (APNs/FCM adapters are mock-tested only).
