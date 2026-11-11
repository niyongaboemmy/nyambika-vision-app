"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InfoTip } from "@/components/kit";
import { Badge, Card, Field, Icon, Input, Monogram, Note, SButton, ScreenSkeleton, Steps, Textarea, type IconName } from "@/components/studio";
import { Brand, pageStatusLabel } from "@/components/studio-shell";
import { api } from "@/lib/api";
import { THEMES } from "@/lib/maker";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface MyPage {
  id: string;
  handle: string;
  name: string;
  memberType: string;
  status: string;
  verified: boolean;
  role: string;
  plan: string;
  productCount: number;
}

const TYPE_ICON: Record<string, IconName> = { TAILOR: "scissors", COOPERATIVE: "users", SELLER: "store" };

export default function StudioHome() {
  const { me, t } = useSession();
  const { data: pages, loading, reload } = useApi<MyPage[]>("/pages/mine/list");
  const [creating, setCreating] = useState(false);
  return (
    <div className="min-h-dvh">
      <header className="st-glass-light sticky top-0 z-30 border-b border-hairline/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)]">
          <Brand label={t("studio.title")} />
          <a href="/" className="st-press inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-3.5 text-sm font-bold text-cocoa ring-1 ring-inset ring-hairline hover:ring-cocoa-3">
            <Icon name="eye" className="size-4" /> Shopper view
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
        {loading && <ScreenSkeleton variant="list" />}
        {!loading && !creating && (
          <div className="animate-rise">
            <p className="text-sm font-bold text-terra-ink">Muraho{me?.name ? `, ${me.name.split(" ")[0]}` : ""} 👋</p>
            <h1 className="font-display text-3xl font-black tracking-tight text-cocoa">Your pages</h1>
          </div>
        )}
        {!creating && pages && pages.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pages.map((p, i) => (
              <li key={p.id} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
                <Link href={`/studio/${p.id}`} className="st-card st-press st-lift flex items-center gap-3.5 rounded-[24px] p-4">
                  <Monogram name={p.name} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-black text-cocoa">{p.name}</p>
                    <p className="truncate text-xs font-semibold text-cocoa-2">nyambika.rw/{p.handle}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge value={p.status} label={pageStatusLabel(p.status)} />
                      <span className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-xs font-bold text-cocoa-2">
                        <Icon name={TYPE_ICON[p.memberType] ?? "store"} className="size-3.5" />
                        {p.role.replace(/_/g, " ").toLowerCase()}
                      </span>
                      <span className="text-xs font-semibold text-cocoa-2">{p.productCount} products</span>
                    </div>
                  </div>
                  <Icon name="chevron" className="size-5 text-cocoa-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages && pages.length === 0 && !creating && (
          <div className="st-hero relative overflow-hidden rounded-[30px] p-6 text-center sm:p-10">
            <div className="orb mx-auto size-16 animate-orb rounded-full opacity-90 shadow-[0_12px_40px_-8px_rgba(224,112,63,.7)]" />
            <h2 className="mt-5 font-display text-2xl font-black tracking-tight text-cocoa">Your own page on Nyambika</h2>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-cocoa-2">Tailors · cooperatives · sellers</p>
            <ul className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm font-semibold text-cocoa">
              {["Free · 3 steps", "Paid directly to your MoMo", "✨ AI writes in RW · EN · FR"].map((x) => (
                <li key={x} className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2.5">
                  <Icon name="check" className="size-4 shrink-0 text-mint-ink" /> {x}
                </li>
              ))}
            </ul>
            <SButton onClick={() => setCreating(true)} className="mt-6 min-h-12 px-6 text-base">Create my page</SButton>
          </div>
        )}
        {creating && <CreatePage onDone={reload} onCancel={() => setCreating(false)} />}
      </main>
    </div>
  );
}

const TYPES = [
  { value: "TAILOR", label: "Tailor", hint: "I sew to measure", icon: "scissors" },
  { value: "COOPERATIVE", label: "Sewing cooperative", hint: "We make together", icon: "users" },
  { value: "SELLER", label: "Seller", hint: "I sell ready-made", icon: "store" },
] as const;

const STEPS = ["About you", "Your story", "Get paid"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function CreatePage({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const router = useRouter();
  const { reload } = useSession();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", handle: "", memberType: "TAILOR", story: "", district: "", sector: "", whatsapp: "", momoMerchant: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const handle = f.handle || slug(f.name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      if (step === 0 && !f.name.trim()) return;
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const page = await api<{ id: string }>("/pages", { method: "POST", json: { ...f, handle } });
      await reload();
      onDone();
      navigator.vibrate?.([12, 40, 12]);
      router.push(`/studio/${page.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl animate-rise space-y-5" aria-labelledby="create-title">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
          aria-label={step === 0 ? "Cancel" : "Back"}
          className="st-press grid size-11 shrink-0 place-items-center rounded-full bg-white text-cocoa ring-1 ring-inset ring-hairline"
        >
          <Icon name="back" className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-terra-ink">Step {step + 1} of {STEPS.length}</p>
          <h1 id="create-title" className="font-display text-2xl font-black tracking-tight text-cocoa">Create your page</h1>
        </div>
      </div>
      <Steps steps={STEPS} current={step} label="Page setup progress" />

      {step === 0 && (
        <Card key="s0" className="animate-slide-in space-y-5">
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold text-cocoa">I am a</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TYPES.map((tp) => {
                const on = f.memberType === tp.value;
                return (
                  <label key={tp.value} className={`st-press flex cursor-pointer items-center gap-3 rounded-2xl p-3 ring-inset sm:flex-col sm:items-start ${on ? "bg-cocoa text-white ring-2 ring-cocoa" : "bg-white ring-1 ring-hairline hover:ring-cocoa-3"}`}>
                    <input type="radio" name="memberType" value={tp.value} checked={on} onChange={set("memberType")} className="sr-only" />
                    <span className={`grid size-10 place-items-center rounded-xl ${on ? "bg-white/15" : "bg-paper-2"}`}><Icon name={tp.icon} className="size-5" /></span>
                    <span>
                      <span className="block text-sm font-extrabold">{tp.label}</span>
                      <span className={`block text-xs ${on ? "text-white/80" : "text-cocoa-2"}`}>{tp.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Field label="Page name"><Input required value={f.name} onChange={set("name")} placeholder="Uwase Couture" autoComplete="organization" /></Field>
          <Field label="Page address" hint={`nyambika.rw/${handle || "your-name"}`}>
            <Input value={f.handle} onChange={set("handle")} placeholder={slug(f.name) || "uwase-couture"} pattern="[a-z0-9-]{3,40}" autoCapitalize="none" />
          </Field>
        </Card>
      )}

      {step === 1 && (
        <Card key="s1" className="animate-slide-in space-y-4">
          <Field label="Your story" hint="What you make, since when, what makes it special. You can let ✨ AI rewrite it later in Settings.">
            <Textarea value={f.story} onChange={set("story")} placeholder="Since 2014 I design wedding and office wear from Rwandan kitenge…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="District"><Input value={f.district} onChange={set("district")} placeholder="Gasabo" /></Field>
            <Field label="Sector"><Input value={f.sector} onChange={set("sector")} placeholder="Kimihurura" /></Field>
          </div>
          <Field label="WhatsApp number" hint="Orders arrive here too."><Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" placeholder="0788…" autoComplete="tel" /></Field>
        </Card>
      )}

      {step === 2 && (
        <div key="s2" className="animate-slide-in space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3.5 ring-1 ring-inset ring-emerald-200">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-mint-ink"><Icon name="wallet" className="size-5" /></span>
              <p className="text-sm text-mint-ink">
                <strong className="block text-[15px]">Paid directly to you</strong>
                Never held by Nyambika
              </p>
            </div>
            <Field label="MoMo merchant number" hint="Shoppers pay you here">
              <Input value={f.momoMerchant} onChange={set("momoMerchant")} inputMode="tel" placeholder="0788…" />
            </Field>
          </Card>
          <div className="overflow-hidden rounded-[26px] bg-ink text-txt shadow-[0_20px_40px_-24px_rgba(29,24,20,.7)]" aria-label="Preview of your Maker Space">
            <div className="relative h-24" style={{ background: THEMES.terra }}>
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-ink" />
            </div>
            <div className="-mt-8 flex items-end gap-3 px-4 pb-4">
              <span className="relative grid size-16 place-items-center rounded-full bg-ink font-display text-xl font-black text-gold ring-2 ring-gold">
                {f.name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
              </span>
              <div className="relative min-w-0 pb-1">
                <p className="truncate font-display text-lg font-black">{f.name || "Your page"}</p>
                <p className="truncate text-xs text-mut">{TYPES.find((x) => x.value === f.memberType)?.label} · {f.sector || f.district || "Rwanda"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <Note error={error} />
      <div className="flex gap-2">
        {step < STEPS.length - 1 ? (
          <SButton type="submit" disabled={step === 0 && !f.name.trim()} className="min-h-12 flex-1 text-base">
            Continue <Icon name="chevron" className="size-4" />
          </SButton>
        ) : (
          <SButton type="submit" disabled={busy} className="min-h-12 flex-1 text-base">{busy ? "Creating…" : "Create page"}</SButton>
        )}
      </div>
      {step === STEPS.length - 1 && (
        <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-cocoa-2">
          <Icon name="shield" className="size-4 shrink-0" /> Live after verification
          <InfoTip label="About verification">Your page goes live after the Nyambika team verifies it (ID or cooperative registration). You can add products meanwhile.</InfoTip>
        </p>
      )}
    </form>
  );
}
