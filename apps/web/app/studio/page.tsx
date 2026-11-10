"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Card, Field, Input, Note, SButton, Select, Textarea } from "@/components/studio";
import { api } from "@/lib/api";
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

export default function StudioHome() {
  const { data: pages, loading, reload } = useApi<MyPage[]>("/pages/mine/list");
  const [creating, setCreating] = useState(false);
  if (loading) return <p className="text-stone-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your pages</h1>
      {pages?.map((p) => (
        <Link key={p.id} href={`/studio/${p.id}`} className="block">
          <Card className="flex items-center justify-between gap-3 transition hover:border-stone-400">
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="text-sm text-stone-500">nyambika.rw/{p.handle} · {p.memberType.toLowerCase()} · {p.role.replace("_", " ").toLowerCase()}</p>
            </div>
            <Badge value={p.status} />
          </Card>
        </Link>
      ))}
      {pages && pages.length === 0 && !creating && (
        <Card className="space-y-3 text-center">
          <p className="text-stone-600">You don't manage a page yet. Tailors, cooperatives and sellers each get their own page.</p>
          <SButton onClick={() => setCreating(true)}>Create my page</SButton>
        </Card>
      )}
      {creating && <CreatePage onDone={reload} />}
    </div>
  );
}

function CreatePage({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { reload } = useSession();
  const [f, setF] = useState({ name: "", handle: "", memberType: "TAILOR", story: "", district: "", sector: "", whatsapp: "", momoMerchant: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value, ...(k === "name" && !s.handle ? {} : {}) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const handle = f.handle || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const page = await api<{ id: string }>("/pages", { method: "POST", json: { ...f, handle } });
      await reload();
      onDone();
      router.push(`/studio/${page.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-bold">Create your page</h2>
        <Field label="Page name"><Input required value={f.name} onChange={set("name")} placeholder="Uwase Couture" /></Field>
        <Field label="Page address" hint={`nyambika.rw/${f.handle || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "your-name"}`}>
          <Input value={f.handle} onChange={set("handle")} placeholder="uwase-couture" pattern="[a-z0-9-]{3,40}" />
        </Field>
        <Field label="I am a">
          <Select value={f.memberType} onChange={set("memberType")}>
            <option value="TAILOR">Tailor</option>
            <option value="COOPERATIVE">Sewing cooperative</option>
            <option value="SELLER">Seller</option>
          </Select>
        </Field>
        <Field label="Your story" hint="What you make, since when, what makes it special."><Textarea value={f.story} onChange={set("story")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="District"><Input value={f.district} onChange={set("district")} placeholder="Gasabo" /></Field>
          <Field label="Sector"><Input value={f.sector} onChange={set("sector")} placeholder="Kimihurura" /></Field>
        </div>
        <Field label="WhatsApp number"><Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" placeholder="0788…" /></Field>
        <Field label="MoMo merchant number" hint="Shoppers pay you directly here. Nyambika never holds your money.">
          <Input value={f.momoMerchant} onChange={set("momoMerchant")} inputMode="tel" />
        </Field>
        <Note error={error} />
        <SButton disabled={busy} className="w-full">Create page</SButton>
        <p className="text-xs text-stone-500">Your page goes live after the Nyambika team verifies it (ID or cooperative registration).</p>
      </form>
    </Card>
  );
}
