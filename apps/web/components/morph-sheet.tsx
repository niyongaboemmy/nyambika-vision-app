"use client";

import { morphPrice, quantizeHue, type MorphLength, type MorphSleeve, type MorphSpec } from "@nyambika/contracts";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { AskTailorSheet } from "@/components/ask-tailor";
import { Sheet } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";
import { hueColour, type MorphRenderView, type MorphTemplateView } from "@/lib/tailor";

const templates = new Map<string, Promise<MorphTemplateView | null>>();
function loadTemplate(productId: string) {
  if (!templates.has(productId)) templates.set(productId, api<MorphTemplateView>(`/morph/templates/${productId}`).catch(() => null));
  return templates.get(productId)!;
}

/**
 * Right-rail action on a look (E23/E24): "Morph" on tailor templates, "Sew" on any other
 * made-to-order tailor piece. Renders nothing otherwise. Owns its sheets so look-view stays lean.
 */
export function MorphRail({ look }: { look: Look }) {
  const { t } = useSession();
  const [tpl, setTpl] = useState<MorphTemplateView | null>(null);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    let live = true;
    void loadTemplate(look.product.id).then((v) => live && setTpl(v));
    return () => {
      live = false;
    };
  }, [look.product.id]);
  const sewable = look.maker.memberType === "TAILOR" && look.product.madeToOrder;
  if (!tpl?.customizable && !sewable) return null;
  return (
    <>
      <button onClick={() => (tpl?.customizable ? setOpen(true) : setAsk(true))} className="flex flex-col items-center gap-1 text-xs font-semibold">
        <span className="glass grid size-12 place-items-center rounded-full text-xl" aria-hidden>
          {tpl?.customizable ? <span className="size-6 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] shadow-[0_0_12px_rgba(255,255,255,.35)]" /> : "✂️"}
        </span>
        {tpl?.customizable ? t("morph.action") : t("morph.sew")}
      </button>
      {tpl?.customizable && open && <MorphSheet look={look} tpl={tpl} onClose={() => setOpen(false)} />}
      {!tpl?.customizable && (
        <AskTailorSheet
          open={ask}
          onClose={() => setAsk(false)}
          request={{ pageId: look.maker.pageId, makerName: look.maker.name, productId: look.product.id, variantId: look.variant.id, title: look.product.title, sizes: look.variant.sizes, estimateRwf: look.product.priceRwf, image: look.image, renderId: null, spec: null, colour: look.variant.colourName }}
        />
      )}
    </>
  );
}

const LABEL: Record<string, string> = { mini: "Mini", knee: "Knee", midi: "Midi", maxi: "Maxi", sleeveless: "None", short: "Short", elbow: "Elbow", long: "Long" };

function MorphSheet({ look, tpl, onClose }: { look: Look; tpl: MorphTemplateView; onClose: () => void }) {
  const { t } = useSession();
  const o = tpl.options!;
  const [hue, setHue] = useState<number | null>(null);
  const [length, setLength] = useState<MorphLength>(o.baseLength);
  const [sleeve, setSleeve] = useState<MorphSleeve>(o.baseSleeve);
  const [render, setRender] = useState<MorphRenderView | null>(null);
  const [shown, setShown] = useState<string | null>(look.image);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const seq = useRef(0);
  const variantId = tpl.variants?.some((v) => v.id === look.variant.id) ? look.variant.id : (tpl.variants?.[0]?.id ?? look.variant.id);
  const spec: MorphSpec = { hue: hue === null ? null : quantizeHue(hue), length, sleeve };
  const price = safePrice(tpl, spec);
  const extra = price - (tpl.basePriceRwf ?? 0);

  // Debounced live preview; keeps the previous image on screen while the next one renders.
  const specKey = `${spec.hue}|${length}|${sleeve}`;
  useEffect(() => {
    const untouched = spec.hue === null && length === o.baseLength && sleeve === o.baseSleeve;
    if (untouched && !render) return;
    const my = ++seq.current;
    setBusy(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        let r = await api<MorphRenderView>("/morph/preview", { method: "POST", json: { productId: tpl.productId, variantId, spec } });
        for (let i = 0; i < 80 && my === seq.current && !["DELIVERED", "WITHHELD", "FAILED"].includes(r.status); i++) {
          await new Promise((ok) => setTimeout(ok, 450));
          r = { ...r, ...(await api<MorphRenderView>(`/morph/renders/${r.renderId}`)) };
        }
        if (my !== seq.current) return;
        setRender(r);
        if (r.image) setShown(r.image);
        else if (r.status !== "DELIVERED") setError(r.status === "WITHHELD" ? "This combination didn't pass our quality check. Try another." : "Couldn't render that one. Try again.");
      } catch (e) {
        if (my === seq.current) setError((e as Error).message);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  return (
    <Sheet open onClose={onClose}>
      <div className="-mt-2 flex items-center justify-between gap-2">
        <span className="glass rounded-2xl px-3 py-1.5 text-sm font-semibold">🎨 {t("morph.title")} · {tpl.maker?.name}</span>
        <button onClick={onClose} aria-label="Close" className="glass grid size-9 place-items-center rounded-full">✕</button>
      </div>

      <ColourRing hue={hue} onChange={setHue} busy={busy}>
        {shown ? (
          <img src={shown} alt={`${look.product.title}, live morph preview (AI)`} className={`h-full w-full object-contain transition duration-300 ${busy ? "opacity-80 saturate-75" : ""}`} draggable={false} />
        ) : (
          <div className="h-full w-full rounded-full skeleton" />
        )}
      </ColourRing>
      <div className="mt-1 flex items-center justify-center gap-2 text-xs text-mut" aria-live="polite">
        {busy ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 animate-ping rounded-full bg-gold" /> Rendering on {look.onTwin ? "your twin" : "the AI model"}…</span> : <span>{t("morph.colourHint")}</span>}
        {hue !== null && (
          <button onClick={() => setHue(null)} className="rounded-full border border-white/20 px-2 py-0.5 font-semibold text-txt">Original colour</button>
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-center text-xs text-red-200">{error}</p>}

      <div className="glass mt-3 space-y-3 rounded-3xl p-3.5">
        {(tpl.lengths?.length ?? 0) > 1 && <Segmented legend={t("morph.length")} value={length} options={tpl.lengths!} onChange={(v) => setLength(v as MorphLength)} delta={(k) => o.lengths[k as MorphLength] ?? 0} />}
        {(tpl.sleeves?.length ?? 0) > 1 && <Segmented legend={t("morph.sleeves")} value={sleeve} options={tpl.sleeves!} onChange={(v) => setSleeve(v as MorphSleeve)} delta={(k) => o.sleeves[k as MorphSleeve] ?? 0} />}
      </div>

      <button onClick={() => setAsk(true)} className="mt-3 flex w-full items-center gap-3 rounded-3xl border border-white/15 bg-[linear-gradient(120deg,rgba(224,112,63,.28),rgba(139,92,246,.22))] p-3.5 text-left transition active:scale-[.99]">
        <span className="text-2xl" aria-hidden>🪡</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-black">{t("morph.ask").replace("{maker}", tpl.maker?.name.split(" ")[0] ?? "the tailor")}</span>
          <span className="block text-sm text-txt/80">
            {rwf(price)}{extra > 0 ? ` · +${rwf(extra)}` : ""} · ready in {o.leadTimeDays} days · uses your measurements
          </span>
        </span>
        <span aria-hidden className="text-xl">→</span>
      </button>

      <AskTailorSheet
        open={ask}
        onClose={() => setAsk(false)}
        request={{
          pageId: tpl.maker!.pageId,
          makerName: tpl.maker!.name,
          productId: tpl.productId,
          variantId,
          title: look.product.title,
          sizes: look.variant.sizes,
          estimateRwf: price,
          image: render?.image ?? shown,
          renderId: render?.status === "DELIVERED" ? render.renderId : null,
          spec,
          colour: look.variant.colourName,
        }}
      />
    </Sheet>
  );
}

function safePrice(tpl: MorphTemplateView, spec: MorphSpec) {
  try {
    return morphPrice(tpl.basePriceRwf ?? 0, tpl.options!, spec).totalRwf;
  } catch {
    return tpl.basePriceRwf ?? 0;
  }
}

/** Draggable hue ring (any hue). Pointer drag, tap, or arrow keys (±15°) on the knob. */
function ColourRing({ hue, onChange, busy, children }: { hue: number | null; onChange: (h: number) => void; busy: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef<number | null>(null);
  const fromPointer = useCallback(
    (e: RPointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      const q = quantizeHue(h);
      if (q !== last.current) {
        last.current = q;
        navigator.vibrate?.(4);
      }
      onChange(h);
    },
    [onChange],
  );
  const shown = hue ?? 0;
  const a = ((shown - 90) * Math.PI) / 180;
  return (
    <div
      ref={ref}
      className="relative mx-auto mt-3 aspect-square w-full max-w-[340px] touch-none select-none"
      onPointerDown={(e) => {
        // Grab on the ring band or the knob (not the preview in the middle).
        const r = ref.current!.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / (r.width / 2);
        if (d < 0.7) return;
        dragging.current = true;
        ref.current!.setPointerCapture?.(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, hsl(0 80% 52%), hsl(60 80% 52%), hsl(120 80% 45%), hsl(180 80% 45%), hsl(240 80% 58%), hsl(300 80% 55%), hsl(360 80% 52%))",
          mask: "radial-gradient(circle closest-side, transparent 85%, #000 86%, #000 99%, transparent 100%)",
          WebkitMask: "radial-gradient(circle closest-side, transparent 85%, #000 86%, #000 99%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-[9%] overflow-hidden rounded-full">{children}</div>
      {busy && <div className="pointer-events-none absolute inset-[9%] rounded-full ring-2 ring-gold/40 motion-safe:animate-pulse" />}
      <button
        role="slider"
        aria-label="Colour"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={hue === null ? "Original colour" : `Hue ${Math.round(shown)} degrees`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((quantizeHue(shown) + 15) % 360);
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((quantizeHue(shown) + 345) % 360);
        }}
        className={`absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-white shadow-[0_0_0_2px_rgba(0,0,0,.35),0_6px_18px_rgba(0,0,0,.5)] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${hue === null ? "opacity-70" : ""}`}
        style={{ left: `${50 + Math.cos(a) * 46}%`, top: `${50 + Math.sin(a) * 46}%`, background: hue === null ? "transparent" : hueColour(quantizeHue(shown)) }}
      />
    </div>
  );
}

function Segmented({ legend, value, options, onChange, delta }: { legend: string; value: string; options: string[]; onChange: (v: string) => void; delta: (k: string) => number }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-bold">
        <span>{legend}</span>
        <span className="text-gold">{LABEL[value] ?? value}{delta(value) ? ` · +${rwf(delta(value))}` : ""}</span>
      </legend>
      <div className="grid gap-1 rounded-2xl bg-black/30 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((k) => (
          <label key={k} className={`relative cursor-pointer rounded-xl py-2 text-center text-sm font-semibold transition has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-gold ${value === k ? "grad-cta text-white shadow" : "text-txt/80"}`}>
            <input type="radio" name={legend} value={k} checked={value === k} onChange={() => onChange(k)} className="sr-only" />
            {LABEL[k] ?? k}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
