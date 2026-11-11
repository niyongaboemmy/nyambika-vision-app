"use client";

import { api } from "./api";
import { installationId, isNative, nativePlatform, plugin } from "./native";

/**
 * Push opt-in for the PWA (Web Push + VAPID) and the native shell (FCM via Capacitor).
 * We only ever ask at a meaningful moment ("Tell me when it's paid", the trust centre), never on load.
 */
export type PushState = "unsupported" | "default" | "denied" | "on";

interface PushPlugin {
  checkPermissions: () => Promise<{ receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  unregister?: () => Promise<void>;
  addListener: (event: string, cb: (data: { value?: string; error?: string }) => void) => Promise<{ remove: () => Promise<void> }>;
  createChannel?: (c: { id: string; name: string; importance: number; description?: string }) => Promise<void>;
}

const ON_KEY = "nya_push_on";
const flag = {
  get: () => {
    try {
      return localStorage.getItem(ON_KEY) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(ON_KEY, "1");
      else localStorage.removeItem(ON_KEY);
    } catch {}
  },
};

const pushPlugin = () => plugin<PushPlugin>("PushNotifications");

function webSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const p = pushPlugin();
  if (isNative() && p) {
    const { receive } = await p.checkPermissions();
    if (receive === "denied") return "denied";
    return receive === "granted" && flag.get() ? "on" : "default";
  }
  if (!webSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && flag.get() ? "on" : "default";
}

function b64ToBytes(b64url: string) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registerSw() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Ask for permission (must run from a user gesture) and register this device. */
export async function enablePush(locale?: string): Promise<PushState> {
  const p = pushPlugin();
  if (isNative() && p) {
    const perm = await p.requestPermissions();
    if (perm.receive !== "granted") return perm.receive === "denied" ? "denied" : "default";
    await p.createChannel?.({ id: "orders", name: "Order progress", importance: 3, description: "Live order updates" }).catch(() => undefined);
    await p.createChannel?.({ id: "general", name: "Nyambika", importance: 4 }).catch(() => undefined);
    const token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No push token from the system")), 15_000);
      void p.addListener("registration", (t) => {
        clearTimeout(timer);
        resolve(t.value ?? "");
      });
      void p.addListener("registrationError", (e) => {
        clearTimeout(timer);
        reject(new Error(e.error ?? "Push registration failed"));
      });
      void p.register();
    });
    await api("/push/devices", {
      method: "POST",
      // iOS: the plugin hands back the raw APNs token (no Firebase SDK on iOS); Android: an FCM token.
      json: nativePlatform() === "ios"
        ? { installationId: installationId(), platform: "IOS", transport: "APNS", token, locale }
        : { installationId: installationId(), platform: "ANDROID", transport: "FCM", token, locale },
    });
    flag.set(true);
    return "on";
  }

  if (!webSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "default";
  const reg = await registerSw();
  const { publicKey } = await api<{ publicKey: string }>("/push/vapid");
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
  await api("/push/devices", {
    method: "POST",
    json: { installationId: installationId(), platform: "WEB", transport: "WEBPUSH", token: json.endpoint, keys: json.keys, locale },
  });
  flag.set(true);
  return "on";
}

/** Re-send the current token after sign-in or a token rotation (no prompt). */
export async function syncPush(locale?: string) {
  if (!flag.get()) return;
  try {
    if ((await pushState()) === "on") await enablePush(locale);
  } catch {}
}

/** Sign-out: this device stops receiving the previous user's notifications. */
export async function revokePushForSignOut() {
  flag.set(false);
  // Always ask the server: tokens may have been registered by an older install of the app.
  await api("/push/devices/revoke", { method: "POST", json: { installationId: installationId() } }).catch(() => undefined);
  try {
    if (!isNative() && webSupported()) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    }
  } catch {}
}
