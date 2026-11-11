"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { AiWrite } from "@/components/ai-write";
import { AgentChannels } from "@/components/agent-channels";
import { Group, GroupRow, MoreActions } from "@/components/ios";
import { Card, Chip, Field, Icon, Input, Monogram, Note, SButton, SectionTitle, Switch, Textarea, Skeleton } from "@/components/studio";
import { pageStatusLabel } from "@/components/studio-shell";
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
          <a key={s.id} href={`#${s.id}`} className="st-press inline-flex min-h-11 shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold text-cocoa-2 ring-1 ring-inset ring-hairline hover:text-cocoa">{s.label}</a>
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
          <Group header="Paid directly to you" footer={<span className="flex flex-wrap gap-1.5"><Chip tone="mint">Never held by Nyambika</Chip><Chip tone="mint">No cut</Chip></span>}>
            <GroupRow icon="hand" tone="terra" title="Shopper holds to buy" />
            <GroupRow icon="key" tone="violet" title="Approves with MoMo PIN" />
            <GroupRow icon="wallet" tone="mint" title="Lands on your MoMo" />
          </Group>
          <Field label="MoMo merchant number" hint="Payments land here"><Input inputMode="tel" value={f.momoMerchant} onChange={(e) => setF({ ...f, momoMerchant: e.target.value })} /></Field>
          <Group>
            <GroupRow icon="sparkle" tone="violet" title="Share allowance" subtitle="Try-ons after their free looks" accessory={<Switch checked={f.allowanceOn} onChange={(v) => setF({ ...f, allowanceOn: v })} ariaLabel="Share my try-on allowance" />} />
            <GroupRow icon="globe" tone="sky" title="Country & export" subtitle="M-Pesa · cards · shipping" href={`/studio/${page.id}/region`} />
          </Group>
        </Card>

        {dirty && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+100px)] z-20 animate-rise lg:bottom-4">
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
        <Group footer="Pausing hides your page · nothing is deleted">
          {page.status === "PUBLISHED" ? (
            <GroupRow icon="clock" tone="gold" title="Pause page" value="Live" onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PAUSED" } }), "Page paused.")} />
          ) : (
            <GroupRow icon="eye" tone="mint" title="Publish page" value={pageStatusLabel(page.status)} onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PUBLISHED" } }), "Page is live.")} />
          )}
        </Group>
      </Card>

      <AgentChannels pageId={page.id} />
      <TrainingDataLink pageId={page.id} />

      <Card className="space-y-3">
        <h2 id="staff" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">Staff</h2>
        {staff.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-cocoa-2"><Icon name="lock" className="size-4" />No staff · staff never see payouts</p>
        ) : (
          <Group footer="Staff never see payouts">
            {staff.map((s) => (
              <GroupRow
                key={s.id}
                icon="user"
                tone="stone"
                title={s.user.name ?? s.user.phone}
                accessory={<MoreActions label={`Actions for ${s.user.name ?? s.user.phone}`} title={s.user.name ?? s.user.phone} actions={[{ label: "Remove", icon: "trash", destructive: true, onSelect: () => run(() => api(`/pages/${page.id}/staff/${s.userId}`, { method: "DELETE" }), "Staff removed.") }]} />}
              />
            ))}
          </Group>
        )}
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
