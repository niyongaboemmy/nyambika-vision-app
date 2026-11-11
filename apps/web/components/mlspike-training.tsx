"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Icon, Note, Skeleton, Switch } from "@/components/studio";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface TrainingState {
  optedIn: boolean;
  decidedAt: string | null;
  products: { id: string; title: string; category: string; image: string | null; photos: number; included: boolean; override: "IN" | "OUT" | null; inDataset: boolean }[];
  tombstones: number;
  latestDataset: { version: number; at: string; itemsFromThisPage: number } | null;
}

/** Settings link card (one line in Settings). */
export function TrainingDataLink({ pageId }: { pageId: string }) {
  const { data } = useApi<TrainingState>(`/pages/${pageId}/training-data`);
  return (
    <Link href={`/studio/${pageId}/training`} className="st-card st-press st-lift flex items-center gap-3 rounded-[24px] p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-ink"><Icon name="layers" className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold text-cocoa">Help train Nyambika&apos;s garment helper</span>
        <span className="block text-sm text-cocoa-2">{data ? (data.optedIn ? "You share garment photos · change any time" : "Off · you decide which photos to share") : "Your choice, off by default"}</span>
      </span>
      <Icon name="chevron" className="size-5 shrink-0 text-cocoa-3" />
    </Link>
  );
}

const WHAT = [
  { icon: "hanger", ok: true, text: "Only your garment photos from your catalogue" },
  { icon: "shield", ok: false, text: "Never shoppers' photos, twins, looks or measurements" },
  { icon: "eye", ok: false, text: "Photos showing a person or face are removed automatically" },
  { icon: "refresh", ok: true, text: "Stop any time: your photos leave every future version" },
] as const;

/** Maker opt-in for training-data contribution (R4 spike), per page with per-product overrides. */
export function TrainingDataConsent({ pageId }: { pageId: string }) {
  const { locale } = useSession();
  const { data, setData } = useApi<TrainingState>(`/pages/${pageId}/training-data`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function put(path: string, json: object, ok: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      setData(await api<TrainingState>(path, { method: "PUT", json: { ...json, locale } }));
      setMsg(ok);
      navigator.vibrate?.(8);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  const included = data.products.filter((p) => p.included && p.photos > 0).length;
  return (
    <div className="space-y-4">
      <section className="st-hero relative overflow-hidden rounded-[28px] p-5">
        <div aria-hidden className="orb absolute -right-10 -top-10 size-36 animate-orb rounded-full opacity-20 blur-2xl" />
        <p className="relative text-sm font-bold text-violet-ink">Your photos, your choice</p>
        <h2 className="relative font-display text-2xl font-black tracking-tight text-cocoa">Help train a helper that knows Rwandan fashion</h2>
        <p className="relative mt-1.5 text-sm leading-relaxed text-cocoa-2">
          Nyambika is testing a small model that recognises umushanana, imigongo, kitenge and wax so it can fill in your listings for you. Sharing your garment photos makes it better for every maker. It is off until you switch it on.
        </p>
      </section>

      <Card className="space-y-3">
        <Switch
          checked={data.optedIn}
          disabled={busy}
          onChange={(v) => put(`/pages/${pageId}/training-data`, { optedIn: v }, v ? "Thank you! Your garment photos can now help train the helper." : "Stopped. Your photos will be removed from the next dataset version.")}
          label="Share my garment photos for training"
          description={data.decidedAt ? `Last changed ${new Date(data.decidedAt).toLocaleDateString()} · recorded in your consent ledger` : "Recorded in your consent ledger. Withdraw any time."}
        />
        <Note error={err} ok={msg} />
        {data.latestDataset && (
          <p className="rounded-2xl bg-paper p-3 text-xs text-cocoa-2">
            Dataset v{data.latestDataset.version}: {data.latestDataset.itemsFromThisPage} photo{data.latestDataset.itemsFromThisPage === 1 ? "" : "s"} from your page.
            {data.tombstones > 0 ? ` ${data.tombstones} withdrawal${data.tombstones === 1 ? "" : "s"} on record: those photos never come back.` : ""}
          </p>
        )}
      </Card>

      <ul aria-label="What sharing means" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {WHAT.map((w) => (
          <li key={w.text} className="flex items-center gap-2.5 rounded-2xl bg-white p-2.5 text-sm text-cocoa ring-1 ring-inset ring-hairline">
            <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${w.ok ? "bg-emerald-100 text-mint-ink" : "bg-orange-100 text-terra-ink"}`}><Icon name={w.icon} className="size-4" /></span>
            {w.text}
          </li>
        ))}
      </ul>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-black tracking-tight text-cocoa">Choose pieces</h3>
          <span className="text-xs font-bold text-cocoa-2">{included} shared</span>
        </div>
        <p className="text-sm text-cocoa-2">Keep a design private, or share just one piece without sharing the rest.</p>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {data.products.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-[20px] bg-paper ring-1 ring-inset ring-hairline">
              <div className="relative aspect-[4/5] bg-white">
                {p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-cocoa-3"><Icon name="camera" className="size-6" /></span>}
                <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black ${p.included ? "bg-mint-ink text-white" : "bg-white/90 text-cocoa-2"}`}>{p.included ? "Shared" : "Private"}</span>
                {p.inDataset && <span className="absolute bottom-2 left-2 rounded-full bg-violet-ink/90 px-2 py-0.5 text-[10px] font-black text-white">In dataset</span>}
              </div>
              <div className="space-y-1.5 p-2.5">
                <p className="truncate text-sm font-bold text-cocoa">{p.title}</p>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={p.included}
                  aria-label={`${p.included ? "Keep private" : "Share"}: ${p.title}`}
                  onClick={() => put(`/pages/${pageId}/training-data/products/${p.id}`, { included: !p.included }, p.included ? `${p.title} is private again.` : `${p.title} is shared.`)}
                  className={`st-press min-h-11 w-full rounded-xl text-sm font-bold ring-1 ring-inset disabled:opacity-50 ${p.included ? "bg-white text-cocoa ring-hairline" : "bg-violet-ink text-white ring-violet-ink"}`}
                >
                  {p.included ? "Keep private" : "Share"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
