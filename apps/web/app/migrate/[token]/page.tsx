"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Card, Note, SButton, Textarea } from "@/components/studio";
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
    <div className="theme-light min-h-dvh">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <p className="font-display text-2xl font-black">Your page has moved to the new Nyambika</p>
        {error && <Note error={error} />}
        {r && (
          <>
            <Card className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">{r.page.name}</p>
                  <p className="text-sm text-stone-500">New address: nyambika.rw/m/{r.page.handle} · old: {r.legacyUrl}</p>
                </div>
                <Badge value={r.status} label={r.status.replace(/_/g, " ").toLowerCase()} />
              </div>
              <p className="text-sm">{r.page.story || <span className="text-stone-400">No story yet</span>}</p>
              <p className="text-sm text-stone-600">{r.page.memberType.toLowerCase()} · {r.page.sector || "—"}, {r.page.district || "—"} · WhatsApp {r.page.whatsapp} · MoMo {r.page.momoMerchant || "not set"}</p>
            </Card>

            {r.defects.length > 0 && (
              <Card className="space-y-1.5 border-amber-300 bg-amber-50">
                <p className="font-semibold text-amber-900">Things to check</p>
                {r.defects.map((d, i) => (
                  <p key={i} className="text-sm text-amber-900">{d.severity === "info" ? "💡" : "🛠️"} {d.message}</p>
                ))}
                <Link href={`/studio/${r.page.id}`} className="inline-block pt-1 text-sm font-semibold underline">Fix it in the Page manager →</Link>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {r.page.products.map((p) => (
                <Card key={p.id} className="p-2">
                  {p.image ? <img src={p.image} alt={p.title} className="aspect-[4/5] w-full rounded-lg object-cover" /> : <div className="grid aspect-[4/5] place-items-center rounded-lg bg-stone-100 text-stone-400">no photo</div>}
                  <p className="mt-1 truncate text-sm font-semibold">{p.title}</p>
                  <p className="text-xs text-stone-500">{rwf(p.priceRwf)} · {p.colours.join(", ")}</p>
                  <Badge value={p.readiness} label={`try-on: ${p.readiness.replace(/_/g, " ").toLowerCase()}`} />
                </Card>
              ))}
            </div>

            <Note error={err} ok={msg} />
            {["IMPORTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(r.status) ? (
              <Card className="space-y-3">
                <SButton className="w-full" onClick={() => act("sign-off", undefined, "Thank you! The Nyambika team will switch your page on.")}>✓ Looks right, sign off</SButton>
                <Textarea placeholder="Or tell us what to fix…" value={note} onChange={(e) => setNote(e.target.value)} />
                <SButton variant="outline" className="w-full" disabled={note.trim().length < 3} onClick={() => act("request-changes", { note }, "Sent. We'll fix it within 48 hours and ask you again.")}>Request changes</SButton>
              </Card>
            ) : (
              <p className="text-center text-sm text-stone-600">{r.status === "LIVE" ? "Your new page is live. Old links now open it." : "Signed off. Thank you!"}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
