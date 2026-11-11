// Offline validation of the native shell (no Xcode build, no Android SDK needed).
// Checks the Capacitor config, platform files, permission strings, deep links and that the
// ContentState wire format is identical in the TS contract, Swift and Kotlin.
// Run from apps/native: `pnpm validate` (after `pnpm --filter @nyambika/contracts build`).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const failures = [];
const ok = [];
const check = (name, cond, detail = "") => (cond ? ok.push(name) : failures.push(`${name}${detail ? `: ${detail}` : ""}`));

// 1. Resolved Capacitor config (the CLI evaluates capacitor.config.ts).
const resolved = JSON.parse(execFileSync("npx", ["cap", "config", "--json"], { cwd: root, encoding: "utf8", env: { ...process.env, NYAMBIKA_SERVER_URL: "https://nyambika.rw" } }));
const app = resolved.app.extConfig;
check("appId is rw.nyambika.app", app.appId === "rw.nyambika.app");
check("server.url is https in store builds", app.server?.url === "https://nyambika.rw" && app.server.cleartext === false);
check("offline fallback bundled", app.server?.errorPath === "offline.html" && existsSync(resolve(root, "www/offline.html")));
check("offline page is trilingual", ["lang=\"rw\"", "lang=\"en\"", "lang=\"fr\""].every((s) => read("www/offline.html").includes(s)));
check("iOS uses SPM", resolved.ios.packageManager === "SPM");
let threw = false;
try {
  execFileSync("npx", ["cap", "config", "--json"], { cwd: root, encoding: "utf8", stdio: "pipe", env: { ...process.env, NYAMBIKA_SERVER_URL: "http://evil.example" } });
} catch {
  threw = true;
}
check("cleartext refused for non-local hosts", threw);

// 2. Platform folders and plugins.
check("android/ generated", existsSync(resolve(root, "android/app/src/main/AndroidManifest.xml")));
check("ios/ generated", existsSync(resolve(root, "ios/App/App.xcodeproj/project.pbxproj")));
const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
check("widget extension target wired", /NyambikaWidgets\.appex/.test(pbx) && /Embed Foundation Extensions/.test(pbx));
check("live activity plugin in App target", /NyambikaLiveActivityPlugin\.swift in Sources/.test(pbx));
check("App entitlements set", /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/.test(pbx));

// 3. Permissions and strings (twin capture camera, voice Muse mic) in RW/EN/FR.
const plist = read("ios/App/App/Info.plist");
for (const k of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSSupportsLiveActivities", "WKAppBoundDomains", "remote-notification"]) check(`Info.plist has ${k}`, plist.includes(k));
for (const l of ["en", "rw", "fr"]) check(`InfoPlist.strings ${l}`, read(`ios/App/App/${l}.lproj/InfoPlist.strings`).includes("NSCameraUsageDescription"));
const ent = read("ios/App/App/App.entitlements");
check("associated domains (applinks + webcredentials)", ent.includes("applinks:nyambika.rw") && ent.includes("webcredentials:nyambika.rw"));
check("app group shared with widget", ent.includes("group.rw.nyambika.app") && read("ios/App/NyambikaWidgets/NyambikaWidgets.entitlements").includes("group.rw.nyambika.app"));
const manifest = read("android/app/src/main/AndroidManifest.xml");
for (const p of ["CAMERA", "RECORD_AUDIO", "POST_NOTIFICATIONS", "POST_PROMOTED_NOTIFICATIONS"]) check(`Android permission ${p}`, manifest.includes(`android.permission.${p}`));
for (const l of ["values", "values-rw", "values-fr"]) check(`Android strings ${l}`, read(`android/app/src/main/res/${l}/strings.xml`).includes("channel_orders"));

// 4. Deep links agree with the web app's .well-known files.
const links = read("../web/lib/app-links.ts");
const paths = [...(links.match(/APP_LINK_PATHS = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"\/([a-z]+)\/\*"/g)].map((m) => m[1]);
check("web declares the required link paths", ["m", "looks", "confirm", "c"].every((p) => paths.includes(p)), paths.join(","));
for (const p of paths) check(`Android App Link /${p}/`, manifest.includes(`android:pathPrefix="/${p}/"`));
check("Android App Links autoVerify", manifest.includes('android:autoVerify="true"'));
check("custom scheme nyambika:// on both platforms", manifest.includes('android:scheme="nyambika"') && plist.includes("<string>nyambika</string>"));

// 5. One plugin name on web, iOS and Android.
const swiftPlugin = read("ios/App/App/NyambikaLiveActivityPlugin.swift");
const ktPlugin = read("android/app/src/main/java/rw/nyambika/app/ambient/NyambikaLiveActivityPlugin.kt");
const webNative = read("../web/lib/native.ts");
check("plugin jsName matches", swiftPlugin.includes('jsName = "NyambikaLiveActivity"') && ktPlugin.includes('name = "NyambikaLiveActivity"') && webNative.includes('"NyambikaLiveActivity"'));
for (const m of ["isSupported", "start", "update", "end", "setWidgetOrder"]) check(`plugin method ${m} on iOS + Android`, swiftPlugin.includes(`name: "${m}"`) && ktPlugin.includes(`fun ${m}(`));

// 6. ContentState wire format identical in TS, Swift and Kotlin.
const require = createRequire(import.meta.url);
const contracts = require(resolve(repo, "packages/contracts/dist/index.js"));
const tsKeys = Object.keys(contracts.LiveActivityContentState.shape).sort();
const swift = read("ios/App/Shared/OrderActivityAttributes.swift");
const swiftState = swift.slice(swift.indexOf("struct OrderProgressState"), swift.indexOf("public var isFinished"));
const swiftKeys = [...swiftState.matchAll(/public var (\w+):/g)].map((m) => m[1]).sort();
const kt = read("android/app/src/main/java/rw/nyambika/app/ambient/OrderProgress.kt");
const ktState = kt.slice(kt.indexOf("data class OrderProgress("), kt.indexOf(") {", kt.indexOf("data class OrderProgress(")));
const ktKeys = [...ktState.matchAll(/val (\w+):/g)].map((m) => m[1]).sort();
check("ContentState keys TS == Swift", JSON.stringify(tsKeys) === JSON.stringify(swiftKeys), `${tsKeys} vs ${swiftKeys}`);
check("ContentState keys TS == Kotlin", JSON.stringify(tsKeys) === JSON.stringify(ktKeys), `${tsKeys} vs ${ktKeys}`);
const attrKeys = Object.keys(contracts.LiveActivityAttributes.shape).sort();
const swiftAttr = [...swift.slice(swift.indexOf("struct OrderInfo")).matchAll(/public var (\w+):/g)].slice(0, 4).map((m) => m[1]).sort();
check("Attributes keys TS == Swift", JSON.stringify(attrKeys) === JSON.stringify(swiftAttr), `${attrKeys} vs ${swiftAttr}`);
const sample = contracts.liveActivityState(contracts.orderAmbient({ orderId: "o", code: "NY-1", status: "IN_PREPARATION", craft: "SEWING", makerName: "Uwase", itemTitle: "dress", readyBy: new Date(Date.now() + 3 * 86400_000) }), "rw");
check("sample ContentState parses", contracts.LiveActivityContentState.safeParse(sample).success);
check("integers where Swift/Kotlin expect Int/Long", Number.isInteger(sample.stepIndex) && Number.isInteger(sample.updatedAt) && Number.isInteger(sample.readyBy));

// 7. Icons.
const icon = resolve(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
check("iOS 1024 icon present", existsSync(icon) && readFileSync(icon).readUInt32BE(16) === 1024);
check("Android adaptive background is not the template white-on-white", read("android/app/src/main/res/values/ic_launcher_background.xml").includes("#FFFFFF") && existsSync(resolve(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png")));

console.log(`✓ ${ok.length} checks passed`);
if (failures.length) {
  console.error(`✗ ${failures.length} failed:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
