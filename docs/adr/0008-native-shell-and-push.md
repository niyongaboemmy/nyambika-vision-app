# ADR-0008: Native shell, push transports and one ambient state model

- Status: Accepted for R3 (E38). Refines SRS ADR-03 "PWA first, native shell in R3".

## Decision
- **Capacitor 8 remote-URL shell** (`apps/native`, `rw.nyambika.app`) that loads the deployed PWA; only an offline page is bundled. The web app stays the single UI; native features are reached through `window.Capacitor.Plugins` from `apps/web/lib/native.ts` (no Capacitor npm dependency in the web app, no forked screens). Small shims make existing screens work unchanged (`navigator.share` on Android WebView, `navigator.vibrate` on iOS).
- **Push transports per platform**, behind one `PushProvider` interface in the messaging layer next to the WhatsApp/SMS outbox: Web Push with VAPID (PWA), FCM HTTP v1 (Android, data-only for order updates so the app renders the Live Update), **APNs directly with a .p8 token key** for iOS (alerts and ActivityKit `liveactivity` pushes). No Firebase SDK ships on iOS. A dev adapter writes every push to the outbox; `PUSH_PROVIDER=live` turns real delivery on.
- **One ambient state model** (`packages/contracts/src/ambient.ts`): `orderAmbient()` derives four visible steps, a fine-grained progress and a phase from the order status (custom orders add the craft stage: cutting/sewing/fitting/finishing). The API ships it localised (RW/EN/FR) as `LiveActivityContentState`; Swift (`OrderProgressState`) and Kotlin (`OrderProgress`) mirror it field for field (checked by `apps/native/scripts/validate.mjs`). The web order timeline renders the same state.
- **Ask at the moment, never on load:** the permission prompt is tied to "Tell me when it's paid" while the MoMo PIN is pending, or the trust centre.
- **Preferences per category** (orders, looks, circle, custom quotes, wardrobe reminders, live activity) in `NotificationPreference`; device tokens in `PushDevice`, bound to an installation id, moved to the latest user on shared phones, revoked on sign-out, deleted on account deletion, exported without raw tokens.

## Consequences
- Store builds are needed only for native changes; UI ships with web deploys. Apple 4.2 risk is mitigated by real native value (push, Live Activities, widgets, share, haptics, camera).
- Two native codebases exist only for the ambient surfaces (Swift WidgetKit/ActivityKit, Kotlin Glance/Live Update); they contain no order logic.
- The iOS Live Activity needs an App Group and a widget extension target; `scripts/ios-targets.rb` wires them reproducibly.
- Not yet compiled end-to-end (see `docs/native-release.md` first-build checklist).
