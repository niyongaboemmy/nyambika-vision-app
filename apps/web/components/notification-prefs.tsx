"use client";

import type { NotificationPrefs } from "@nyambika/contracts";
import type { MessageKey } from "@nyambika/i18n";
import { useEffect, useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { installationId, isNative } from "@/lib/native";
import { enablePush, pushState, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Device {
  id: string;
  platform: "IOS" | "ANDROID" | "WEB";
  appVersion: string | null;
  lastSeenAt: string;
  installationId: string;
}
interface Status {
  prefs: NotificationPrefs;
  devices: Device[];
}

const ROWS: { key: keyof NotificationPrefs; title: MessageKey; body: MessageKey; appOnly?: boolean }[] = [
  { key: "orders", title: "push.orders", body: "push.ordersBody" },
  { key: "liveActivity", title: "push.liveActivity", body: "push.liveActivityBody", appOnly: true },
  { key: "looks", title: "push.looks", body: "push.looksBody" },
  { key: "custom", title: "push.custom", body: "push.customBody" },
  { key: "circle", title: "push.circle", body: "push.circleBody" },
  { key: "wardrobe", title: "push.wardrobe", body: "push.wardrobeBody" },
];
const DEVICE_LABEL = { IOS: "📱 iPhone app", ANDROID: "📱 Android app", WEB: "🌐 Browser" } as const;

/** Trust centre card: what may ping me, and which devices can (E38). */
export function NotificationPrefsCard() {
  const { t, locale } = useSession();
  const { data, setData, error, reload } = useApi<Status>("/push");
  const [state, setState] = useState<PushState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const here = typeof window === "undefined" ? "" : installationId();

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function toggle(key: keyof NotificationPrefs, on: boolean) {
    setData((d) => (d ? { ...d, prefs: { ...d.prefs, [key]: on } } : d));
    try {
      const r = await api<{ prefs: NotificationPrefs }>("/push/prefs", { method: "PUT", json: { [key]: on } });
      setData((d) => (d ? { ...d, prefs: r.prefs } : d));
    } catch (e) {
      setErr((e as Error).message);
      void reload();
    }
  }

  async function turnOn() {
    setErr(null);
    try {
      setState(await enablePush(locale));
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function test() {
    const r = await api<{ sent: number }>("/push/test", { method: "POST" }).catch(() => ({ sent: 0 }));
    setNote(r.sent ? `✓ ${r.sent}` : "–");
  }

  return (
    <section className="glass space-y-3 rounded-3xl p-4" aria-labelledby="notif-title" data-testid="notification-prefs">
      <div className="flex items-center justify-between gap-2">
        <p id="notif-title" className="font-semibold">🔔 {t("push.prefsTitle")}</p>
        {state === "on" && <span className="text-xs text-mint">✓ {t("push.on").replace(" ✓", "")}</span>}
      </div>
      <ErrorNote error={error ?? err} />
      {data && (
        <>
          {ROWS.filter((r) => !r.appOnly || isNative() || data.devices.some((d) => d.platform !== "WEB")).map((r) => (
            <label key={r.key} className="flex items-center gap-3">
              <span className="flex-1">
                <span className="block text-sm font-semibold">{t(r.title)}</span>
                <span className="block text-xs text-mut">{t(r.body)}</span>
              </span>
              <input type="checkbox" role="switch" className="peer sr-only" checked={data.prefs[r.key]} onChange={(e) => toggle(r.key, e.target.checked)} />
              <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-gold ${data.prefs[r.key] ? "bg-mint" : "bg-white/20"}`}>
                <span className={`absolute top-0.5 size-6 rounded-full bg-white transition-all ${data.prefs[r.key] ? "left-[22px]" : "left-0.5"}`} />
              </span>
            </label>
          ))}

          <div className="border-t border-white/10 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mut">{t("push.devices")}</p>
            {data.devices.length === 0 ? (
              <p className="mt-1 text-sm text-mut">{t("push.none")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">
                      {DEVICE_LABEL[d.platform]}
                      {d.installationId === here && <span className="ml-1 text-xs text-gold">· this device</span>}
                      <span className="block text-xs text-mut">{new Date(d.lastSeenAt).toLocaleDateString(locale === "rw" ? "en-GB" : locale)}{d.appVersion ? ` · v${d.appVersion}` : ""}</span>
                    </span>
                    <button
                      type="button"
                      className="glass min-h-10 rounded-xl px-3 text-xs font-semibold"
                      aria-label={`Remove ${DEVICE_LABEL[d.platform]}`}
                      onClick={async () => {
                        await api(`/push/devices/${d.id}`, { method: "DELETE" });
                        await reload();
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state === "unsupported" && <p className="text-xs text-mut">{t("push.unsupported")}</p>}
          {state === "denied" && <p className="text-xs text-mut">{t("push.denied")}</p>}
          <div className="grid grid-cols-2 gap-2">
            {state !== "on" && state !== "unsupported" && state !== "denied" && <Button variant="glass" onClick={turnOn}>{t("push.thisDevice")}</Button>}
            {data.devices.length > 0 && (
              <Button variant="glass" onClick={test} className={state === "on" ? "col-span-2" : ""}>
                {t("push.test")} {note && <span className="text-xs text-mint">{note}</span>}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
