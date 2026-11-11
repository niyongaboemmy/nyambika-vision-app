"use client";

import { formatMoney, type CurrencyCode } from "@nyambika/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_TABS, adminTabHref } from "../tabs";
import { Badge, Card, Chip, Field, Icon, Input, Kpi, Meter, Note, ScreenSkeleton, SButton, Segmented, Switch, Textarea } from "@/components/studio";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { Fact, InfoTip, LearnMore } from "@/components/kit";


interface Item { key: string; label: string; kind: "auto" | "manual"; done: boolean; detail: string; by?: string | null; at?: string | null }
interface Region {
  code: string;
  name: string;
  flag: string;
  currency: CurrencyCode;
  wallets: string[];
  languages: string[];
  vatRateBp: number;
  taxNote: string;
  legalEntity: string;
  storageBucket: string;
  dbSchema: string;
  launched: boolean;
  rate: string | null;
  pages: number;
  paid: { method: string; orders: number; totalMinor: number }[];
  route: { bucket: string; dbSchema: string; storagePrefix: string; database: string; applied: boolean };
  checklist: { items: Item[]; ready: boolean };
}
interface Overview {
  fx: { source: string; fetchedAt: string; stale: boolean; rates: Record<string, string> };
  residencyMode: string;
  regions: Region[];
  claims: { productId: string; version: number; title: string; page: string; madeIn: string; impactStory: string }[];
}

/** Host admin · Regions (E41): region switcher, country launch checklist, residency routes, FX and claim checks. */
export default function RegionsAdmin() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me?.isHost) router.replace("/signin?next=/admin/regions");
  }, [loading, me, router]);
  const { data, reload } = useApi<Overview>(me?.isHost ? "/admin/regions" : null);
  const [code, setCode] = useState("KE");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!me?.isHost) return null;
  const r = data?.regions.find((x) => x.code === code);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <AdminShell tabs={ADMIN_TABS} tab="Regions" onTab={(t) => t !== "Regions" && router.push(adminTabHref(t))}>
      {!data || !r ? (
        <ScreenSkeleton />
      ) : (
        <>
          <div className="-mt-2 flex flex-wrap items-center gap-2">
            <Fact icon="globe">EAC launch prep</Fact>
            <Fact icon="wallet">Paid directly · local currency</Fact>
            <LearnMore>Prepare each EAC country before launch. Makers are paid directly in their own currency; Nyambika never collects. Residency routes decide where a country&apos;s data will live.</LearnMore>
          </div>
          <Segmented label="Region" value={code} onChange={setCode} options={data.regions.map((x) => ({ value: x.code, label: `${x.flag} ${x.name}` }))} />
          <Note error={err} ok={msg} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Status" value={r.launched ? "Live" : "Pilot prep"} tone={r.launched ? "mint" : "gold"} hint={r.checklist.ready ? "Checklist complete" : `${r.checklist.items.filter((i) => i.done).length}/${r.checklist.items.length} checks`} />
            <Kpi label="Maker pages" value={r.pages} tone="violet" />
            <Kpi label={`Paid · ${r.currency}`} value={formatMoney(r.paid.reduce((a, p) => a + p.totalMinor, 0), r.currency)} hint={r.paid.map((p) => `${p.orders} ${p.method}`).join(" · ") || "no orders yet"} tone="terra" />
            <Kpi label="FX (per USD)" value={r.rate ? `${r.rate} ${r.currency}` : "—"} hint={`${data.fx.source}${data.fx.stale ? " · stale" : ""}`} warn={data.fx.stale} tone="mint" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-black tracking-tight">Launch checklist · {r.name}</h2>
                <Badge value={r.checklist.ready ? "READY" : "DRAFT"} label={r.checklist.ready ? "ready" : "in progress"} />
              </div>
              <Meter value={r.checklist.items.filter((i) => i.done).length} max={r.checklist.items.length} label="Checklist progress" />
              <ul className="divide-y divide-hairline">
                {r.checklist.items.map((i) => {
                  // "Label (examples…)" → short label; the parenthetical moves into an ⓘ.
                  const [head, extra] = i.label.includes(" (") ? [i.label.slice(0, i.label.indexOf(" (")), i.label.slice(i.label.indexOf(" (") + 2, -1)] : [i.label, ""];
                  return (
                    <li key={i.key} className="flex min-h-12 items-center gap-3 py-2">
                      {i.kind === "auto" ? (
                        <>
                          <span className={`grid size-6 shrink-0 place-items-center rounded-full ${i.done ? "bg-mint-ink text-white" : "bg-paper-2 text-cocoa-3 ring-1 ring-inset ring-hairline"}`}>{i.done ? <Icon name="check" className="size-3.5" /> : <Icon name="clock" className="size-3.5" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold">{head}</span>
                            <span className="block truncate text-xs text-cocoa-2">Auto · {i.detail}</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1 [&>label]:min-h-11 [&>label]:items-center">
                            <Switch checked={i.done} onChange={(v) => run(() => api(`/admin/regions/${r.code}/checklist`, { method: "POST", json: { item: i.key, done: v } }), v ? `Signed off: ${i.label}` : `Reopened: ${i.label}`)} label={head} description={i.done && i.by ? `Signed off by ${i.by}${i.at ? ` · ${new Date(i.at).toLocaleDateString("en-GB")}` : ""}` : undefined} />
                          </div>
                          {extra && <InfoTip label={`About ${head}`}>{extra}</InfoTip>}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {r.code !== "RW" && (
                <SButton className="w-full" variant={r.launched ? "outline" : "primary"} disabled={!r.launched && !r.checklist.ready} onClick={() => run(() => api(`/admin/regions/${r.code}/launch`, { method: "POST", json: { launched: !r.launched } }), r.launched ? `${r.name} paused` : `${r.name} launched`)}>
                  {r.launched ? `Pause ${r.name}` : r.checklist.ready ? `Launch ${r.name}` : "Complete the checklist to launch"}
                </SButton>
              )}
            </Card>

            <div className="space-y-4">
              <ConfigCard key={r.code} r={r} onSave={(json) => run(() => api(`/admin/regions/${r.code}`, { method: "PATCH", json }), "Country config saved (audit-logged)")} />
              <Card className="space-y-2">
                <h2 className="flex items-center gap-1 font-display text-lg font-black tracking-tight">Data residency<InfoTip label="About data residency">Routing seam only: separate regional databases are not provisioned yet (ADR-0006).</InfoTip></h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-cocoa-2">Bucket</dt><dd className="font-mono">{r.route.bucket}</dd>
                  <dt className="text-cocoa-2">DB schema</dt><dd className="font-mono">{r.route.dbSchema}</dd>
                  <dt className="text-cocoa-2">Database</dt><dd>{r.route.database === "regional" ? "Regional (DATABASE_URL_" + r.code + ")" : "Home (shared)"}</dd>
                  <dt className="text-cocoa-2">Storage</dt><dd>{r.route.applied ? <span className="font-mono">{r.route.storagePrefix}</span> : `Home store (RESIDENCY_MODE=${data.residencyMode})`}</dd>
                </dl>
                
              </Card>
              <Card className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-black tracking-tight">FX rates</h2>
                  <SButton variant="soft" onClick={() => run(() => api("/admin/regions/fx/refresh", { method: "POST" }), "Rates refreshed")}><Icon name="refresh" className="size-4" /> Refresh</SButton>
                </div>
                <p className="text-xs text-cocoa-2">{data.fx.source === "dev-fixed-synthetic" ? "Synthetic" : data.fx.source} · {new Date(data.fx.fetchedAt).toLocaleString("en-GB")} · display only</p>
                <div className="flex flex-wrap gap-1.5">{Object.entries(data.fx.rates).map(([c, v]) => <Chip key={c}>1 USD = {v} {c}</Chip>)}</div>
              </Card>
            </div>
          </div>

          <Card className="space-y-2">
            <h2 className="font-display text-lg font-black tracking-tight">Passport claims to verify</h2>
            {data.claims.length === 0 ? <p className="text-sm text-cocoa-2">Nothing waiting.</p> : (
              <ul className="divide-y divide-hairline">
                {data.claims.map((c) => (
                  <li key={c.productId} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{c.title} · {c.page}</span><span className="block truncate text-xs text-cocoa-2">{c.madeIn}{c.impactStory ? ` · “${c.impactStory}”` : ""}</span></span>
                    <Link href={`/p/${c.productId}`} className="st-press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-2xl px-2 text-sm font-bold text-violet-ink hover:bg-paper-2">Review <Icon name="chevron" className="size-4" /></Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </AdminShell>
  );
}

function ConfigCard({ r, onSave }: { r: Region; onSave: (json: object) => void }) {
  const [tax, setTax] = useState(r.taxNote);
  const [legal, setLegal] = useState(r.legalEntity);
  const [vat, setVat] = useState(String(r.vatRateBp / 100));
  const dirty = tax !== r.taxNote || legal !== r.legalEntity || Number(vat) * 100 !== r.vatRateBp;
  return (
    <Card className="space-y-3">
      <h2 className="font-display text-lg font-black tracking-tight">Country config</h2>
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="violet">{r.currency}</Chip>
        {r.wallets.map((w) => <Chip key={w} tone="mint">{w.replace("_", " ")}</Chip>)}
        {r.languages.map((l) => <Chip key={l}>{l}{l === "sw" ? " · machine-drafted" : ""}</Chip>)}
      </div>
      <Field label="VAT rate (%)"><Input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
      <Field label="Tax / VAT note" hint="Shown at checkout · “Draft” until counsel approves"><Textarea value={tax} onChange={(e) => setTax(e.target.value)} className="min-h-20" /></Field>
      <Field label="Legal entity text"><Textarea value={legal} onChange={(e) => setLegal(e.target.value)} className="min-h-20" /></Field>
      <SButton variant="dark" disabled={!dirty} onClick={() => onSave({ taxNote: tax, legalEntity: legal, vatRateBp: Math.round(Number(vat) * 100) })}>Save config</SButton>
    </Card>
  );
}
