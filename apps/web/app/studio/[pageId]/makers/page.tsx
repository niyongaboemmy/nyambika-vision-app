"use client";

import { useState } from "react";
import { Card, Empty, Field, Input, Note, SButton } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import type { Maker } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

export default function Makers() {
  const { page } = useManagedPage();
  const { data, reload } = useApi<Maker[]>(`/pages/${page.id}/makers`);
  const [f, setF] = useState({ name: "", phone: "", momoMerchant: "" });
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/pages/${page.id}/makers`, { method: "POST", json: f });
      setF({ name: "", phone: "", momoMerchant: "" });
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
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Makers ({data?.filter((m) => m.active).length ?? 0}/25)</h2>
      {data?.length === 0 && <Empty>Add the members who sew for your cooperative.</Empty>}
      {data?.map((m) => (
        <Card key={m.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{m.name} {!m.active && <span className="text-xs text-stone-500">(inactive)</span>}</p>
              <p className="text-xs text-stone-500">{m.phone || "no phone"} · MoMo {m.momoMerchant || "—"} · {m.productCount} products · sales {rwf(m.salesRwf)}</p>
            </div>
            <SButton variant="outline" onClick={() => patch(m.id, { active: !m.active })}>{m.active ? "Deactivate" : "Activate"}</SButton>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={m.attributionConsent} onChange={(e) => patch(m.id, { attributionConsent: e.target.checked })} />
            Show “Made by {m.name}” to shoppers (maker consented)
          </label>
        </Card>
      ))}
      <Card>
        <form onSubmit={add} className="space-y-3">
          <h3 className="font-semibold">Add a maker</h3>
          <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone" hint="Optional. With a phone the maker can sign in and submit their own products."><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="MoMo merchant number" hint="Used when a product pays the maker directly."><Input inputMode="tel" value={f.momoMerchant} onChange={(e) => setF({ ...f, momoMerchant: e.target.value })} /></Field>
          <Note error={err} />
          <SButton className="w-full">Add maker</SButton>
        </form>
      </Card>
    </div>
  );
}
