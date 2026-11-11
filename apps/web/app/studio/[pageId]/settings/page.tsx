"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { AiWrite } from "@/components/ai-write";
import { AgentChannels } from "@/components/agent-channels";
import { Card, Field, Icon, Input, Monogram, Note, SButton, SectionTitle, Switch, Textarea, Skeleton } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { THEMES } from "@/lib/maker";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

// Lazy (below the fold / on demand): keeps this route's first-load JS small.
const TrainingDataLink = dynamic(() => import("@/components/mlspike-training").then((m) => m.TrainingDataLink), { ssr: false, loading: () => <Skeleton className="h-24" /> });

interface Plan {
  code: string;
  name: string;
  priceRwf: number;
  maxProducts: number;
  tryOnAllowance: number;
}

const THEME_NAMES: Record<string, string> = { terra: "Terracotta", indigo: "Indigo", forest: "Forest", violet: "Violet" };

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "theme", label: "Theme" },
  { id: "payouts", label: "Payouts" },
  { id: "plan", label: "Plan" },
  { id: "visibility", label: "Visibility" },
  { id: "staff", label: "Staff" },
];

export default function Settings() {
  const { page, reload } = useManagedPage();
  const initial = {
    name: page.name,
    story: page.story,
    district: page.district,
    sector: page.sector,
    whatsapp: page.whatsapp,
    instagram: page.instagram,
    theme: page.theme,
    momoMerchant: page.momoMerchant,
    allowanceOn: page.allowanceOn,
  };
  const [f, setF] = useState(initial);
  const [staffPhone, setStaffPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: plans } = useApi<Plan[]>("/plans");
  const [plan, setPlan] = useState<string>("");
  const currentPlan = page.subscription?.planCode ?? "";
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg(ok);
      navigator.vibrate?.(10);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const staff = page.roles.filter((r) => r.role === "PAGE_STAFF");

  return (
    <div className="space-y-5">
      <SectionTitle title="Settings" eyebrow="Your page" />
      <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="st-press shrink-0 rounded-full bg-white px-3.5 py-2 text-sm font-bold text-cocoa-2 ring-1 ring-inset ring-hairline hover:text-cocoa">{s.label}</a>
        ))}
      </nav>
      <Note error={err} ok={msg} />

      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await run(() => api(`/pages/${page.id}`, { method: "PATCH", json: f }), "Page saved.");
          setSaving(false);
        }}
      >
        <Card className="scroll-mt-28 space-y-4">
          <h2 id="profile" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Page profile</h2>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Story"><Textarea value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></Field>
          <AiWrite<{ story: string }>
            pageId={page.id}
            kind="story"
            fields={() => ({ name: f.name, memberType: page.memberType, sector: f.sector, district: f.district })}
            onResult={(r) => setF((x) => ({ ...x, story: r.story }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="District"><Input value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></Field>
            <Field label="Sector"><Input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="WhatsApp"><Input inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></Field>
            <Field label="Instagram"><Input value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} autoCapitalize="none" /></Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 id="theme" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Theme</h2>
          <div className="relative h-28 overflow-hidden rounded-[22px] transition-[background] duration-500" style={{ background: THEMES[f.theme] ?? THEMES.terra }} aria-hidden>
            <div className="absolute inset-0 opacity-25 [background-image:repeating-linear-gradient(45deg,#fff_0_2px,transparent_2px_26px),repeating-linear-gradient(-45deg,#fff_0_2px,transparent_2px_26px)]" />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-ink" />
            <div className="absolute bottom-3 left-3 flex items-center gap-2.5">
              <Monogram name={f.name} size={40} className="!rounded-full ring-2 ring-gold" />
              <span className="font-display text-lg font-black text-white drop-shadow">{f.name}</span>
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold text-cocoa">Maker Space colour</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.keys(THEMES).map((k) => {
                const on = f.theme === k;
                return (
                  <label key={k} className={`st-press flex cursor-pointer items-center gap-2.5 rounded-2xl bg-white p-2 ring-inset ${on ? "ring-2 ring-cocoa" : "ring-1 ring-hairline hover:ring-cocoa-3"}`}>
                    <input type="radio" name="theme" value={k} checked={on} onChange={() => setF({ ...f, theme: k })} className="sr-only" />
                    <span className="relative size-10 shrink-0 rounded-xl" style={{ background: THEMES[k] }}>
                      {on && <Icon name="check" className="absolute inset-0 m-auto size-5 text-white drop-shadow" />}
                    </span>
                    <span className="text-sm font-bold text-cocoa">{THEME_NAMES[k] ?? k}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Card>

        <Card className="space-y-4">
          <h2 id="payouts" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Payouts</h2>
          <div className="rounded-[22px] bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
            <p className="flex items-center gap-2 font-extrabold text-mint-ink"><Icon name="wallet" className="size-5" /> Paid directly to you</p>
            <ol className="mt-3 grid gap-2 text-sm text-mint-ink sm:grid-cols-3">
              {["Shopper holds to buy on your piece", "They approve Mobile Money with their PIN", "Money lands on your MoMo number"].map((x, i) => (
                <li key={x} className="flex items-start gap-2 rounded-2xl bg-white/70 p-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mint-ink text-xs font-black text-white">{i + 1}</span>
                  {x}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-mint-ink">Nyambika never holds your money and takes no cut of the sale.</p>
          </div>
          <Field label="MoMo merchant number" hint="Hold-to-buy payments go straight to this account."><Input inputMode="tel" value={f.momoMerchant} onChange={(e) => setF({ ...f, momoMerchant: e.target.value })} /></Field>
          <Switch checked={f.allowanceOn} onChange={(v) => setF({ ...f, allowanceOn: v })} label="Share my try-on allowance" description="Let shoppers use my plan's try-on allowance after their free looks." />
          <a href={`/studio/${page.id}/region`} className="st-press flex min-h-14 items-center gap-3 rounded-2xl bg-white px-4 ring-1 ring-inset ring-hairline hover:ring-cocoa-3">
            <Icon name="globe" className="size-5 text-violet-ink" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-cocoa">Country, currency &amp; export</span><span className="block text-xs text-cocoa-2">M-Pesa, card payments for international buyers, shipping zones</span></span>
            <Icon name="chevron" className="size-4 text-cocoa-2" />
          </a>
        </Card>

        {dirty && (
        <div className="sticky bottom-[96px] z-20 animate-rise lg:bottom-4">
          <div className="st-dock flex items-center gap-3 rounded-[22px] p-2 pl-4">
            <span className="flex-1 text-sm font-bold text-cocoa">Unsaved changes</span>
            <SButton type="button" variant="ghost" onClick={() => setF(initial)}>Undo</SButton>
            <SButton disabled={saving}>{saving ? "Saving…" : "Save"}</SButton>
          </div>
        </div>
        )}
      </form>

      <Card className="space-y-4">
        <h2 id="plan" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Plan & try-on allowance</h2>
        {plans ? (
          <fieldset>
            <legend className="sr-only">Choose a plan</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {plans.map((p) => {
                const on = (plan || currentPlan) === p.code;
                return (
                  <label key={p.code} className={`st-press relative flex cursor-pointer flex-col gap-1 rounded-[20px] bg-white p-3.5 ring-inset ${on ? "ring-2 ring-cocoa" : "ring-1 ring-hairline hover:ring-cocoa-3"}`}>
                    <input type="radio" name="plan" value={p.code} checked={on} onChange={() => setPlan(p.code)} className="sr-only" />
                    {p.code === currentPlan && <span className="absolute right-3 top-3 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-mint-ink ring-1 ring-inset ring-emerald-200">current</span>}
                    <span className="font-display text-lg font-black text-cocoa">{p.name}</span>
                    <span className="text-sm font-bold text-cocoa">{p.priceRwf ? `${rwf(p.priceRwf)}/month` : "Free"}</span>
                    <span className="text-xs text-cocoa-2">{p.tryOnAllowance} looks · up to {p.maxProducts} products</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <div data-skeleton className="st-skel h-24 rounded-2xl" />
        )}
        <SButton
          variant="dark"
          disabled={!plan || plan === currentPlan}
          onClick={() => run(() => api(`/pages/${page.id}/plan`, { method: "POST", json: { planCode: plan } }), "Plan updated.")}
        >
          Change plan
        </SButton>
      </Card>

      <Card className="space-y-3">
        <h2 id="visibility" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Visibility</h2>
        <p className="text-sm text-cocoa-2">Pause your page while you&apos;re away. Nothing is deleted.</p>
        <div className="flex gap-2">
          {page.status === "PUBLISHED" && <SButton variant="outline" onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PAUSED" } }), "Page paused.")}>Pause page</SButton>}
          {page.status !== "PUBLISHED" && <SButton onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PUBLISHED" } }), "Page is live.")}>Publish page</SButton>}
        </div>
      </Card>

      <AgentChannels pageId={page.id} />
      <TrainingDataLink pageId={page.id} />

      <Card className="space-y-3">
        <h2 id="staff" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Staff</h2>
        {staff.length === 0 && <p className="text-sm text-cocoa-2">No staff yet. Staff can manage products and orders, never payouts.</p>}
        <ul className="space-y-2">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-paper p-2.5 ring-1 ring-inset ring-hairline">
              <Monogram name={s.user.name ?? s.user.phone} size={36} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-cocoa">{s.user.name ?? s.user.phone}</span>
              <SButton variant="ghost" className="min-h-10" onClick={() => run(() => api(`/pages/${page.id}/staff/${s.userId}`, { method: "DELETE" }), "Staff removed.")}>Remove</SButton>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`/pages/${page.id}/staff`, { method: "POST", json: { phone: staffPhone } }), "Staff added.");
            setStaffPhone("");
          }}
        >
          <Input aria-label="Staff phone" placeholder="Staff phone" inputMode="tel" value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} />
          <SButton variant="dark">Invite</SButton>
        </form>
      </Card>
    </div>
  );
}
