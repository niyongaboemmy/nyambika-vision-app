"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiWrite } from "@/components/ai-write";
import { Field, Icon, Input, Note, SButton, Select, Steps, Switch, Textarea, TogglePills } from "@/components/studio";
import { EDITOR_STEPS, EditorSection, ProductPreview } from "@/components/studio-product";
import { api } from "@/lib/api";
import { CATEGORIES, type Maker, OCCASIONS, STYLES } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../../layout";

interface VariantDraft {
  colourName: string;
  colourHex: string;
  stock: number;
}


/** Guided product editor, steps 1–2 (details, colours & sizes); photos and publish follow on the product page. */
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
  const step = f.title && f.priceRwf ? 1 : 0;

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
      navigator.vibrate?.(12);
      router.push(`/studio/${page.id}/products/${p.id}?new=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const preview = (
    <ProductPreview
      title={f.title}
      priceRwf={Number(f.priceRwf) || 0}
      colours={variants.map((v) => ({ name: v.colourName, hex: v.colourHex }))}
      madeToOrder={f.madeToOrder}
      leadTimeDays={Number(f.leadTimeDays)}
      pageName={page.name}
      theme={page.theme}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/studio/${page.id}/products`} aria-label="Back to products" className="st-press grid size-11 shrink-0 place-items-center rounded-full bg-white text-cocoa ring-1 ring-inset ring-hairline">
          <Icon name="back" className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-terra-ink">Add product</p>
          <h2 className="font-display text-2xl font-black tracking-tight text-cocoa">New product</h2>
        </div>
      </div>
      <Steps steps={EDITOR_STEPS} current={step} label="Product steps" />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={submit} className="space-y-4">
          <div className="lg:hidden">
            <ProductPreview
              compact
              title={f.title}
              priceRwf={Number(f.priceRwf) || 0}
              colours={variants.map((v) => ({ name: v.colourName, hex: v.colourHex }))}
              madeToOrder={f.madeToOrder}
              leadTimeDays={Number(f.leadTimeDays)}
              pageName={page.name}
              theme={page.theme}
            />
          </div>

          <EditorSection n={1} id="details" title="Details" hint="What it is and what it costs. Let ✨ AI draft the words.">
            <Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Indigo wrap dress" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Price (RWF)"><Input required inputMode="numeric" value={f.priceRwf} onChange={(e) => setF({ ...f, priceRwf: e.target.value.replace(/\D/g, "") })} placeholder="35000" /></Field>
            </div>
            <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Fabric, fit, how to wear it…" /></Field>
            <AiWrite<{ title: string; description: string }>
              pageId={page.id}
              kind="product"
              fields={() => ({ category: f.category, colours: variants.map((v) => v.colourName).filter(Boolean), occasions, styles, fabric: f.fabric, madeToOrder: f.madeToOrder, leadTimeDays: f.leadTimeDays, makerName: page.name })}
              onResult={(r) => setF((x) => ({ ...x, title: x.title || r.title, description: r.description }))}
            />
            <Field label="Fabric"><Input value={f.fabric} onChange={(e) => setF({ ...f, fabric: e.target.value })} placeholder="Cotton kitenge (wax print)" /></Field>
          </EditorSection>

          <EditorSection n={2} id="colours" title="Colours & sizes" hint="Each colour gets its own photo in the next step.">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-[13px] font-bold text-cocoa">Colours</legend>
              {variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl bg-paper p-2 ring-1 ring-inset ring-hairline">
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-hairline" style={{ background: v.colourHex }}>
                    <input aria-label="Colour" type="color" value={v.colourHex} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, colourHex: e.target.value } : x)))} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                  </span>
                  <Input aria-label="Colour name" required placeholder="Indigo" value={v.colourName} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, colourName: e.target.value } : x)))} className="min-w-0 flex-1" />
                  {!f.madeToOrder && <Input aria-label="Stock" type="number" min={0} value={v.stock} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, stock: Number(e.target.value) } : x)))} className="w-20 shrink-0" />}
                  {variants.length > 1 && (
                    <button type="button" aria-label={`Remove colour ${v.colourName || i + 1}`} onClick={() => setVariants(variants.filter((_, j) => j !== i))} className="st-press grid size-10 shrink-0 place-items-center rounded-full text-cocoa-2 hover:bg-white">
                      <Icon name="x" className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <SButton type="button" variant="soft" onClick={() => setVariants([...variants, { colourName: "", colourHex: "#2b4ea2", stock: 0 }])}>
                <Icon name="plus" className="size-4" /> Add colour
              </SButton>
            </fieldset>
            <Field group label="Sizes"><TogglePills all={["XS", "S", "M", "L", "XL", "XXL"]} on={sizes} toggle={(v) => toggle(sizes, setSizes, v)} /></Field>
            <div className="space-y-3 rounded-2xl bg-paper p-3.5 ring-1 ring-inset ring-hairline">
              <Switch checked={f.madeToOrder} onChange={(v) => setF({ ...f, madeToOrder: v })} label="Made to order" description="Sewn after payment" />
              <Field label="Lead time (days)"><Input type="number" min={0} max={90} value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: Number(e.target.value) })} className="w-28" /></Field>
            </div>
          </EditorSection>

          <EditorSection n={3} id="fit" title="Where it fits" hint="Muse uses these to put your piece in the right shopper's looks.">
            <Field group label="Occasions"><TogglePills all={OCCASIONS} on={occasions} toggle={(v) => toggle(occasions, setOccasions, v)} /></Field>
            <Field group label="Style"><TogglePills all={STYLES} on={styles} toggle={(v) => toggle(styles, setStyles, v)} /></Field>
          </EditorSection>

          {page.memberType === "COOPERATIVE" && makers && (
            <EditorSection n={4} id="maker" title="Maker & payout">
              <Field group label="Made by" hint="Shown as “Made by <name>, <cooperative>” when the maker consents.">
                <TogglePills all={makers.filter((m) => m.active).map((m) => m.id)} labels={Object.fromEntries(makers.map((m) => [m.id, m.name]))} on={makerIds} toggle={(v) => toggle(makerIds, setMakerIds, v)} />
              </Field>
              <Field label="Payment goes to" hint="Either way the shopper pays directly; Nyambika never holds the money.">
                <Select value={f.payoutTarget} onChange={(e) => setF({ ...f, payoutTarget: e.target.value })}>
                  <option value="PAGE">Shared cooperative account</option>
                  <option value="MAKER">The maker&apos;s own MoMo account</option>
                </Select>
              </Field>
            </EditorSection>
          )}

          <Note error={error} />
          <SButton disabled={busy} className="min-h-12 w-full text-base">
            {busy ? "Saving…" : "Save and add photos"} {!busy && <Icon name="chevron" className="size-4" />}
          </SButton>
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-cocoa-2"><Icon name="lock" className="size-3.5" />Saved as draft · not public</p>
        </form>
        <aside className="sticky top-28 hidden space-y-3 lg:block" aria-label="Live preview">
          {preview}
          <p className="px-1 text-xs font-semibold text-cocoa-2">How shoppers see it</p>
        </aside>
      </div>
    </div>
  );
}
