"use client";

import type { NotificationPrefs } from "@nyambika/contracts";
import type { MessageKey } from "@nyambika/i18n";
import { useEffect, useState } from "react";
import { ErrorNote } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Group, GroupRow } from "@/components/ios";
import { ShopperSwitch } from "@/components/shopper-switch";
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
const DEVICE_LABEL = { IOS: "iPhone app", ANDROID: "Android app", WEB: "Browser" } as const;
const DEVICE_ICON = { IOS: "phone", ANDROID: "phone", WEB: "globe" } as const;
const ROW_ICON: Record<keyof NotificationPrefs, { icon: IconName; tone: "terra" | "violet" | "mint" | "sky" | "gold" }> = {
  orders: { icon: "bag", tone: "gold" },
  liveActivity: { icon: "signal", tone: "mint" },
  looks: { icon: "sparkle", tone: "terra" },
  custom: { icon: "scissors", tone: "violet" },
  circle: { icon: "users", tone: "sky" },
  wardrobe: { icon: "calendar", tone: "terra" },
};

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

  const blocked = state === "denied" ? t("push.denied") : state === "unsupported" ? t("push.unsupported") : null;
  return (
    <div className="space-y-6" data-testid="notification-prefs">
      <ErrorNote error={error ?? err} />
      {data && (
        <>
          <Group
            header={t("push.prefsTitle")}
            footer={state === "on" ? <span className="inline-flex items-center gap-1 text-mint"><Icon name="checkCircle" className="size-3.5" />{t("push.on").replace(" ✓", "")}</span> : undefined}
          >
            {ROWS.filter((r) => !r.appOnly || isNative() || data.devices.some((d) => d.platform !== "WEB")).map((r) => (
              <GroupRow
                key={r.key}
                icon={ROW_ICON[r.key].icon}
                tone={ROW_ICON[r.key].tone}
                title={t(r.title)}
                subtitle={t(r.body)}
                accessory={<ShopperSwitch checked={data.prefs[r.key]} onChange={(v) => toggle(r.key, v)} label={t(r.title)} />}
              />
            ))}
          </Group>

          <Group header={t("push.devices")} footer={data.devices.length > 0 ? blocked ?? undefined : undefined}>
            {data.devices.length === 0 && <GroupRow icon={blocked ? "eyeOff" : "phone"} tone="stone" title={blocked ?? t("push.none")} />}
            {data.devices.map((d) => (
              <GroupRow
                key={d.id}
                icon={DEVICE_ICON[d.platform]}
                tone="stone"
                title={<>{DEVICE_LABEL[d.platform]}{d.installationId === here && <span className="ml-1 text-[13px] text-gold">· this device</span>}</>}
                subtitle={`${new Date(d.lastSeenAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}${d.appVersion ? ` · v${d.appVersion}` : ""}`}
                accessory={
                  <button
                    type="button"
                    className="hit press grid size-9 shrink-0 place-items-center rounded-full text-red-500"
                    aria-label={`Remove ${DEVICE_LABEL[d.platform]}`}
                    onClick={async () => {
                      await api(`/push/devices/${d.id}`, { method: "DELETE" });
                      await reload();
                    }}
                  >
                    <Icon name="trash" className="size-[18px]" />
                  </button>
                }
              />
            ))}
            {state !== "on" && state !== "unsupported" && state !== "denied" && <GroupRow icon="bell" tone="sky" title={t("push.thisDevice")} onClick={turnOn} />}
            {data.devices.length > 0 && <GroupRow icon="send" tone="violet" title={t("push.test")} value={note ?? undefined} onClick={test} />}
          </Group>
        </>
      )}
    </div>
  );
}
