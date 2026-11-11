"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Badge, Chip, Empty, Field, Icon, Input, Meter, Note, ScreenSkeleton, SButton, SectionTitle, Segmented, Select, Skeleton, StudioSheet, Switch, Textarea } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import type { BroadcastState, Discount, PromoCard } from "@/lib/growth";
import type { StudioProduct } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

// Lazy (below the fold / on demand): keeps this route's first-load JS small.
const GrowthInsights = dynamic(() => import("@/components/growth-insights").then((m) => m.GrowthInsights), { ssr: false, loading: () => <Skeleton className="h-72" /> });

type Tab = "share" | "offers" | "broadcast" | "insights";
const TABS: { value: Tab; label: string }[] = [
  { value: "share", label: "Share kit" },
  { value: "offers", label: "Offers" },
  { value: "broadcast", label: "Updates" },
  { value: "insights", label: "Insights" },
];

/** E30 member growth tools: share kit, maker-funded offers, follower updates, insights v2. */
export default function GrowPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Grow />
    </Suspense>
  );
}

function Grow() {
  const { page } = useManagedPage();
  const q = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((TABS.find((t) => t.value === q.get("tab"))?.value as Tab) ?? "share");
  const { data: products } = useApi<StudioProduct[]>(`/pages/${page.id}/products`);
  const live = useMemo(() => (products ?? []).filter((p) => p.status === "PUBLISHED"), [products]);
  const pick = (t: Tab) => {
    setTab(t);
    router.replace(`/studio/${page.id}/grow?tab=${t}`, { scroll: false });
  };
  return (
    <div className="space-y-5">
      <SectionTitle as="h1" title="Grow" eyebrow={page.name} />
      <Segmented label="Growth tools" options={TABS} value={tab} onChange={pick} />
      {tab === "share" && <ShareKit products={live} initial={q.get("product")} />}
      {tab === "offers" && <Offers products={live} initial={q.get("product")} />}
      {tab === "broadcast" && <Broadcast products={live} />}
      {tab === "insights" && <GrowthInsights pageId={page.id} />}
    </div>
  );
}

const thumb = (p: StudioProduct) => p.variants.find((v) => v.image)?.image ?? null;

function ProductPicker({ products, value, onChange, label }: { products: StudioProduct[]; value: string | null; onChange: (id: string) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold text-cocoa">{label}</legend>
      <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {products.map((p) => {
          const on = p.id === value;
          const img = thumb(p);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.id)}
              className={`st-press relative w-[104px] shrink-0 overflow-hidden rounded-2xl bg-white text-left ring-2 ring-inset transition ${on ? "ring-violet-ink shadow-[0_8px_20px_-10px_rgba(98,57,201,.6)]" : "ring-hairline"}`}
            >
              <span className="block aspect-[4/5] bg-paper-2">{img ? <img loading="lazy" decoding="async" src={img} alt="" className="size-full object-cover" /> : <Icon name="hanger" className="m-auto mt-8 size-6 text-cocoa-3" />}</span>
              <span className="block truncate px-2 pt-1.5 text-xs font-bold text-cocoa">{p.title}</span>
              <span className="block px-2 pb-2 text-[11px] font-semibold text-cocoa-2">{rwf(p.priceRwf)}</span>
              {on && <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-violet-ink text-white"><Icon name="check" className="size-3.5" /></span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------- Share kit ----------------

function ShareKit({ products, initial }: { products: StudioProduct[]; initial: string | null }) {
  const { page } = useManagedPage();
  const [productId, setProductId] = useState<string | null>(initial);
  const [format, setFormat] = useState<"story" | "square">("story");
  const [locale, setLocale] = useState<"rw" | "en" | "fr">("rw");
  const [card, setCard] = useState<PromoCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!productId && products[0]) setProductId(products[0].id);
  }, [products, productId]);

  async function create() {
    if (!productId) return;
    setBusy(true);
    setErr(null);
    try {
      setCard(await api<PromoCard>(`/pages/${page.id}/promo`, { method: "POST", json: { productId, format, locale } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!card) return;
    try {
      const blob = await (await fetch(card.url)).blob();
      const file = new File([blob], `nyambika-${format}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `${card.shareText}\n${card.link}` });
      else window.open(card.links.wa_status.whatsapp, "_blank", "noopener");
    } catch {
      /* share sheet dismissed */
    }
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  if (!products.length) return <Empty icon="share" title="Publish a product first">Story and square cards are made from your live products.</Empty>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <section className="st-card space-y-4 rounded-[24px] p-4">
        <ProductPicker products={products} value={productId} onChange={(id) => { setProductId(id); setCard(null); }} label="Pick a piece" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Segmented label="Format" options={[{ value: "story", label: "Story 9:16" }, { value: "square", label: "Square 1:1" }]} value={format} onChange={(v) => { setFormat(v); setCard(null); }} />
          <Segmented label="Language" options={[{ value: "rw", label: "Kinyarwanda" }, { value: "en", label: "English" }, { value: "fr", label: "Français" }]} value={locale} onChange={(v) => { setLocale(v); setCard(null); }} />
        </div>
        <SButton className="min-h-12 w-full" onClick={create} disabled={busy || !productId}>
          <Icon name="sparkle" className="size-4" /> {busy ? "Making your card…" : card ? "Make it again" : "Make my card"}
        </SButton>
        <Note error={err} />
        <p className="text-xs leading-relaxed text-cocoa-2">Every card carries your price, a QR code to your Maker Space and “Try it on you”. Scans and taps are counted under Insights → where visitors come from.</p>
      </section>

      <section aria-label="Card preview" className="space-y-3">
        <div className={`relative mx-auto w-full overflow-hidden rounded-[26px] bg-paper-2 ring-1 ring-hairline ${format === "story" ? "max-w-[300px] aspect-[9/16]" : "max-w-[380px] aspect-square"}`}>
          {busy && <Skeleton className="absolute inset-0 rounded-none" />}
          {card && !busy && <img src={card.url} alt={`Promo card: ${products.find((p) => p.id === productId)?.title ?? ""}`} className="animate-pop size-full object-cover" />}
          {!card && !busy && (
            <div className="grid size-full place-items-center p-6 text-center text-sm text-cocoa-2">
              <span><Icon name="sparkle" className="mx-auto mb-2 size-7 text-violet-ink" />Your {format === "story" ? "1080×1920 story" : "1080×1080 square"} card appears here</span>
            </div>
          )}
        </div>
        {card && (
          <div className="grid grid-cols-2 gap-2">
            <SButton onClick={share}><Icon name="share" className="size-4" /> Share</SButton>
            <a href={card.url} download={`nyambika-${format}-${locale}.png`} className="st-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-hairline bg-white px-4 text-sm font-bold text-cocoa"><Icon name="download" className="size-4" /> Download</a>
            <a href={card.links.wa_status.whatsapp} target="_blank" rel="noreferrer" className="st-press col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700">WhatsApp Status / chat</a>
          </div>
        )}
        {card && (
          <div className="st-card rounded-[22px] p-3">
            <p className="mb-2 text-xs font-bold text-cocoa">Tagged links (each one shows up in Insights)</p>
            <ul className="space-y-1.5">
              {(["wa_catalogue", "wa_status", "ig_story", "link"] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs font-bold text-cocoa-2">{{ wa_catalogue: "WA catalogue", wa_status: "WA Status", ig_story: "Instagram", link: "Any chat" }[k]}</span>
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-2 py-1.5 text-[11px] text-cocoa">{card.links[k].url.replace(/^https?:\/\//, "")}</code>
                  <SButton variant="soft" className="!min-h-9 px-2.5 text-xs" onClick={() => copy(k, card.links[k].url)} aria-label={`Copy ${k} link`}>{copied === k ? "Copied" : <Icon name="copy" className="size-4" />}</SButton>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------- Offers ----------------

const STATE_LABEL: Record<Discount["state"], [string, string]> = {
  LIVE: ["LIVE", "live"],
  PAUSED: ["PAUSED", "paused"],
  SCHEDULED: ["IN_REVIEW", "scheduled"],
  ENDED: ["ARCHIVED", "ended"],
  USED_UP: ["OUT_OF_STOCK", "used up"],
};

function Offers({ products, initial }: { products: StudioProduct[]; initial: string | null }) {
  const { page } = useManagedPage();
  const { data, reload, loading } = useApi<Discount[]>(`/pages/${page.id}/discounts`);
  const [open, setOpen] = useState(Boolean(initial));
  const inWeek = () => new Date(Date.now() + 7 * 86400_000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const blank = { mode: "code" as "code" | "offer", code: "", label: "", kind: "PERCENT" as "PERCENT" | "AMOUNT", value: "10", productId: initial ?? "", endsAt: inWeek(), maxUses: "", minSpend: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/pages/${page.id}/discounts`, {
        method: "POST",
        json: {
          code: f.mode === "code" ? f.code : null,
          label: f.label || (f.mode === "offer" ? "Limited offer" : ""),
          kind: f.kind,
          value: Number(f.value),
          productId: f.productId || null,
          endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
          maxUses: f.maxUses ? Number(f.maxUses) : null,
          minSpendRwf: f.minSpend ? Number(f.minSpend) : 0,
        },
      });
      setOk(f.mode === "code" ? `Code ${f.code.toUpperCase()} is live.` : "Your offer is live on the buy sheet.");
      setOpen(false);
      setF(blank);
      await reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  async function toggle(d: Discount, active: boolean) {
    await api(`/pages/${page.id}/discounts/${d.id}`, { method: "PATCH", json: { active } });
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="st-hero relative overflow-hidden rounded-[24px] p-4">
        <p className="font-extrabold text-cocoa">Codes and time-boxed offers</p>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-cocoa-2">You fund every discount: the shopper pays you a little less, straight to your MoMo. Nyambika never adds or takes anything. Codes are checked when the shopper holds to buy.</p>
        <SButton className="mt-3" onClick={() => setOpen(true)}><Icon name="plus" className="size-4" /> New offer</SButton>
      </div>
      <Note ok={ok} />
      {loading && !data && <ScreenSkeleton variant="list" />}
      {data?.length === 0 && <Empty icon="wallet" title="No offers yet">Try a weekend offer on a piece that gets many try-ons but few sales.</Empty>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data?.map((d) => (
          <li key={d.id} className="st-card space-y-3 rounded-[24px] p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-cocoa font-display text-lg font-black text-amber-300">{d.display.replace("RWF ", "")}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-extrabold text-cocoa">
                  {d.code ? <span className="rounded-lg bg-paper-2 px-2 py-0.5 font-mono text-sm tracking-wider">{d.code}</span> : <span>{d.label || "Automatic offer"}</span>}
                  <Badge value={STATE_LABEL[d.state][0]} label={STATE_LABEL[d.state][1]} />
                </p>
                <p className="mt-0.5 text-xs text-cocoa-2">
                  {d.productTitle ?? "All pieces"}
                  {d.minSpendRwf ? ` · from ${rwf(d.minSpendRwf)}` : ""}
                  {d.endsAt ? ` · until ${new Date(d.endsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : " · no end date"}
                </p>
              </div>
            </div>
            {d.maxUses ? (
              <div>
                <div className="mb-1 flex justify-between text-xs font-bold text-cocoa-2"><span>Used</span><span className="tabular-nums">{d.uses} / {d.maxUses}</span></div>
                <Meter value={d.uses} max={d.maxUses} label={`${d.code ?? d.label} uses`} />
              </div>
            ) : (
              <p className="text-xs font-bold text-cocoa-2">Used {d.uses} time{d.uses === 1 ? "" : "s"}</p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-cocoa-2">You gave <b className="text-cocoa">{rwf(d.givenRwf)}</b> in discounts</span>
              <Switch checked={d.active} onChange={(v) => toggle(d, v)} ariaLabel={`${d.code ?? d.label} active`} />
            </div>
          </li>
        ))}
      </ul>

      <StudioSheet open={open} onClose={() => setOpen(false)} title="New offer">
        <form onSubmit={save} className="space-y-4">
          <Segmented label="Type" options={[{ value: "code", label: "Discount code" }, { value: "offer", label: "Time-boxed offer" }]} value={f.mode} onChange={(mode) => setF({ ...f, mode })} />
          {f.mode === "code" ? (
            <Field label="Code" hint="Shoppers type it on the buy sheet. Letters and numbers, e.g. GISOZI10.">
              <Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} maxLength={20} className="font-mono tracking-wider" data-autofocus />
            </Field>
          ) : (
            <Field label="Name" hint="Shown on the buy sheet, e.g. “Weekend offer”."><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={60} placeholder="Weekend offer" /></Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "PERCENT" | "AMOUNT" })}>
                <option value="PERCENT">Percent (%)</option>
                <option value="AMOUNT">Amount (RWF)</option>
              </Select>
            </Field>
            <Field label={f.kind === "PERCENT" ? "Percent off" : "RWF off"}><Input required inputMode="numeric" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
          <Field label="Piece">
            <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
              <option value="">All my pieces</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </Field>
          <Field label="Ends" hint={f.mode === "offer" ? "Offers are always time-boxed." : "Optional for codes."}><Input type="datetime-local" required={f.mode === "offer"} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max uses" hint="Optional"><Input inputMode="numeric" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Min price (RWF)" hint="Optional"><Input inputMode="numeric" value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
          <p className="rounded-2xl bg-amber-50 p-3 text-xs leading-relaxed text-gold-ink ring-1 ring-inset ring-amber-200">You fund this: the Mobile Money request is smaller and goes straight to you. Discounts never go above 90% and never touch the delivery fee.</p>
          <Note error={err} />
          <SButton className="min-h-12 w-full">Start offer</SButton>
        </form>
      </StudioSheet>
    </div>
  );
}

// ---------------- Broadcast ----------------

const TEMPLATES = [
  "Our new collection is here! Come and try it on you ✨",
  "Back in stock in new colours. Try them on before they go.",
  "Wedding season: new umushanana and kitenge pieces, made to your measure.",
];

function Broadcast({ products }: { products: StudioProduct[] }) {
  const { page } = useManagedPage();
  const { data, reload } = useApi<BroadcastState>(`/pages/${page.id}/broadcasts`);
  const [msg, setMsg] = useState(TEMPLATES[0]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ recipients: number; skipped: number }>(`/pages/${page.id}/broadcasts`, { method: "POST", json: { message: msg, productIds: picked, locale: "rw" } });
      setOk(`Sent to ${r.recipients} follower${r.recipients === 1 ? "" : "s"} on WhatsApp${r.skipped ? ` · ${r.skipped} skipped (not opted in or already got enough this week)` : ""}.`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <ScreenSkeleton variant="list" />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <section className="st-card space-y-4 rounded-[24px] p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline"><p className="text-[11px] font-bold text-cocoa-2">Followers</p><p className="font-display text-2xl font-black tabular-nums text-cocoa">{data.followers}</p></div>
          <div className="rounded-2xl bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200"><p className="text-[11px] font-bold text-mint-ink">Want WhatsApp updates</p><p className="font-display text-2xl font-black tabular-nums text-cocoa">{data.optedIn}</p></div>
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold text-cocoa">✨ Start from</legend>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t, i) => <button key={i} type="button" onClick={() => setMsg(t)} aria-pressed={msg === t} className={`st-press rounded-full px-3 py-1.5 text-left text-xs font-bold ring-1 ring-inset ${msg === t ? "bg-violet-50 text-violet-ink ring-violet-200" : "bg-white text-cocoa-2 ring-hairline"}`}>{t.split(/[.!:]/)[0]}</button>)}
          </div>
        </fieldset>
        <Field label="Message" hint={`${msg.length}/320 · a link to your Maker Space and an opt-out line are added for you.`}><Textarea value={msg} maxLength={320} onChange={(e) => setMsg(e.target.value)} /></Field>
        {products.length > 0 && (
          <ProductPicker products={products} value={picked[0] ?? null} onChange={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [id, ...p].slice(0, 6)))} label="Feature a piece (optional)" />
        )}
        <Note error={err} ok={ok} />
        {data.blocked && <p className="rounded-2xl bg-sky-50 p-3 text-sm text-sky-800 ring-1 ring-inset ring-sky-200"><Icon name="clock" className="mr-1 inline size-4" />{data.blocked.message}{data.blocked.retryAt ? ` Next: ${new Date(data.blocked.retryAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}</p>}
        <SButton className="min-h-12 w-full" onClick={send} disabled={busy || !data.canSend || msg.trim().length < 10 || data.optedIn === 0}>
          <Icon name="mail" className="size-4" /> {busy ? "Sending…" : data.optedIn === 0 ? "No opted-in followers yet" : `Send to ${data.optedIn} on WhatsApp`}
        </SButton>
        <p className="text-xs leading-relaxed text-cocoa-2">Only followers who said yes to WhatsApp updates get it. Limits keep it friendly: one update a day, three a week, and nobody gets more than four updates a week from all makers.</p>
      </section>
      <section aria-label="Preview and history" className="space-y-3">
        <div className="rounded-[24px] bg-[#e7ded3] p-4">
          <p className="mb-2 text-center text-[11px] font-bold text-cocoa-2">Preview on WhatsApp</p>
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-[#d9fdd3] p-3 text-[13px] leading-snug text-cocoa shadow-sm">
            <p><b>{page.name}</b> ✨ {msg}</p>
            <p className="mt-1 text-sky-800 underline">{`nyambika.rw/m/${page.handle}?src=broadcast`}</p>
            <p className="mt-1 text-[11px] text-cocoa-2">Ohereza STOP ngo ntuzongere kubona ubu butumwa.</p>
          </div>
        </div>
        <div className="st-card rounded-[22px] p-4">
          <p className="font-extrabold text-cocoa">Sent updates</p>
          {data.history.length === 0 ? (
            <p className="mt-1 text-sm text-cocoa-2">Nothing sent yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline">
              {data.history.map((h) => (
                <li key={h.id} className="py-2 text-sm">
                  <p className="line-clamp-2 text-cocoa">{h.message}</p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-cocoa-2"><Chip tone="mint">{h.recipients} sent</Chip>{h.skipped ? <Chip>{h.skipped} skipped</Chip> : null}<span>{new Date(h.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
