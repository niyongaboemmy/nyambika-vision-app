"use client";

import { useState } from "react";
import { Empty, Field, Icon, Input, Meter, Monogram, Note, ScreenSkeleton, SButton, SectionTitle, StudioSheet, Switch } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import type { Maker } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";
import { MakerAccessPanel } from "@/components/coop-assist";

const SEATS = 25;

/** Cooperative makers (FR-COOP): list/detail cards, attribution consent, per-maker payouts. */
export default function Makers() {
  const { page } = useManagedPage();
  const { data, reload, loading } = useApi<Maker[]>(`/pages/${page.id}/makers`);
  const [f, setF] = useState({ name: "", phone: "", momoMerchant: "" });
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const active = data?.filter((m) => m.active).length ?? 0;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/pages/${page.id}/makers`, { method: "POST", json: f });
      setOk(`${f.name} added.`);
      setF({ name: "", phone: "", momoMerchant: "" });
      setAdding(false);
      await reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  async function patch(id: string, body: object) {
    await api(`/pages/${page.id}/makers/${id}`, { method: "PATCH", json: body });
    await reload();
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title={`Makers (${active}/${SEATS})`}
        eyebrow="Your cooperative"
        action={
          <SButton onClick={() => setAdding(true)} disabled={active >= SEATS}>
            <Icon name="plus" className="size-4" /> Add maker
          </SButton>
        }
      />
      <div className="st-card rounded-[22px] p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-cocoa">Active seats</span>
          <span className="font-semibold tabular-nums text-cocoa-2">{active} of {SEATS}</span>
        </div>
        <Meter value={active} max={SEATS} label="Active maker seats" />
      </div>
      <Note ok={ok} />
      {loading && !data && <ScreenSkeleton variant="list" />}
      {data?.length === 0 && (
        <Empty icon="users" title="No makers yet" action={<SButton onClick={() => setAdding(true)}>Add your first maker</SButton>}>
          Add the members who sew for your cooperative. With a phone number they can sign in and submit their own pieces.
        </Empty>
      )}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data?.map((m, i) => (
          <li key={m.id} className={`st-card animate-rise space-y-3 rounded-[24px] p-4 ${m.active ? "" : "opacity-75"}`} style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start gap-3">
              <Monogram name={m.name} size={48} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-extrabold text-cocoa">
                  {m.name}
                  {!m.active && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-cocoa-2">inactive</span>}
                </p>
                <p className="truncate text-xs text-cocoa-2">{m.phone || "no phone"} · MoMo {m.momoMerchant || "—"}</p>
              </div>
              <SButton variant={m.active ? "ghost" : "outline"} className="min-h-10 px-3" onClick={() => patch(m.id, { active: !m.active })}>{m.active ? "Deactivate" : "Activate"}</SButton>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-paper p-2.5 ring-1 ring-inset ring-hairline">
                <dt className="text-[11px] font-bold text-cocoa-2">Products</dt>
                <dd className="font-display text-lg font-black tabular-nums text-cocoa">{m.productCount}</dd>
              </div>
              <div className="rounded-2xl bg-paper p-2.5 ring-1 ring-inset ring-hairline">
                <dt className="text-[11px] font-bold text-cocoa-2">Sales</dt>
                <dd className="truncate font-display text-lg font-black tabular-nums text-cocoa">{rwf(m.salesRwf)}</dd>
              </div>
            </dl>
            <Switch
              checked={m.attributionConsent}
              onChange={(v) => patch(m.id, { attributionConsent: v })}
              label={`Show “Made by ${m.name}” to shoppers`}
              description="Only switch on when the maker has agreed."
            />
            <MakerAccessPanel pageId={page.id} maker={m} />
          </li>
        ))}
      </ul>

      <StudioSheet open={adding} onClose={() => setAdding(false)} title="Add a maker">
        <form onSubmit={add} className="space-y-4">
          <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus /></Field>
          <Field label="Phone" hint="Optional. With a phone the maker can sign in and submit their own products."><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="MoMo merchant number" hint="Used when a product pays the maker directly."><Input inputMode="tel" value={f.momoMerchant} onChange={(e) => setF({ ...f, momoMerchant: e.target.value })} /></Field>
          <Note error={err} />
          <SButton className="min-h-12 w-full">Add maker</SButton>
        </form>
      </StudioSheet>
    </div>
  );
}
