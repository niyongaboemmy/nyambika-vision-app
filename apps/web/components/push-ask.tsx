"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { haptic, isNative, liveActivityPlugin } from "@/lib/native";
import { enablePush, pushState, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";

const DISMISS_KEY = "nya_push_ask_dismissed";

/**
 * The one meaningful moment to ask for notifications: right after hold-to-buy, while the shopper
 * waits for the Mobile Money PIN ("Tell me when it's paid"). Never shown on load, never twice after
 * "Not now" (for 7 days), never when the browser can't do it.
 */
export function PushAsk({ moment = "paid" }: { moment?: "paid" | "live" }) {
  const { t, locale } = useSession();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      dismissed = Date.now() - at < 7 * 86400_000;
    } catch {}
    void pushState().then((s) => {
      setState(s);
      setHidden(dismissed || s === "unsupported" || s === "on");
    });
  }, []);

  if (justEnabled) {
    return (
      <p className="glass animate-rise rounded-2xl px-4 py-3 text-center text-sm font-semibold text-mint" role="status" data-testid="push-on">
        🔔 {t("push.on")}
      </p>
    );
  }
  if (hidden || !state) return null;

  if (state === "denied") {
    return <p className="rounded-2xl bg-white/5 px-4 py-3 text-xs text-mut">{t("push.denied")}</p>;
  }

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush(locale);
      setState(s);
      if (s === "on") {
        haptic("success");
        setJustEnabled(true);
      }
    } catch {
      setState("default");
    } finally {
      setBusy(false);
    }
  }

  const live = moment === "live" || (isNative() && liveActivityPlugin());
  return (
    <section className="glass animate-rise rounded-3xl p-4" aria-labelledby="push-ask-title" data-testid="push-ask">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold/20 text-2xl" aria-hidden>🔔</span>
        <div className="min-w-0 flex-1">
          <p id="push-ask-title" className="font-semibold">{live ? t("push.liveTitle") : t("push.askTitle")}</p>
          <p className="mt-0.5 text-sm text-mut">{live ? t("push.liveBody") : t("push.askBody")}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <Button onClick={turnOn} disabled={busy}>{t("push.askCta")}</Button>
        <Button
          variant="ghost"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {}
            setHidden(true);
          }}
        >
          {t("push.askLater")}
        </Button>
      </div>
    </section>
  );
}
