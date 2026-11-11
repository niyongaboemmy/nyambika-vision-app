"use client";

import type { SurveyTrigger } from "@nyambika/contracts";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const HIDDEN = /^\/(admin|studio|migrate|c\/|dev|signin|join)/;

/**
 * Pilot micro-survey (plan §8.1, §21 "helped me decide" / NPS): shown once after an order is paid and
 * once after 5 looks viewed. Dark aurora bottom sheet, dismissible; the server stores one answer per trigger.
 */
export function PilotSurvey() {
  const { me, t } = useSession();
  const path = usePathname() ?? "/";
  const [trigger, setTrigger] = useState<SurveyTrigger | null>(null);
  const [helped, setHelped] = useState<boolean | null>(null);
  const [nps, setNps] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const asked = useRef(new Set<string>());
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (!me || busy.current || trigger || HIDDEN.test(path)) return;
    // Never stack sheets: if the shopper is in another dialog, ask again on the next navigation.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    busy.current = true;
    try {
      const r = await api<{ trigger: SurveyTrigger | null }>("/survey/pending");
      if (r.trigger && !asked.current.has(r.trigger)) {
        asked.current.add(r.trigger);
        setHelped(null);
        setNps(null);
        setDone(false);
        setTrigger(r.trigger);
        track("survey_shown", { trigger: r.trigger });
      }
    } catch {
      /* the survey is optional: never surface errors */
    } finally {
      busy.current = false;
    }
  }, [me, path, trigger]);

  // On navigation, after look views, and while an order page waits for payment.
  useEffect(() => {
    const id = setTimeout(() => void check(), 1200);
    return () => clearTimeout(id);
  }, [check]);
  useEffect(() => {
    let n = 0;
    const onTrack = (e: Event) => {
      if ((e as CustomEvent<{ name: string }>).detail?.name !== "look_viewed") return;
      if (++n % 5 === 0) setTimeout(() => void check(), 2500);
    };
    window.addEventListener("nya:track", onTrack);
    return () => window.removeEventListener("nya:track", onTrack);
  }, [check]);
  useEffect(() => {
    if (!path.startsWith("/orders/")) return;
    const id = setInterval(() => void check(), 6000);
    return () => clearInterval(id);
  }, [path, check]);

  async function send(dismissed: boolean) {
    const tr = trigger;
    if (!tr) return;
    if (dismissed) setTrigger(null);
    await api("/survey", { method: "POST", json: { trigger: tr, helped: dismissed ? null : helped, nps: dismissed ? null : nps, dismissed } }).catch(() => {});
    if (!dismissed) {
      setDone(true);
      navigator.vibrate?.(12);
      setTimeout(() => setTrigger(null), 1600);
    }
  }

  return (
    <Sheet open={trigger !== null} onClose={() => (done ? setTrigger(null) : void send(true))}>
      <div className="relative overflow-hidden" aria-live="polite">
        <span aria-hidden className="orb pointer-events-none absolute -right-10 -top-12 size-32 rounded-full opacity-40 blur-2xl motion-safe:animate-orb" />
        {done ? (
          <div className="relative py-8 text-center">
            <p className="text-4xl" aria-hidden>💛</p>
            <p className="mt-3 font-display text-xl font-black text-grad">{t("survey.thanks")}</p>
          </div>
        ) : (
          <form
            className="relative space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(false);
            }}
          >
            <fieldset>
              <legend className="font-display text-2xl font-black leading-tight text-grad">{t("survey.helped")}</legend>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { v: true, label: t("survey.yes"), icon: "👍" },
                  { v: false, label: t("survey.no"), icon: "🤔" },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    aria-pressed={helped === o.v}
                    onClick={() => setHelped(o.v)}
                    className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border text-sm font-bold transition motion-safe:active:scale-95 ${helped === o.v ? "border-gold/80 bg-gold/20 text-white shadow-[0_0_24px_rgba(242,184,75,.25)]" : "border-white/15 bg-white/[.06] text-white/90"}`}
                  >
                    <span aria-hidden className="text-2xl">{o.icon}</span>
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {helped !== null && (
              <fieldset className="animate-rise">
                <legend className="text-sm font-semibold text-txt/90">{t("survey.nps")}</legend>
                <div className="mt-3 grid grid-cols-11 gap-1">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={nps === n}
                      aria-label={`${n} / 10`}
                      onClick={() => setNps(n)}
                      className={`grid h-11 place-items-center rounded-xl text-sm font-bold tabular-nums transition ${nps === n ? "grad-cta text-white" : "bg-white/[.08] text-white/85"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-mut">
                  <span>{t("survey.npsLow")}</span>
                  <span>{t("survey.npsHigh")}</span>
                </div>
              </fieldset>
            )}

            <div className="flex gap-3">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => void send(true)}>{t("survey.later")}</Button>
              <Button className="flex-[2]" disabled={helped === null}>{t("survey.send")}</Button>
            </div>
            <p className="text-center text-[11px] text-mut">Used only in pilot totals. Makers never see your answer.</p>
          </form>
        )}
      </div>
    </Sheet>
  );
}
