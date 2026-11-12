"use client";

import Link from "next/link";
import { useState } from "react";
import { Group, GroupRow } from "@/components/ios";
import { LearnMore } from "@/components/kit";
import { Card, Icon, Note, Skeleton, Switch } from "@/components/studio";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface TrainingState {
  optedIn: boolean;
  decidedAt: string | null;
  products: {
    id: string;
    title: string;
    category: string;
    image: string | null;
    photos: number;
    included: boolean;
    override: "IN" | "OUT" | null;
    inDataset: boolean;
    /** Cooperative pages: credited makers, each must say yes too. */
    makers?: { name: string; consented: boolean }[];
    waitingForMaker?: boolean;
  }[];
  tombstones: number;
  latestDataset: { version: number; at: string; itemsFromThisPage: number } | null;
}

/** Settings link card (one line in Settings). */
export function TrainingDataLink({ pageId }: { pageId: string }) {
  const { data } = useApi<TrainingState>(`/pages/${pageId}/training-data`);
  return (
    <Group>
      <GroupRow icon="layers" tone="violet" title="Help train Nyambika AI" subtitle={data ? (data.optedIn ? "Sharing · change any time" : "Off · your choice") : "Off by default"} href={`/studio/${pageId}/training`} />
    </Group>
  );
}

const WHAT = [
  { icon: "hanger", ok: true, text: "Only your catalogue garment photos" },
  { icon: "shield", ok: false, text: "Never shopper photos or twins" },
  { icon: "eye", ok: false, text: "Faces removed automatically" },
  { icon: "refresh", ok: true, text: "Stop any time · removed next version" },
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
        <LearnMore className="relative mt-2">
          Nyambika is testing a small model that recognises umushanana, imigongo, kitenge and wax so it can fill in your listings for you. Sharing your garment photos makes it better for every maker. It is off until you switch it on.
        </LearnMore>
      </section>

      <Card className="space-y-3">
        <Switch
          checked={data.optedIn}
          disabled={busy}
          onChange={(v) => put(`/pages/${pageId}/training-data`, { optedIn: v }, v ? "Thank you! Your garment photos can now help train the helper." : "Stopped. Your photos will be removed from the next dataset version.")}
          label="Share my garment photos for training"
          description={data.decidedAt ? `Changed ${new Date(data.decidedAt).toLocaleDateString()} · in your consent ledger` : "Off · withdraw any time"}
        />
        <Note error={err} ok={msg} />
        {data.latestDataset && (
          <p className="rounded-2xl bg-paper p-3 text-xs text-cocoa-2">
            Dataset v{data.latestDataset.version} · {data.latestDataset.itemsFromThisPage} photo{data.latestDataset.itemsFromThisPage === 1 ? "" : "s"} from you
            {data.tombstones > 0 ? ` · ${data.tombstones} withdrawal${data.tombstones === 1 ? "" : "s"} on record (never return)` : ""}
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
        <p className="text-sm text-cocoa-2">Share or keep private, per piece</p>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {data.products.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-[20px] bg-paper ring-1 ring-inset ring-hairline">
              <div className="relative aspect-[4/5] bg-white">
                {p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-cocoa-3"><Icon name="camera" className="size-6" /></span>}
                <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black ${p.included ? "bg-mint-ink text-white" : p.waitingForMaker ? "bg-amber-100 text-gold-ink" : "bg-white/90 text-cocoa-2"}`}>{p.included ? "Shared" : p.waitingForMaker ? "Waiting" : "Private"}</span>
                {p.inDataset && <span className="absolute bottom-2 left-2 rounded-full bg-violet-ink/90 px-2 py-0.5 text-[10px] font-black text-white">In dataset</span>}
              </div>
              <div className="space-y-1.5 p-2.5">
                <p className="truncate text-sm font-bold text-cocoa">{p.title}</p>
                {p.waitingForMaker && (
                  <p className="flex items-center gap-1 text-xs font-bold text-gold-ink">
                    <Icon name="clock" className="size-3.5 shrink-0" />
                    <span className="truncate">Waiting for {(p.makers ?? []).filter((m) => !m.consented).map((m) => m.name.split(" ")[0]).join(", ") || "the maker"}</span>
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={(p.included || p.waitingForMaker)}
                  aria-label={`${(p.included || p.waitingForMaker) ? "Keep private" : "Share"}: ${p.title}`}
                  onClick={() => put(`/pages/${pageId}/training-data/products/${p.id}`, { included: !(p.included || p.waitingForMaker) }, (p.included || p.waitingForMaker) ? `${p.title} is private again.` : `${p.title} is shared.`)}
                  className={`st-press min-h-11 w-full rounded-xl text-sm font-bold ring-1 ring-inset disabled:opacity-50 ${(p.included || p.waitingForMaker) ? "bg-white text-cocoa ring-hairline" : "bg-violet-ink text-white ring-violet-ink"}`}
                >
                  {(p.included || p.waitingForMaker) ? "Keep private" : "Share"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

interface MakerTrainingState {
  maker: string;
  consented: boolean;
  decidedAt: string | null;
  pieces: { id: string; title: string; image: string | null; coopShares: boolean; included: boolean }[];
}

/** "My products" link for a cooperative maker (one line on the products page). */
export function MakerTrainingLink({ pageId }: { pageId: string }) {
  const { data } = useApi<MakerTrainingState>(`/pages/${pageId}/training-data/maker`);
  if (!data) return null;
  return (
    <Link href={`/studio/${pageId}/training`} className="st-card st-press st-lift flex items-center gap-3 rounded-[24px] p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-ink"><Icon name="layers" className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold text-cocoa">Your photos for training: your choice</span>
        <span className="block text-sm text-cocoa-2">{data.consented ? "You share photos of pieces you made · change any time" : "Off · nothing you made is shared without your OK"}</span>
      </span>
      <Icon name="chevron" className="size-5 shrink-0 text-cocoa-3" />
    </Link>
  );
}

/**
 * Cooperative maker's own consent (on top of the admin's): a piece credited to a maker only enters a dataset
 * version when both said yes; either one stopping takes it out of every future version.
 */
export function MakerTrainingConsent({ pageId }: { pageId: string }) {
  const { locale } = useSession();
  const { data, setData, error } = useApi<MakerTrainingState>(`/pages/${pageId}/training-data/maker`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function set(consented: boolean) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      setData(await api<MakerTrainingState>(`/pages/${pageId}/training-data/maker`, { method: "PUT", json: { consented, locale } }));
      setMsg(consented ? "Thank you! Pieces you made can help train the helper when your cooperative shares them too." : "Stopped. Pieces you made leave the next dataset version.");
      navigator.vibrate?.(8);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Note error="Only a maker of this cooperative can decide this." />;
  if (!data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <section className="st-hero relative overflow-hidden rounded-[28px] p-5">
        <p className="relative text-sm font-bold text-violet-ink">Your work, your choice</p>
        <h2 className="relative font-display text-2xl font-black tracking-tight text-cocoa">Share photos of pieces you made?</h2>
        <LearnMore className="relative mt-2">
          Your cooperative can share garment photos to train a helper that knows Rwandan fashion. Pieces credited to you are only used if you say yes too. It is off until you switch it on.
        </LearnMore>
      </section>
      <Card className="space-y-3">
        <Switch
          checked={data.consented}
          disabled={busy}
          onChange={set}
          label="Share photos of pieces I made"
          description={data.decidedAt ? `Changed ${new Date(data.decidedAt).toLocaleDateString()} · in your consent ledger` : "Off · stop any time"}
        />
        <Note error={err} ok={msg} />
      </Card>
      {data.pieces.length > 0 && (
        <Card className="space-y-3">
          <h3 className="font-display text-lg font-black tracking-tight text-cocoa">Pieces credited to you</h3>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {data.pieces.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-[20px] bg-paper ring-1 ring-inset ring-hairline">
                <div className="relative aspect-[4/5] bg-white">
                  {p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-cocoa-3"><Icon name="camera" className="size-6" /></span>}
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black ${p.included ? "bg-mint-ink text-white" : "bg-white/90 text-cocoa-2"}`}>{p.included ? "Shared" : "Private"}</span>
                </div>
                <div className="space-y-0.5 p-2.5">
                  <p className="truncate text-sm font-bold text-cocoa">{p.title}</p>
                  <p className="text-xs text-cocoa-2">{p.coopShares ? "Cooperative: sharing" : "Cooperative: not sharing"}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
