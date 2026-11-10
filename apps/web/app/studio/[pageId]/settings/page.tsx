"use client";

import { useState } from "react";
import { Card, Field, Input, Note, SButton, Select, Textarea } from "@/components/studio";
import { api } from "@/lib/api";
import { useManagedPage } from "../layout";

export default function Settings() {
  const { page, reload } = useManagedPage();
  const [f, setF] = useState({
    name: page.name,
    story: page.story,
    district: page.district,
    sector: page.sector,
    whatsapp: page.whatsapp,
    instagram: page.instagram,
    theme: page.theme,
    momoMerchant: page.momoMerchant,
    allowanceOn: page.allowanceOn,
  });
  const [staffPhone, setStaffPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg(ok);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const isOwner = true;
  const staff = page.roles.filter((r) => r.role === "PAGE_STAFF");

  return (
    <div className="space-y-4">
      <Note error={err} ok={msg} />
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api(`/pages/${page.id}`, { method: "PATCH", json: f }), "Page saved.");
          }}
        >
          <h2 className="font-bold">Page profile</h2>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Story"><Textarea value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="District"><Input value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></Field>
            <Field label="Sector"><Input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="WhatsApp"><Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></Field>
            <Field label="Instagram"><Input value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} /></Field>
          </div>
          <Field label="Theme">
            <Select value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })}>
              <option value="terra">Terracotta</option>
              <option value="indigo">Indigo</option>
              <option value="forest">Forest</option>
              <option value="violet">Violet</option>
            </Select>
          </Field>
          <Field label="MoMo merchant number" hint="Hold-to-buy payments go straight to this account."><Input value={f.momoMerchant} onChange={(e) => setF({ ...f, momoMerchant: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.allowanceOn} onChange={(e) => setF({ ...f, allowanceOn: e.target.checked })} />
            Let shoppers use my plan's try-on allowance after their free looks
          </label>
          <SButton className="w-full">Save</SButton>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Visibility</h2>
        <p className="text-sm text-stone-600">Pause your page while you're away. Nothing is deleted.</p>
        <div className="flex gap-2">
          {page.status === "PUBLISHED" && <SButton variant="outline" onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PAUSED" } }), "Page paused.")}>Pause page</SButton>}
          {page.status !== "PUBLISHED" && <SButton onClick={() => run(() => api(`/pages/${page.id}/status`, { method: "POST", json: { status: "PUBLISHED" } }), "Page is live.")}>Publish page</SButton>}
        </div>
      </Card>

      {isOwner && (
        <Card className="space-y-3">
          <h2 className="font-bold">Staff</h2>
          {staff.length === 0 && <p className="text-sm text-stone-500">No staff yet.</p>}
          {staff.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{s.user.name ?? s.user.phone}</span>
              <SButton variant="ghost" onClick={() => run(() => api(`/pages/${page.id}/staff/${s.userId}`, { method: "DELETE" }), "Staff removed.")}>Remove</SButton>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`/pages/${page.id}/staff`, { method: "POST", json: { phone: staffPhone } }), "Staff added.");
              setStaffPhone("");
            }}
          >
            <Input placeholder="Staff phone" inputMode="tel" value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} />
            <SButton>Invite</SButton>
          </form>
        </Card>
      )}
    </div>
  );
}
