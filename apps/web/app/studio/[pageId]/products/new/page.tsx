"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, Field, Input, Note, SButton, Select, Textarea } from "@/components/studio";
import { api } from "@/lib/api";
import { CATEGORIES, type Maker, OCCASIONS, STYLES } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../../layout";

interface VariantDraft {
  colourName: string;
  colourHex: string;
  stock: number;
}

export default function NewProduct() {
  const { page } = useManagedPage();
  const router = useRouter();
  const isCoop = page.memberType === "COOPERATIVE";
  const { data: makers } = useApi<Maker[]>(isCoop ? `/pages/${page.id}/makers` : null);
  const [f, setF] = useState({
    title: "",
    description: "",
    category: "dress",
    priceRwf: "",
    madeToOrder: page.memberType === "TAILOR",
    leadTimeDays: page.memberType === "TAILOR" ? 4 : 1,
    fabric: "",
    payoutTarget: "PAGE",
  });
  const [occasions, setOccasions] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [makerIds, setMakerIds] = useState<string[]>([]);
  const [sizes, setSizes] = useState(["S", "M", "L", "XL"]);
  const [variants, setVariants] = useState<VariantDraft[]>([{ colourName: "", colourHex: "#c8553d", stock: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ id: string }>(`/pages/${page.id}/products`, {
        method: "POST",
        json: {
          ...f,
          priceRwf: Number(f.priceRwf),
          leadTimeDays: Number(f.leadTimeDays),
          occasions,
          styles,
          makerIds,
          variants: variants.map((v) => ({ ...v, stock: Number(v.stock), sizes })),
        },
      });
      router.push(`/studio/${page.id}/products/${p.id}?new=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-bold">New product</h2>
        <Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Indigo wrap dress" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Price (RWF)"><Input required inputMode="numeric" value={f.priceRwf} onChange={(e) => setF({ ...f, priceRwf: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Fabric"><Input value={f.fabric} onChange={(e) => setF({ ...f, fabric: e.target.value })} placeholder="Cotton kitenge (wax print)" /></Field>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={f.madeToOrder} onChange={(e) => setF({ ...f, madeToOrder: e.target.checked })} className="size-5" />
            Made to order
          </label>
          <Field label="Lead time (days)"><Input type="number" min={0} max={90} value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: Number(e.target.value) })} className="w-24" /></Field>
        </div>
        <Field group label="Occasions"><Toggles all={OCCASIONS} on={occasions} toggle={(v) => toggle(occasions, setOccasions, v)} /></Field>
        <Field group label="Style"><Toggles all={STYLES} on={styles} toggle={(v) => toggle(styles, setStyles, v)} /></Field>
        <Field group label="Sizes"><Toggles all={["XS", "S", "M", "L", "XL", "XXL"]} on={sizes} toggle={(v) => toggle(sizes, setSizes, v)} /></Field>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Colours</p>
          {variants.map((v, i) => (
            <div key={i} className="flex items-end gap-2">
              <input aria-label="Colour" type="color" value={v.colourHex} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, colourHex: e.target.value } : x)))} className="h-11 w-12 rounded-lg border border-stone-300" />
              <Input aria-label="Colour name" required placeholder="Indigo" value={v.colourName} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, colourName: e.target.value } : x)))} />
              {!f.madeToOrder && <Input aria-label="Stock" type="number" min={0} value={v.stock} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, stock: Number(e.target.value) } : x)))} className="w-20" />}
              {variants.length > 1 && <SButton type="button" variant="ghost" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>✕</SButton>}
            </div>
          ))}
          <SButton type="button" variant="outline" onClick={() => setVariants([...variants, { colourName: "", colourHex: "#2b4ea2", stock: 0 }])}>+ Add colour</SButton>
        </div>

        {page.memberType === "COOPERATIVE" && makers && (
          <>
            <Field group label="Made by" hint="Shown as “Made by <name>, <cooperative>” when the maker consents.">
              <Toggles all={makers.filter((m) => m.active).map((m) => m.id)} labels={Object.fromEntries(makers.map((m) => [m.id, m.name]))} on={makerIds} toggle={(v) => toggle(makerIds, setMakerIds, v)} />
            </Field>
            <Field label="Payment goes to">
              <Select value={f.payoutTarget} onChange={(e) => setF({ ...f, payoutTarget: e.target.value })}>
                <option value="PAGE">Shared cooperative account</option>
                <option value="MAKER">The maker's own MoMo account</option>
              </Select>
            </Field>
          </>
        )}
        <Note error={error} />
        <SButton disabled={busy} className="w-full">Save and add photos</SButton>
      </form>
    </Card>
  );
}

function Toggles({ all, on, toggle, labels }: { all: string[]; on: string[]; toggle: (v: string) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((v) => (
        <button key={v} type="button" onClick={() => toggle(v)} className={`rounded-full border px-3 py-1.5 text-sm ${on.includes(v) ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}>
          {labels?.[v] ?? v.replace(/-/g, " ")}
        </button>
      ))}
    </div>
  );
}
