"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Card, Icon, Monogram, Note, ScreenSkeleton, SButton, Textarea } from "@/components/studio";
import { Brand } from "@/components/studio-shell";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Review {
  status: string;
  legacyUrl: string;
  ownerNote: string;
  defects: { severity: "blocker" | "fix" | "info"; message: string }[];
  page: {
    id: string;
    name: string;
    handle: string;
    memberType: string;
    story: string;
    district: string;
    sector: string;
    whatsapp: string;
    momoMerchant: string;
    products: { id: string; title: string; priceRwf: number; readiness: string; image: string | null; colours: string[] }[];
  };
}

/** Owner review of a migrated page (runbook §16.3 steps 3–4). */
export default function MigrationReview() {
  const { token } = useParams<{ token: string }>();
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=/migrate/${token}`);
  }, [loading, me, router, token]);
  const { data: r, error, reload } = useApi<Review>(me ? `/migration/review/${token}` : null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(path: string, body?: object, ok?: string) {
    setErr(null);
    try {
      await api(`/migration/review/${token}/${path}`, { method: "POST", json: body ?? {} });
      setMsg(ok ?? null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="theme-light st-app min-h-dvh overflow-x-clip text-cocoa">
      <header className="st-glass-light sticky top-0 z-30 border-b border-hairline/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)]">
          <Brand label="Nyambika" />
          {r && <Badge value={r.status} label={r.status.replace(/_/g, " ").toLowerCase()} />}
        </div>
      </header>
      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-terra-ink">Owner review</p>
          <h1 className="font-display text-3xl font-black tracking-tight text-cocoa">Your page has moved to the new Nyambika</h1>
        </div>
        {error && <Note error={error} />}
        {!r && !error && <ScreenSkeleton variant="grid" />}
        {r && (
          <>
            <section className="st-hero space-y-3 rounded-[28px] p-5">
              <div className="flex items-center gap-3">
                <Monogram name={r.page.name} size={52} />
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-black text-cocoa">{r.page.name}</p>
                  <p className="text-sm font-semibold text-cocoa-2">{r.page.memberType.toLowerCase()} · {r.page.sector || "—"}, {r.page.district || "—"}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <p className="rounded-2xl bg-white/75 p-3 text-sm"><span className="block text-xs font-bold text-cocoa-2">New address</span><span className="break-all font-bold text-cocoa">nyambika.rw/m/{r.page.handle}</span></p>
                <p className="rounded-2xl bg-white/75 p-3 text-sm"><span className="block text-xs font-bold text-cocoa-2">Old address (redirects here)</span><span className="break-all font-semibold text-cocoa">{r.legacyUrl}</span></p>
              </div>
              <p className="text-sm leading-relaxed text-cocoa">{r.page.story || <span className="text-cocoa-2">No story yet</span>}</p>
              <p className="text-sm text-cocoa-2">WhatsApp {r.page.whatsapp} · MoMo {r.page.momoMerchant || "not set"}</p>
            </section>

            {r.defects.length > 0 && (
              <section className="space-y-2 rounded-[24px] bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
                <p className="flex items-center gap-2 font-extrabold text-gold-ink"><Icon name="alert" className="size-5" /> Things to check</p>
                <ul className="space-y-1.5">
                  {r.defects.map((d, i) => (
                    <li key={i} className="flex gap-2 rounded-2xl bg-white/70 p-2.5 text-sm text-gold-ink">
                      <Icon name={d.severity === "info" ? "bulb" : "wrench"} className="mr-1 inline size-4 align-[-3px]" /> {d.message}
                    </li>
                  ))}
                </ul>
                <Link href={`/studio/${r.page.id}`} className="st-press inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-cocoa underline">Fix it in the Page manager <Icon name="chevron" className="size-4" /></Link>
              </section>
            )}

            <section aria-labelledby="mig-products" className="space-y-3">
              <h2 id="mig-products" className="font-display text-xl font-black tracking-tight text-cocoa">{r.page.products.length} products moved</h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {r.page.products.map((p) => (
                  <li key={p.id} className="st-card overflow-hidden rounded-[22px]">
                    {p.image ? <img src={p.image} alt={p.title} className="aspect-[4/5] w-full object-cover" /> : <div className="grid aspect-[4/5] place-items-center bg-paper-2 text-cocoa-3"><Icon name="camera" className="size-7" /><span className="sr-only">no photo</span></div>}
                    <div className="space-y-1 p-2.5">
                      <p className="truncate text-sm font-extrabold text-cocoa">{p.title}</p>
                      <p className="truncate text-xs text-cocoa-2">{rwf(p.priceRwf)} · {p.colours.join(", ")}</p>
                      <Badge value={p.readiness} label={`try-on: ${p.readiness.replace(/_/g, " ").toLowerCase()}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <Note error={err} ok={msg} />
            {["IMPORTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(r.status) ? (
              <Card className="space-y-3">
                <SButton className="min-h-12 w-full text-base" onClick={() => act("sign-off", undefined, "Thank you! The Nyambika team will switch your page on.")}><Icon name="check" className="size-5" /> Looks right, sign off</SButton>
                <div className="flex items-center gap-3 text-xs font-bold text-cocoa-2"><span className="h-px flex-1 bg-hairline" />or<span className="h-px flex-1 bg-hairline" /></div>
                <Textarea aria-label="What should we fix?" placeholder="Or tell us what to fix…" value={note} onChange={(e) => setNote(e.target.value)} />
                <SButton variant="outline" className="w-full" disabled={note.trim().length < 3} onClick={() => act("request-changes", { note }, "Sent. We'll fix it within 48 hours and ask you again.")}>Request changes</SButton>
              </Card>
            ) : (
              <p className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 p-4 text-center text-sm font-bold text-mint-ink ring-1 ring-inset ring-emerald-200">
                <Icon name="check" className="size-5" /> {r.status === "LIVE" ? "Your new page is live. Old links now open it." : "Signed off. Thank you!"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
