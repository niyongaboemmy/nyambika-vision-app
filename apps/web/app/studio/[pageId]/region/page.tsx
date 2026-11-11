"use client";

import { formatMoney, toMajorString, type CurrencyCode } from "@nyambika/contracts/money";
import { REGIONS, WALLET_LABEL, type RegionCode, type Wallet } from "@nyambika/contracts/region-data";
import { useState } from "react";
import { Card, Chip, Field, Icon, Input, Note, ScreenSkeleton, SButton, SectionTitle, StudioSheet, Switch } from "@/components/studio";
import { api } from "@/lib/api";
import { COUNTRY_NAMES } from "@/lib/region";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

interface Zone { id: string; name: string; countries: string[]; currency: CurrencyCode; feeMinor: number; etaDays: number; active: boolean }
interface Settings {
  pageId: string;
  region: RegionCode;
  currency: CurrencyCode;
  mpesaTill: string;
  crossBorder: boolean;
  exportEnabled: boolean;
  stripeAccountId: string | null;
  stripeStatus: string;
  stripeMode: "mock" | "test" | "live";
  momoMerchant: string;
  airtelMerchant: string;
  regions: { code: RegionCode; name: string; flag: string; currency: string; wallets: Wallet[]; launched: boolean }[];
  products: { id: string; title: string; priceRwf: number; priceMinor: number | null; image: string | null }[];
  zones: Zone[];
}

/** Region & export (E40/E41): country + currency, regional wallets, Stripe Connect for card buyers, shipping zones. */
export default function RegionStudio() {
  const { page } = useManagedPage();
  const { data: s, setData, error } = useApi<Settings>(`/region/pages/${page.id}/settings`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [till, setTill] = useState<string | null>(null);
  if (error) return <Note error={error} />;
  if (!s) return <ScreenSkeleton variant="list" />;
  const tillValue = till ?? s.mpesaTill;
  const allowed = s.regions.find((r) => r.code === s.region)?.wallets ?? [];

  async function save(json: object, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      setData(await api<Settings>(`/region/pages/${page.id}/settings`, { method: "PUT", json }));
      setMsg(ok);
      navigator.vibrate?.(10);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function connect() {
    setErr(null);
    try {
      const r = await api<Settings & { onboardingUrl: string | null }>(`/region/pages/${page.id}/stripe/connect`, { method: "POST" });
      setData(r);
      if (r.onboardingUrl) window.location.href = r.onboardingUrl;
      else setMsg(r.stripeStatus === "ACTIVE" ? "Stripe account connected." : "Finish Stripe onboarding to take cards.");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Country, currency & export" eyebrow="Sell beyond your town" />
      <Note error={err} ok={msg} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Your country</h2>
          <fieldset>
            <legend className="sr-only">Country</legend>
            <div className="grid grid-cols-2 gap-2">
              {s.regions.map((r) => (
                <button key={r.code} type="button" aria-pressed={s.region === r.code} onClick={() => r.code !== s.region && save({ region: r.code }, `Your page is now in ${r.name}. Prices are charged in ${r.currency}.`)} className={`st-press flex min-h-16 items-center gap-3 rounded-2xl px-3 text-left ring-1 ring-inset ${s.region === r.code ? "bg-cocoa text-white ring-cocoa" : "bg-white text-cocoa ring-hairline"}`}>
                  <span className="text-2xl" aria-hidden>{r.flag}</span>
                  <span className="min-w-0"><span className="block text-sm font-bold">{r.name}</span><span className={`block text-xs ${s.region === r.code ? "text-white/80" : "text-cocoa-2"}`}>{r.currency}{r.launched ? "" : " · pilot"}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-cocoa-2">Shoppers are always charged in your currency ({s.currency}). They may see an “≈” conversion, but nothing is converted when they pay.</p>
          <Switch checked={s.crossBorder} onChange={(v) => save({ crossBorder: v }, v ? "Shoppers in other EAC countries who opt in can now find you." : "Only shoppers in your country see you.")} label="Sell to other EAC countries" description="Your page appears to shoppers abroad who chose to see cross-border makers." />
        </Card>

        <Card className="space-y-4">
          <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Mobile money</h2>
          <div className="flex flex-wrap gap-2">
            {allowed.map((w) => {
              const on = w === "MPESA" ? Boolean(s.mpesaTill) : w === "MTN_MOMO" ? Boolean(s.momoMerchant) : Boolean(s.airtelMerchant || (s.region === "RW" && s.momoMerchant));
              return <Chip key={w} tone={on ? "mint" : "stone"}>{on ? "✓ " : ""}{WALLET_LABEL[w]}</Chip>;
            })}
          </div>
          {allowed.includes("MPESA") && (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save({ mpesaTill: tillValue.trim() }, "M-Pesa till saved. Payments go straight to it."); }}>
              <div className="flex-1"><Field label="M-Pesa till (Buy Goods) · 5–8 digits, money goes straight to your till"><Input inputMode="numeric" value={tillValue} onChange={(e) => setTill(e.target.value.replace(/\D/g, ""))} /></Field></div>
              <SButton variant="dark" disabled={tillValue === s.mpesaTill}>Save</SButton>
            </form>
          )}
          {s.region === "RW" && <p className="text-sm text-cocoa-2">MTN MoMo and Airtel Money are set in Settings → Payouts.</p>}
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-ink text-white"><Icon name="globe" className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Card payments for international buyers</h2>
              <p className="text-sm text-cocoa-2">Diaspora and export buyers pay by card through <b>your own Stripe account</b>. Nyambika takes no fee and never holds the money.</p>
            </div>
            <Chip tone={s.stripeStatus === "ACTIVE" ? "mint" : s.stripeStatus === "PENDING" ? "gold" : "stone"}>{s.stripeStatus === "ACTIVE" ? "Connected" : s.stripeStatus === "PENDING" ? "Onboarding" : "Not connected"}</Chip>
          </div>
          {s.stripeMode !== "live" && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-gold-ink ring-1 ring-inset ring-amber-200">{s.stripeMode === "mock" ? "Offline test mock: no Stripe keys are configured, accounts and payments are simulated." : "Stripe test mode: no real money moves."}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {s.stripeStatus !== "ACTIVE" && <SButton onClick={connect}><Icon name="wallet" className="size-4" /> {s.stripeAccountId ? "Continue Stripe onboarding" : "Connect my Stripe account"}</SButton>}
            {s.stripeAccountId && <span className="font-mono text-xs text-cocoa-2">{s.stripeAccountId}</span>}
          </div>
          <Switch disabled={s.stripeStatus !== "ACTIVE"} checked={s.exportEnabled} onChange={(v) => save({ exportEnabled: v }, v ? "Card checkout is on for international buyers." : "Card checkout is off.")} label="Take card payments" description="Shown as “Card · international” at checkout." />
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-black tracking-tight text-cocoa">International shipping</h2>
            <SButton variant="soft" onClick={() => setZoneOpen(true)}><Icon name="plus" className="size-4" /> Add zone</SButton>
          </div>
          <p className="text-sm text-cocoa-2">One flat fee per zone, in {s.currency}. You ship it yourself or with your courier.</p>
          {s.zones.length === 0 && <p className="rounded-2xl bg-paper-2 p-4 text-sm text-cocoa-2">No zones yet. Add “East Africa” or “Europe” to sell abroad.</p>}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {s.zones.map((z) => (
              <li key={z.id} className="flex items-start gap-3 rounded-2xl bg-white p-3 ring-1 ring-inset ring-hairline">
                <Icon name="truck" className="mt-0.5 size-5 shrink-0 text-cocoa-2" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-cocoa">{z.name} · {formatMoney(z.feeMinor, z.currency)}</p>
                  <p className="text-xs text-cocoa-2">{z.countries.map((c) => (c === "*" ? "Rest of world" : (COUNTRY_NAMES[c] ?? c))).join(", ")} · ~{z.etaDays} days</p>
                </div>
                <button type="button" aria-label={`Remove ${z.name}`} onClick={async () => setData(await api<Settings>(`/region/zones/${z.id}`, { method: "DELETE" }))} className="st-press grid size-10 place-items-center rounded-full bg-paper-2 text-cocoa-2"><Icon name="x" className="size-4" /></button>
              </li>
            ))}
          </ul>
        </Card>

        {s.currency !== "RWF" && (
          <Card className="space-y-3 lg:col-span-2">
            <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Prices in {s.currency}</h2>
            <p className="text-sm text-cocoa-2">Set each piece's price in your currency. A piece without a {s.currency} price can't be bought yet: we never convert prices for you.</p>
            <ul className="divide-y divide-hairline">{s.products.map((p) => <PriceRow key={p.id} p={p} currency={s.currency} />)}</ul>
          </Card>
        )}
      </div>

      <ZoneSheet open={zoneOpen} currency={s.currency} pageId={page.id} onClose={() => setZoneOpen(false)} onSaved={(x) => { setData(x); setZoneOpen(false); }} />
      <p className="text-xs text-cocoa-2">{REGIONS[s.region].flag} Phone numbers for {REGIONS[s.region].name} look like {REGIONS[s.region].phoneExample}.</p>
    </div>
  );
}

function PriceRow({ p, currency }: { p: Settings["products"][number]; currency: CurrencyCode }) {
  const [v, setV] = useState(p.priceMinor == null ? "" : toMajorString(p.priceMinor, currency));
  const [state, setState] = useState<string | null>(null);
  async function save() {
    try {
      await api(`/region/products/${p.id}/price`, { method: "PUT", json: { amount: v } });
      setState("Saved");
    } catch (e) {
      setState((e as Error).message);
    }
  }
  return (
    <li className="flex items-center gap-3 py-2.5">
      {p.image ? <img src={p.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" /> : <span className="size-12 shrink-0 rounded-xl bg-paper-2" />}
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-cocoa">{p.title}{state && <span className="block text-xs font-semibold text-cocoa-2">{state}</span>}</span>
      <Input aria-label={`${p.title} price in ${currency}`} inputMode="decimal" value={v} onChange={(e) => { setV(e.target.value); setState(null); }} className="w-28 text-right" />
      <SButton variant="outline" onClick={save} disabled={!v}>Save</SButton>
    </li>
  );
}

const PRESETS: { name: string; countries: string[] }[] = [
  { name: "East Africa", countries: ["RW", "KE", "UG", "TZ", "BI"] },
  { name: "Europe & UK", countries: ["GB", "DE", "FR", "BE", "NL", "IE", "IT", "ES", "SE"] },
  { name: "North America", countries: ["US", "CA"] },
  { name: "Rest of world", countries: ["*"] },
];

function ZoneSheet({ open, currency, pageId, onClose, onSaved }: { open: boolean; currency: CurrencyCode; pageId: string; onClose: () => void; onSaved: (s: Settings) => void }) {
  const [preset, setPreset] = useState(0);
  const [fee, setFee] = useState("");
  const [eta, setEta] = useState("7");
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try {
      const p = PRESETS[preset];
      onSaved(await api<Settings>(`/region/pages/${pageId}/zones`, { method: "POST", json: { name: p.name, countries: p.countries, fee, etaDays: Number(eta) || 7 } }));
      setFee("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <StudioSheet open={open} onClose={onClose} title="Add a shipping zone" footer={<SButton className="w-full" disabled={!fee} onClick={add}>Add zone</SButton>}>
      <div className="space-y-4">
        <Field label="Zone" group>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p, i) => (
              <button key={p.name} type="button" aria-pressed={preset === i} onClick={() => setPreset(i)} className={`st-press min-h-12 rounded-2xl px-3 text-sm font-bold ring-1 ring-inset ${preset === i ? "bg-cocoa text-white ring-cocoa" : "bg-white text-cocoa ring-hairline"}`}>{p.name}</button>
            ))}
          </div>
        </Field>
        <Field label={`Flat fee in ${currency}`}><Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder={currency === "RWF" ? "45000" : "4500"} /></Field>
        <Field label="Delivery time (days)"><Input inputMode="numeric" value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, ""))} /></Field>
        <Note error={err} />
      </div>
    </StudioSheet>
  );
}
