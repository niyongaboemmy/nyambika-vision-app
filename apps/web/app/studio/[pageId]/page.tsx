"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, Icon, Kpi, Meter, ScreenSkeleton, Skeleton, type IconName } from "@/components/studio";
import { ShareSheet } from "@/components/studio-shell";
import { VoiceModeGate } from "@/components/coop-assist";
import { rwf } from "@/lib/api";
import type { OrderView } from "@/lib/orders";
import { useSession } from "@/lib/session";
import type { StudioProduct } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { NEEDS_MAKER, useManagedPage } from "./layout";
const TrendsCard = dynamic(() => import("@/components/mlspike-trends").then((m) => m.TrendsCard), { ssr: false, loading: () => <Skeleton className="h-48" /> });

// Lazy (below the fold / on demand): keeps this route's first-load JS small.
const GrowthHomeCard = dynamic(() => import("@/components/growth-insights").then((m) => m.GrowthHomeCard), { ssr: false, loading: () => <Skeleton className="h-48" /> });

interface Analytics {
  periodDays: number;
  looks: number;
  saves: number;
  orders: number;
  revenueRwf: number;
  conversion: number;
  followers: number;
  plan: { code: string; name: string; monthlyCap: number; allowanceUsed: number } | null;
  topProducts: { id: string; title: string; looks: number; orders: number }[];
}

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"];
const IN_PROGRESS = ["ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED"];
const RETAKE = ["NEEDS_BETTER_PHOTO", "NOT_SUPPORTED"];
const DAYS = 14;

/** "RWF 4.39M" on tiles (the full amount is the title); amounts under a million stay exact. */
function rwfCompact(n: number) {
  return n < 1_000_000 ? rwf(n) : `RWF ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
}

/** Daily series over the last `DAYS` days from the order list (client-side; the API returns 30-day totals). */
function daily(orders: OrderView[], pick: (o: OrderView) => number) {
  const out = new Array<number>(DAYS).fill(0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime() - (DAYS - 1) * 86400_000;
  for (const o of orders) {
    if (!PAID.includes(o.status)) continue;
    const i = Math.floor((new Date(o.createdAt).getTime() - t0) / 86400_000);
    if (i >= 0 && i < DAYS) out[i] += pick(o);
  }
  return out;
}

interface Todo {
  key: string;
  icon: IconName;
  title: string;
  hint: string;
  href?: string;
  tone: "terra" | "gold" | "violet" | "mint" | "sky";
}

const TODO_TONE: Record<Todo["tone"], string> = {
  terra: "bg-orange-100 text-terra-ink",
  gold: "bg-amber-100 text-gold-ink",
  violet: "bg-violet-100 text-violet-ink",
  mint: "bg-emerald-100 text-mint-ink",
  sky: "bg-sky-100 text-sky-800",
};

export default function Home() {
  const { page } = useManagedPage();
  const { me } = useSession();
  const manager = page.myAccess === "MANAGER";
  const base = `/studio/${page.id}`;
  const { data: a } = useApi<Analytics>(manager ? `/pages/${page.id}/analytics` : null);
  const { data: orders } = useApi<OrderView[]>(manager ? `/pages/${page.id}/orders` : null);
  const { data: products } = useApi<StudioProduct[]>(`/pages/${page.id}/products`);
  const [sharing, setSharing] = useState(false);

  const s = useMemo(() => {
    const ps = products ?? [];
    const os = orders ?? [];
    return {
      needAction: os.filter((o) => NEEDS_MAKER.includes(o.status)),
      inProgress: os.filter((o) => IN_PROGRESS.includes(o.status)),
      retake: ps.filter((p) => p.status !== "ARCHIVED" && (RETAKE.includes(p.readiness) || !p.variants.some((v) => v.image))),
      pending: ps.filter((p) => p.status === "PENDING_APPROVAL"),
      drafts: ps.filter((p) => p.status === "DRAFT"),
      thin: ps.filter((p) => p.status !== "ARCHIVED" && (p.description ?? "").trim().length < 60),
      ordersSpark: daily(os, () => 1),
      revenueSpark: daily(os, (o) => o.totalRwf),
      thumbs: new Map(ps.map((p) => [p.id, p.variants.find((v) => v.image)?.image ?? null])),
    };
  }, [products, orders]);

  const used = a?.plan ? a.plan.allowanceUsed / Math.max(1, a.plan.monthlyCap) : 0;
  const todos: Todo[] = [];
  if (page.status === "PENDING_VERIFICATION")
    todos.push({ key: "verify", icon: "shield", tone: "gold", title: "Waiting for verification", hint: "Add products meanwhile" });
  if (page.status === "PAUSED") todos.push({ key: "paused", icon: "clock", tone: "sky", title: "Your page is paused", hint: "Hidden from shoppers", href: `${base}/settings` });
  if (s.needAction.length)
    todos.push({ key: "orders", icon: "inbox", tone: "terra", title: `${s.needAction.length} ${s.needAction.length === 1 ? "order needs" : "orders need"} you`, hint: "Tap to accept", href: `${base}/orders` });
  if (s.pending.length)
    todos.push({ key: "approve", icon: "check", tone: "violet", title: `${s.pending.length} ${s.pending.length === 1 ? "piece" : "pieces"} to approve`, hint: "From your makers", href: `${base}/products` });
  if (s.retake.length)
    todos.push({ key: "retake", icon: "camera", tone: "gold", title: `${s.retake.length} ${s.retake.length === 1 ? "photo needs" : "photos need"} a retake`, hint: "Flat · daylight · plain", href: `${base}/products?filter=photo` });
  if (s.drafts.length)
    todos.push({ key: "drafts", icon: "layers", tone: "sky", title: `${s.drafts.length} ${s.drafts.length === 1 ? "draft" : "drafts"} not live yet`, hint: "Publish to go live", href: `${base}/products?filter=draft` });
  if (a?.plan && used >= 0.8)
    todos.push({ key: "allowance", icon: "alert", tone: used >= 1 ? "terra" : "gold", title: used >= 1 ? "Try-on allowance used up" : `${Math.round(used * 100)}% of allowance used`, hint: used >= 1 ? "Shoppers use their own looks" : "Upgrade plan", href: `${base}/settings#plan` });

  const loadingTodos = !products || (manager && !orders);
  const firstName = me?.name?.split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Today */}
        <section aria-labelledby="today" className="st-hero relative overflow-hidden rounded-[28px] p-5 lg:col-span-2 lg:row-span-2 lg:p-6">
          <div aria-hidden className="orb absolute -right-10 -top-10 size-40 animate-orb rounded-full opacity-20 blur-2xl" />
          <p className="relative text-sm font-bold text-terra-ink">Muraho{firstName ? `, ${firstName}` : ""} 👋</p>
          <h2 id="today" className="relative font-display text-2xl font-black tracking-tight text-cocoa lg:text-3xl">Today at {page.name}</h2>
          <ul className="relative mt-4 space-y-2">
            {loadingTodos && [0, 1].map((i) => <li key={i}><Skeleton className="h-[68px] bg-white/60" /></li>)}
            {!loadingTodos && todos.length === 0 && (
              <li className="flex items-center gap-3 rounded-2xl bg-white/75 p-3.5">
                <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-mint-ink"><Icon name="check" className="size-5" /></span>
                <span>
                  <span className="block font-extrabold text-cocoa">You&apos;re all caught up</span>
                  <span className="block text-sm text-cocoa-2">Nothing to do</span>
                </span>
              </li>
            )}
            {!loadingTodos &&
              todos.map((t, i) => {
                const body = (
                  <>
                    <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${TODO_TONE[t.tone]}`}><Icon name={t.icon} className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-extrabold text-cocoa">{t.title}</span>
                      <span className="block truncate text-sm text-cocoa-2">{t.hint}</span>
                    </span>
                    {t.href && <Icon name="chevron" className="size-5 shrink-0 text-cocoa-3" />}
                  </>
                );
                const cls = "flex items-center gap-3 rounded-2xl bg-white/80 p-3.5 shadow-[0_1px_2px_rgba(29,24,20,.05)]";
                return (
                  <li key={t.key} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                    {t.href ? <Link href={t.href} className={`st-press st-lift ${cls} hover:bg-white`}>{body}</Link> : <div className={cls}>{body}</div>}
                  </li>
                );
              })}
          </ul>
        </section>

        {/* Quick actions */}
        <section aria-label="Quick actions" className="grid grid-cols-3 gap-2 lg:col-span-1 lg:grid-cols-1">
          <Link href={`${base}/products/new`} className="st-press st-cta flex min-h-[92px] flex-col justify-between rounded-[24px] p-3.5 text-white lg:min-h-0 lg:flex-row lg:items-center lg:justify-start lg:gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-white/20"><Icon name="plus" className="size-5" /></span>
            <span className="text-sm font-extrabold leading-tight">Add product</span>
          </Link>
          <button type="button" onClick={() => setSharing(true)} className="st-card st-press flex min-h-[92px] flex-col justify-between rounded-[24px] p-3.5 text-left lg:min-h-0 lg:flex-row lg:items-center lg:justify-start lg:gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-paper-2 text-cocoa"><Icon name="qr" className="size-5" /></span>
            <span className="text-sm font-extrabold leading-tight text-cocoa">Share my page</span>
          </button>
          <Link href={`${base}/products?filter=improve`} className="st-card st-press flex min-h-[92px] flex-col justify-between rounded-[24px] p-3.5 lg:min-h-0 lg:flex-row lg:items-center lg:justify-start lg:gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-ink"><Icon name="sparkle" className="size-5" /></span>
            <span className="text-sm font-extrabold leading-tight text-cocoa">Improve listings{s.thin.length ? <span className="ml-1 font-bold text-violet-ink">({s.thin.length})</span> : null}</span>
          </Link>
        </section>

        {/* Allowance */}
        {manager && (
          <section aria-labelledby="plan-title" className="st-card rounded-[24px] p-4 lg:col-span-1">
            {a?.plan ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id="plan-title" className="font-extrabold text-cocoa">{a.plan.name} plan</h2>
                  <Link href={`${base}/settings#plan`} className="hit text-xs font-bold text-violet-ink underline-offset-2 hover:underline">Manage plan</Link>
                </div>
                <p className="mb-2 mt-0.5 text-xs text-cocoa-2">Try-ons this month</p>
                <Meter value={a.plan.allowanceUsed} max={a.plan.monthlyCap} label="Try-on allowance used" />
                <p className="mt-1.5 text-sm font-bold tabular-nums text-cocoa">
                  {a.plan.allowanceUsed} <span className="font-semibold text-cocoa-2">/ {a.plan.monthlyCap} looks</span>
                </p>
              </>
            ) : a ? (
              <>
                <h2 id="plan-title" className="font-extrabold text-cocoa">Free plan</h2>
                <p className="mt-1 text-sm text-cocoa-2">Shoppers use their own looks</p>
                <Link href={`${base}/settings#plan`} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-violet-ink">See plans</Link>
              </>
            ) : (
              <Skeleton className="h-20" />
            )}
          </section>
        )}
      </div>

      {manager && (
        <section aria-labelledby="kpi-title" className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 id="kpi-title" className="font-display text-xl font-black tracking-tight text-cocoa">Last {a?.periodDays ?? 30} days</h2>
            <span className="text-xs font-semibold text-cocoa-2">Trend: last {DAYS} days</span>
          </div>
          {!a ? (
            <ScreenSkeleton />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Paid orders" value={a.orders} spark={s.ordersSpark} tone="terra" className="xl:col-span-2" />
              <Kpi label="Revenue (to you)" value={<span title={rwf(a.revenueRwf)}>{rwfCompact(a.revenueRwf)}</span>} spark={s.revenueSpark} tone="mint" className="xl:col-span-2" />
              <Kpi label="Looks on shoppers" value={a.looks} hint={`${a.saves} saved`} tone="violet" className="xl:col-span-2" />
              <Kpi label="Look → order" value={`${(a.conversion * 100).toFixed(1)}%`} hint="Sales per try-on" className="xl:col-span-2" />
              <Kpi label="Saves" value={a.saves} className="xl:col-span-2" />
              <Kpi label="Followers" value={a.followers} className="xl:col-span-2" />
            </div>
          )}
        </section>
      )}

      {manager && <GrowthHomeCard pageId={page.id} />}
      {manager && <TrendsCard pageId={page.id} />}

      {manager && a && a.topProducts.length > 0 && (
        <section aria-labelledby="top-title" className="st-card rounded-[24px] p-4 sm:p-5">
          <h2 id="top-title" className="font-display text-lg font-black tracking-tight text-cocoa">Most tried on</h2>
          <ol className="mt-3 space-y-3">
            {a.topProducts.map((p, i) => {
              const max = Math.max(1, a.topProducts[0].looks);
              const img = s.thumbs.get(p.id);
              return (
                <li key={p.id}>
                  <Link href={`${base}/products/${p.id}`} className="st-press flex items-center gap-3 rounded-2xl p-1 hover:bg-paper">
                    <span className="w-4 text-center text-sm font-black text-cocoa-3">{i + 1}</span>
                    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-paper-2">
                      {img ? <img src={img} alt="" className="size-full object-cover" /> : <Icon name="hanger" className="size-5 text-cocoa-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-bold text-cocoa">{p.title}</span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-cocoa-2">{p.looks} looks · {p.orders} sold</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paper-2">
                        <span className="block h-full rounded-full bg-gradient-to-r from-terra to-violet" style={{ width: `${(p.looks / max) * 100}%` }} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!manager && page.memberType === "COOPERATIVE" && <VoiceModeGate pageId={page.id} />}
      {!manager && (
        <section className="st-card rounded-[24px] p-4">
          <p className="font-extrabold text-cocoa">You make for {page.name}</p>
          <p className="mt-2 flex flex-wrap gap-1.5"><Chip tone="violet"><Icon name="camera" className="size-3.5" />Clear photo</Chip><Chip tone="sky"><Icon name="check" className="size-3.5" />Admin approves</Chip><Chip tone="mint"><Icon name="users" className="size-3.5" />Credited with your OK</Chip></p>
        </section>
      )}

      <ShareSheet open={sharing} onClose={() => setSharing(false)} page={page} />
    </div>
  );
}
