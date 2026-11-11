"use client";

/**
 * Native shell bridge (E38, ADR-03 "PWA first, native shell in R3").
 *
 * The Capacitor app in `apps/native` loads this same web app from the server; Capacitor injects
 * `window.Capacitor` (with `Plugins`) into the page, so the web app never bundles Capacitor and never
 * forks a screen. Everything here degrades to the web API when the bridge is absent.
 */

type Listener = { remove: () => Promise<void> | void };
interface Plugin {
  addListener?: (event: string, cb: (data: never) => void) => Promise<Listener> | Listener;
  [method: string]: unknown;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => "ios" | "android" | "web";
  Plugins?: Record<string, Plugin | undefined>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export type NativePlatform = "ios" | "android" | "web";

export function cap(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const c = window.Capacitor;
  return c?.isNativePlatform?.() ? c : null;
}

export function isNative(): boolean {
  return cap() !== null;
}

export function nativePlatform(): NativePlatform {
  return cap()?.getPlatform?.() ?? "web";
}

/** A Capacitor plugin by name, only when running inside the app. */
export function plugin<T = Plugin>(name: string): T | null {
  return (cap()?.Plugins?.[name] as T | undefined) ?? null;
}

/** Stable per-install id: ties push tokens to this device so sign-out can revoke exactly them. */
export function installationId(): string {
  const KEY = "nya_installation";
  try {
    let v = localStorage.getItem(KEY);
    if (!v || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      v = `${nativePlatform()}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return "ephemeral_install";
  }
}

// ── haptics ──────────────────────────────────────────────────────────────────

type HapticKind = "light" | "medium" | "heavy" | "success" | "warning" | "error";
interface HapticsPlugin {
  impact: (o: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void>;
  notification: (o: { type: "SUCCESS" | "WARNING" | "ERROR" }) => Promise<void>;
}

/** Native Taptic/vibration engine in the app, `navigator.vibrate` on the web. Respects reduced motion. */
export function haptic(kind: HapticKind = "light") {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && kind !== "success" && kind !== "error") return;
  const h = plugin<HapticsPlugin>("Haptics");
  if (h) {
    const p = kind === "success" || kind === "warning" || kind === "error" ? h.notification({ type: kind.toUpperCase() as "SUCCESS" }) : h.impact({ style: kind.toUpperCase() as "LIGHT" });
    void p.catch(() => undefined);
    return;
  }
  const pattern = { light: 10, medium: 20, heavy: 35, success: [12, 60, 24], warning: [30, 50, 30], error: [40, 40, 40, 40] }[kind];
  navigator.vibrate?.(pattern);
}

// ── share ────────────────────────────────────────────────────────────────────

interface SharePlugin {
  share: (o: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }) => Promise<unknown>;
  canShare?: () => Promise<{ value: boolean }>;
}

/** Native share sheet in the app (Android WebView has no Web Share), Web Share otherwise. */
export async function share(data: { title?: string; text?: string; url?: string }): Promise<boolean> {
  const s = plugin<SharePlugin>("Share");
  try {
    if (s) {
      await s.share({ ...data, dialogTitle: data.title });
      return true;
    }
    if (navigator.share) {
      await navigator.share(data);
      return true;
    }
  } catch {
    return false; // dismissed
  }
  return false;
}

// ── status bar ───────────────────────────────────────────────────────────────

interface StatusBarPlugin {
  setStyle: (o: { style: "DARK" | "LIGHT" | "DEFAULT" }) => Promise<void>;
  setBackgroundColor?: (o: { color: string }) => Promise<void>;
}

/** Dark aurora for shopper screens, light warm studio for makers (design language §4). */
export function themeForPath(path: string): "dark" | "light" {
  return /^\/(studio|admin)(\/|$)/.test(path) ? "light" : "dark";
}

export function setStatusBar(theme: "dark" | "light") {
  const sb = plugin<StatusBarPlugin>("StatusBar");
  if (!sb) return;
  // Capacitor's Style.Dark = light text for dark backgrounds.
  void sb.setStyle({ style: theme === "dark" ? "DARK" : "LIGHT" }).catch(() => undefined);
  if (nativePlatform() === "android") void sb.setBackgroundColor?.({ color: theme === "dark" ? "#0B0A0F" : "#FFF8F1" })?.catch(() => undefined);
}

/**
 * Small shims so existing screens work unchanged inside the app: `navigator.share` (missing in
 * Android WebView) and `navigator.vibrate` (missing on iOS) route to the native plugins.
 */
export function installNativeShims() {
  if (!isNative() || typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { __nyaShim?: boolean };
  if (nav.__nyaShim) return;
  nav.__nyaShim = true;
  if (plugin("Share")) {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => {
        const ok = await share({ title: d.title, text: d.text, url: d.url });
        if (!ok) throw new DOMException("Share dismissed", "AbortError");
      },
    });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d?: ShareData) => !d?.files?.length });
  }
  // Android WebView already has a working navigator.vibrate; iOS WKWebView has none.
  if (plugin("Haptics") && nativePlatform() === "ios") {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (p: number | number[]) => {
        const ms = Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p;
        haptic(ms >= 60 ? "success" : ms >= 25 ? "heavy" : ms >= 15 ? "medium" : "light");
        return true;
      },
    });
  }
}

// ── live activity (iOS) / ongoing notification (Android) ─────────────────────

interface LiveActivityPlugin {
  isSupported: () => Promise<{ supported: boolean; pushToStart?: boolean }>;
  start: (o: { attributes: object; state: object }) => Promise<{ activityId: string }>;
  update: (o: { orderId: string; state: object }) => Promise<void>;
  end: (o: { orderId: string; state: object }) => Promise<void>;
  /** Mirrors the latest order to the home-screen widget (App Group / Glance state). */
  setWidgetOrder?: (o: { attributes: object; state: object } | { clear: true }) => Promise<void>;
}

export function liveActivityPlugin(): LiveActivityPlugin | null {
  return plugin<LiveActivityPlugin>("NyambikaLiveActivity");
}
