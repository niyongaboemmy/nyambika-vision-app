"use client";

import { ambientCopy, craftFromEvents, liveActivityState, orderAmbient, type AmbientOrderState } from "@nyambika/contracts";
import { useEffect, useMemo } from "react";
import type { OrderView } from "@/lib/orders";
import { liveActivityPlugin } from "@/lib/native";
import { useSession } from "@/lib/session";

/** Same state model as the push payloads, the iOS Live Activity and the Android Live Update. */
export function ambientFor(o: OrderView): AmbientOrderState {
  const { craft, custom } = craftFromEvents(o.events);
  return orderAmbient({
    orderId: o.id,
    code: o.code,
    status: o.status,
    makerName: o.page.name,
    itemTitle: o.item?.title,
    craft: o.status === "IN_PREPARATION" ? craft : null,
    custom,
    deliveryMode: o.deliveryMode,
    readyBy: o.readyBy,
    updatedAt: o.events.at(-1)?.at,
  });
}

const ICON: Record<string, string> = { CUSTOM: "🧵", READY_MADE: "🛍️" };

/** The ambient moment (prototype v2 · 17): a lock-screen style live card that mirrors the native activity. */
export function AmbientOrder({ order }: { order: OrderView }) {
  const { locale, t } = useSession();
  const state = useMemo(() => ambientFor(order), [order]);
  const copy = ambientCopy(state, locale);
  const live = state.phase === "ACTIVE";
  const stopped = state.phase === "STOPPED";

  // Inside the app, keep the native Live Activity / widget in step with what the screen shows.
  useEffect(() => {
    const la = liveActivityPlugin();
    if (!la || state.phase === "AWAITING_PAYMENT") return;
    const payload = { attributes: { orderId: order.id, code: order.code, makerName: order.page.name, itemTitle: order.item?.title ?? "" }, state: liveActivityState(state, locale) };
    void (async () => {
      try {
        if (state.phase === "ACTIVE") {
          const { supported } = await la.isSupported();
          if (supported) await la.start(payload); // idempotent per order on the native side
          await la.setWidgetOrder?.(payload);
        } else {
          await la.end({ orderId: order.id, state: payload.state });
          await la.setWidgetOrder?.(payload);
        }
      } catch {}
    })();
  }, [state, locale, order.id, order.code, order.page.name, order.item?.title]);

  return (
    <section className="glass relative overflow-hidden rounded-3xl p-4" aria-live="polite" data-testid="ambient-order">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-terra to-violet text-2xl shadow-[0_6px_20px_rgba(139,92,246,.35)]" aria-hidden>
          {stopped ? "⏸" : ICON[state.kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-black leading-tight">{copy.headline}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-mut">
            {live && (
              <span className="inline-flex items-center gap-1 text-mint">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full rounded-full bg-mint opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-mint" />
                </span>
                {t("ambient.live")}
              </span>
            )}
            {live && copy.detail && <span aria-hidden>·</span>}
            <span className="truncate">{copy.detail}</span>
          </p>
        </div>
      </div>
      {state.stepIndex >= 0 && !stopped && (
        <div className="mt-4">
          <ol className="grid grid-cols-4 text-xs text-mut">
            {copy.stepLabels.map((label, i) => (
              <li key={label} className={`${i === 0 ? "text-left" : i === 3 ? "text-right" : "text-center"} ${i <= state.stepIndex ? "font-semibold text-txt" : ""}`} aria-current={i === state.stepIndex ? "step" : undefined}>
                {label}
              </li>
            ))}
          </ol>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)} aria-label={copy.headline}>
            <div className="h-full rounded-full bg-gradient-to-r from-mint via-gold to-gold transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
