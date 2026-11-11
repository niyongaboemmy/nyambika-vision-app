"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { installationId, installNativeShims, isNative, liveActivityPlugin, plugin, setStatusBar, themeForPath } from "@/lib/native";
import { syncPush } from "@/lib/push";
import { useSession } from "@/lib/session";

type Listener = { remove: () => Promise<void> | void };
type AddListener = (event: string, cb: (d: Record<string, unknown>) => void) => Promise<Listener>;

/** In-app paths we accept from deep links, universal/app links and notification taps. */
export function safeAppPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://nyambika.rw");
    if (!/^(https?:|nyambika:)$/.test(u.protocol)) return null;
    // nyambika://m/uwase → host "m", path "/uwase"
    const path = u.protocol === "nyambika:" ? `/${u.host}${u.pathname}` : u.pathname;
    if (!/^\/(m|looks|confirm|c|orders|custom|circle|wardrobe|trust|saved)(\/|$)/.test(path)) return null;
    return `${path}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Mounted once in the root layout. On the web it does nothing. Inside the Capacitor shell it wires
 * status-bar theming, deep links, notification taps, live-activity tokens and the share/vibrate shims.
 */
export function NativeBridge() {
  const router = useRouter();
  const path = usePathname();
  const { me, locale } = useSession();

  useEffect(() => {
    if (!isNative()) return;
    installNativeShims();
    const subs: Promise<Listener>[] = [];
    const app = plugin<{ addListener: AddListener }>("App");
    if (app) {
      subs.push(app.addListener("appUrlOpen", (d) => {
        const p = safeAppPath(d.url as string);
        if (p) router.push(p);
      }));
      subs.push(app.addListener("backButton", (d) => {
        if (d.canGoBack) window.history.back();
      }));
    }
    const push = plugin<{ addListener: AddListener }>("PushNotifications");
    if (push) {
      subs.push(push.addListener("pushNotificationActionPerformed", (d) => {
        const n = d.notification as { data?: { url?: string } } | undefined;
        const p = safeAppPath(n?.data?.url);
        if (p) router.push(p);
      }));
    }
    void plugin<{ hide: () => Promise<void> }>("SplashScreen")?.hide().catch(() => undefined);
    return () => {
      for (const s of subs) void s.then((l) => l.remove());
    };
  }, [router]);

  useEffect(() => {
    if (isNative()) setStatusBar(themeForPath(path));
  }, [path]);

  // Signed in inside the app: refresh the push token and report live-activity tokens to the API.
  useEffect(() => {
    if (!me) return;
    void syncPush(locale);
    const la = liveActivityPlugin() as (ReturnType<typeof liveActivityPlugin> & { addListener?: AddListener }) | null;
    if (!la?.addListener) return;
    const reg = (kind: "LIVE_ACTIVITY" | "LIVE_ACTIVITY_START") => (d: Record<string, unknown>) =>
      void api("/push/devices", {
        method: "POST",
        json: { installationId: installationId(), platform: "IOS", transport: "APNS", kind, token: d.token, ...(d.orderId ? { orderId: d.orderId } : {}), locale },
      }).catch(() => undefined);
    const subs = [la.addListener("activityToken", reg("LIVE_ACTIVITY")), la.addListener("pushToStartToken", reg("LIVE_ACTIVITY_START"))];
    return () => {
      for (const s of subs) void s.then((l) => l.remove());
    };
  }, [me, locale]);

  return null;
}
