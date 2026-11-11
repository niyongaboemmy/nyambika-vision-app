"use client";

import Link from "next/link";
import { Screen, TopBar } from "@/components/ui";
import { rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { CO_LABEL, JOURNEY, journeyIndex, type CustomOrderView } from "@/lib/tailor";

/** My tailor-made orders (E24). */
export default function CustomOrders() {
  const { t } = useSession();
  const { data } = useApi<CustomOrderView[]>("/custom-orders/mine");
  return (
    <Screen>
      <TopBar back="/" title={t("tailor.myOrders")} />
      <main className="space-y-3 px-4 pb-10">
        {!data && [0, 1].map((i) => <div key={i} className="h-28 rounded-3xl skeleton" />)}
        {data?.length === 0 && (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-4xl">🪡</p>
            <p className="mt-2 font-display text-lg font-black">Nothing tailor-made yet</p>
            <p className="mt-1 text-sm text-mut">Open a look from a tailor and tap Morph or Sew to ask for your own version.</p>
            <Link href="/makers" className="mt-3 inline-block text-sm font-semibold text-gold">Browse tailors →</Link>
          </div>
        )}
        {data?.map((o) => {
          const step = journeyIndex(o.status);
          return (
            <Link key={o.id} href={`/custom/${o.id}`} className="glass flex gap-3 rounded-3xl p-3 transition active:scale-[.99]">
              {o.image || o.productImage ? <img src={o.image ?? o.productImage!} alt="" className="h-24 w-20 shrink-0 rounded-2xl object-cover" /> : <span className="grid h-24 w-20 place-items-center rounded-2xl bg-white/10 text-3xl">✂️</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.title}</p>
                <p className="text-sm text-mut">{o.page.name} · {o.code}</p>
                <p className="mt-1 text-sm font-semibold text-gold">{CO_LABEL[o.status] ?? o.status}</p>
                <p className="text-xs text-mut">{o.quote ? rwf(o.quote.priceRwf) : `from ${rwf(o.estimateRwf)}`}</p>
                {step >= 0 && (
                  <div className="mt-2 flex gap-0.5" aria-hidden>
                    {JOURNEY.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-gold" : "bg-white/15"}`} />)}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </main>
    </Screen>
  );
}
