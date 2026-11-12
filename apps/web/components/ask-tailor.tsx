"use client";

import type { Measurements, MorphSpec } from "@nyambika/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Sheet } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { MEASUREMENT_LABEL, specChips, type CustomOrderView, type MeasurementsView } from "@/lib/tailor";
import { Icon } from "@/components/icons";

export interface AskRequest {
  pageId: string;
  makerName: string;
  productId?: string;
  variantId?: string;
  serviceId?: string;
  title: string;
  sizes?: string[];
  estimateRwf: number;
  image: string | null;
  /** Delivered morph render; only shared when the shopper ticks the box. */
  renderId: string | null;
  spec: MorphSpec | null;
  colour?: string | null;
  required?: string[];
}

const QUICK = ["bustCm", "waistCm", "hipsCm", "heightCm"] as const;

/**
 * "Ask <tailor> to sew this" (E24): shows exactly what will be shared, nothing leaves without a tick.
 * Measurements go as a time-limited share (14 days) for this one order; the preview goes as a copy.
 */
export function AskTailorSheet({ open, onClose, request }: { open: boolean; onClose: () => void; request: AskRequest }) {
  const { me } = useSession();
  const router = useRouter();
  const [m, setM] = useState<MeasurementsView | null>(null);
  const [draft, setDraft] = useState<Measurements>({});
  const [sharePreview, setSharePreview] = useState(false);
  const [shareMeasurements, setShareMeasurements] = useState(true);
  const [size, setSize] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = request.makerName.split(" ")[0];

  useEffect(() => {
    if (!open || !me) return;
    void api<MeasurementsView>("/measurements").then((v) => {
      setM(v);
      setDraft(v.profile ?? v.prefill ?? {});
    }).catch(() => setM(null));
    if (request.productId) {
      void api<{ recommendation: { size: string } | null }>(`/size/recommend?productId=${request.productId}${request.variantId ? `&variantId=${request.variantId}` : ""}`)
        .then((r) => r.recommendation && setSize((s) => s ?? r.recommendation!.size))
        .catch(() => {});
    }
  }, [open, me, request.productId, request.variantId]);

  if (!me) {
    return (
      <Sheet open={open} onClose={onClose}>
        <p className="text-center">Sign in to ask {request.makerName} for a custom piece.</p>
        <Button className="mt-4 w-full" onClick={() => router.push(`/signin?next=${encodeURIComponent(location.pathname)}`)}>Sign in</Button>
      </Sheet>
    );
  }

  const needsProfile = shareMeasurements && !m?.profile;
  const quickOk = !needsProfile || QUICK.every((k) => typeof draft[k] === "number" && draft[k]! > 0);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (needsProfile) {
        await api("/measurements", { method: "PUT", json: { measurements: draft, consent: true, source: m?.prefill ? "TWIN_ESTIMATE" : "MANUAL" } });
      }
      const co = await api<CustomOrderView>("/custom-orders", {
        method: "POST",
        json: {
          pageId: request.pageId,
          productId: request.productId,
          variantId: request.variantId,
          serviceId: request.serviceId,
          spec: request.spec ?? undefined,
          renderId: sharePreview ? request.renderId : undefined,
          sharePreview: sharePreview && Boolean(request.renderId),
          shareMeasurements,
          size: size ?? undefined,
          note,
        },
      });
      navigator.vibrate?.([12, 30, 12]);
      router.push(`/custom/${co.id}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const chips = request.spec ? specChips(request.spec, request.colour) : request.colour ? [request.colour] : [];
  return (
    <Sheet open={open} onClose={() => !busy && onClose()}>
      <div className="max-h-[78dvh] overflow-y-auto overscroll-contain pr-1">
        <div className="flex gap-3">
          {request.image ? (
            <img src={request.image} alt="" className="h-28 w-20 shrink-0 rounded-2xl bg-black/40 object-cover" />
          ) : (
            <div className="grid h-28 w-20 shrink-0 place-items-center rounded-2xl bg-white/10" aria-hidden><Icon name="needle" className="size-8 text-gold" /></div>
          )}
          <div className="min-w-0">
            <h3 className="font-display text-xl font-black leading-tight">Ask {first} to sew this</h3>
            <p className="truncate text-sm text-mut">{request.title}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {chips.map((c) => <span key={c} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">{c}</span>)}
            </div>
            <p className="mt-1.5 text-sm font-semibold text-gold">From {rwf(request.estimateRwf)} · {first} sends the final quote</p>
          </div>
        </div>

        {request.sizes && request.sizes.length > 0 && (
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Usual size (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {request.sizes.map((s) => <Chip key={s} active={size === s} onClick={() => setSize(size === s ? null : s)}>{s}</Chip>)}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-widest text-mut">What {first} will see</legend>
          <label className="glass flex items-start gap-3 rounded-2xl p-3">
            <input type="checkbox" checked={shareMeasurements} onChange={(e) => setShareMeasurements(e.target.checked)} className="mt-1 size-5 accent-[#f2b84b]" />
            <span className="text-sm"><b>My measurements for 14 days</b><br /><span className="text-mut">Only this order · stop sharing anytime</span></span>
          </label>
          {request.renderId && (
            <label className="glass flex items-start gap-3 rounded-2xl p-3">
              <input type="checkbox" checked={sharePreview} onChange={(e) => setSharePreview(e.target.checked)} className="mt-1 size-5 accent-[#f2b84b]" />
              <span className="text-sm"><b>This preview image</b><br /><span className="text-mut">A copy of the AI preview on your {me.hasTwin ? "twin" : "AI model"}. Off by default: your twin and looks stay private.</span></span>
            </label>
          )}
          <p className="px-1 text-xs text-mut">Always shared: your name and phone, so {first} can reach you.</p>
        </fieldset>

        {needsProfile && (
          <fieldset className="mt-4 rounded-2xl border border-gold/30 bg-gold/10 p-3">
            <legend className="px-1 text-sm font-bold">Your measurements (cm)</legend>
            <p className="mb-2 text-xs text-txt/80">{m?.prefill ? `From your twin (${m.twinSize}, ±3 cm) · adjust if needed` : "A soft tape measure helps. You can refine them later."}</p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map((k) => (
                <label key={k} className="block">
                  <span className="flex items-center gap-1 text-xs font-semibold"><Icon name={MEASUREMENT_LABEL[k].glyph} className="size-3.5 text-gold" />{MEASUREMENT_LABEL[k].label}</span>
                  <input
                    inputMode="decimal"
                    value={draft[k] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value === "" ? undefined : Number(e.target.value.replace(",", ".")) })}
                    className="mt-0.5 h-11 w-full rounded-xl bg-black/40 px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-mut">Saved encrypted · private</p>
          </fieldset>
        )}

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-widest text-mut">Note for {first} (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="e.g. For my sister's gusaba on 20 Dec" className="glass mt-1 w-full rounded-2xl px-4 py-3 outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-gold" />
        </label>
        <ErrorNote error={error} />
      </div>
      <Button className="mt-3 w-full" disabled={busy || !quickOk} onClick={send}>
        {busy ? "Sending…" : `Send request to ${first}`}
      </Button>
      {!quickOk && <p className="mt-1 text-center text-xs text-gold">Add the four measurements, or untick sharing</p>}
    </Sheet>
  );
}
