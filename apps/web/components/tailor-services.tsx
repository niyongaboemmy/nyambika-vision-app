"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { api, rwf } from "@/lib/api";
import { MEASUREMENT_LABEL, type TailorServiceView } from "@/lib/tailor";
import { Icon } from "@/components/icons";

const AskTailorSheet = dynamic(() => import("@/components/ask-tailor").then((m) => m.AskTailorSheet), { ssr: false }); // opens on "Request this"

/** Tailor services on the Maker Space (FR-CAT-07): starting price, lead time, what to measure. */
export function TailorServices({ maker }: { maker: { id: string; name: string; memberType: string } }) {
  const [services, setServices] = useState<TailorServiceView[] | null>(null);
  const [ask, setAsk] = useState<TailorServiceView | null>(null);
  useEffect(() => {
    if (maker.memberType !== "TAILOR") return;
    void api<TailorServiceView[]>(`/pages/${maker.id}/services`).then((s) => setServices(s.filter((x) => x.active))).catch(() => setServices([]));
  }, [maker.id, maker.memberType]);
  if (maker.memberType !== "TAILOR" || !services?.length) return null;
  return (
    <section className="mt-6 px-5" aria-labelledby="services-h">
      <h2 id="services-h" className="text-xs font-semibold uppercase tracking-[.2em] text-gold">Made for you</h2>
      <div className="no-scrollbar -mx-5 mt-2 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
        {services.map((s) => (
          <article key={s.id} className="glass flex w-[78%] max-w-[300px] shrink-0 snap-start flex-col rounded-3xl p-4">
            <p aria-hidden><Icon name="needle" className="size-6 text-gold" /></p>
            <h3 className="mt-1 font-display text-lg font-black leading-tight">{s.title}</h3>
            <p className="mt-1 line-clamp-3 text-sm text-txt/80">{s.description}</p>
            <p className="mt-2 text-sm"><b className="text-gold">from {rwf(s.startingPriceRwf)}</b> · {s.leadTimeDays} days</p>
            {s.requiredMeasurements.length > 0 && (
              <p className="mt-1 text-xs text-mut">Needs: {s.requiredMeasurements.map((m) => MEASUREMENT_LABEL[m]?.label.toLowerCase() ?? m).join(", ")}</p>
            )}
            <button onClick={() => setAsk(s)} className="grad-cta mt-3 min-h-11 rounded-2xl text-sm font-bold">Request this</button>
          </article>
        ))}
      </div>
      {ask && (
        <AskTailorSheet
          open
          onClose={() => setAsk(null)}
          request={{ pageId: maker.id, makerName: maker.name, serviceId: ask.id, title: ask.title, estimateRwf: ask.startingPriceRwf, image: null, renderId: null, spec: null, required: ask.requiredMeasurements }}
        />
      )}
    </section>
  );
}
