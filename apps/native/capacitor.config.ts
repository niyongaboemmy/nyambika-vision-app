import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Nyambika native shell (E38, ADR-03). The app loads the deployed PWA; the web app stays the
 * single source of UI. Only the offline fallback page is bundled (`www/offline.html`).
 *
 *   NYAMBIKA_SERVER_URL=https://nyambika.rw            production / store builds (default)
 *   NYAMBIKA_SERVER_URL=https://staging.nyambika.rw    staging
 *   NYAMBIKA_SERVER_URL=http://10.0.2.2:3101           Android emulator → local `next dev`
 *   NYAMBIKA_SERVER_URL=http://localhost:3101          iOS simulator → local `next dev`
 */
export const SERVER_URL = (process.env.NYAMBIKA_SERVER_URL ?? "https://nyambika.rw").replace(/\/$/, "");
const server = new URL(SERVER_URL);
const cleartext = server.protocol === "http:";
if (cleartext && !/^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)$/.test(server.hostname)) {
  throw new Error(`Refusing cleartext NYAMBIKA_SERVER_URL for a non-local host: ${SERVER_URL}`);
}

const config: CapacitorConfig = {
  appId: "rw.nyambika.app",
  appName: "Nyambika",
  webDir: "www",
  loggingBehavior: "debug",
  server: {
    url: SERVER_URL,
    cleartext,
    // Same-site navigation stays in the app; everything else (WhatsApp, maps, MoMo help) opens outside.
    allowNavigation: [server.host],
    errorPath: "offline.html",
    androidScheme: "https",
  },
  ios: {
    scheme: "Nyambika",
    contentInset: "never",
    backgroundColor: "#0B0A0F",
    // App-Bound Domains: WKWebView only runs JS/cookies for the domains in WKAppBoundDomains (Info.plist).
    limitsNavigationsToAppBoundDomains: !cleartext,
    preferredContentMode: "mobile",
    handleApplicationNotifications: true,
  },
  android: {
    backgroundColor: "#0B0A0F",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: cleartext,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#0B0A0F",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    PushNotifications: {
      // Foreground: show the banner; the web app also updates the ambient card live.
      presentationOptions: ["badge", "sound", "alert"],
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0B0A0F",
      overlaysWebView: true,
    },
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
