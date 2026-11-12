"use client";

import Link from "next/link";
import { EmptyState, Screen, TopBar } from "@/components/ui";
import { rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { CO_LABEL, JOURNEY, journeyIndex, type CustomOrderView } from "@/lib/tailor";
import { Icon } from "@/components/icons";

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
          <EmptyState icon="scissors" title="Nothing tailor-made yet" action={<Link href="/makers" className="glass press inline-flex min-h-11 items-center rounded-2xl px-4 text-sm font-semibold">Browse tailors →</Link>}>
            On a tailor&apos;s look, tap <b>Morph</b> or <b>Sew</b>
          </EmptyState>
        )}
        {data?.map((o) => {
          const step = journeyIndex(o.status);
          return (
            <Link key={o.id} href={`/custom/${o.id}`} className="glass flex gap-3 rounded-3xl p-3 transition active:scale-[.99]">
              {o.image || o.productImage ? <img loading="lazy" decoding="async" src={o.image ?? o.productImage!} alt="" className="h-24 w-20 shrink-0 rounded-2xl object-cover" /> : <span className="grid h-24 w-20 shrink-0 place-items-center rounded-2xl bg-white/10 text-mut" aria-hidden><Icon name="scissors" className="size-7" /></span>}
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
