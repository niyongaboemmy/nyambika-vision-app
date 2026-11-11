"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useEffect, useState } from "react";
import { api, rwf } from "@/lib/api";
import type { MakerSpace } from "@/lib/maker";
import { useSession } from "@/lib/session";

export interface AppliedDiscount {
  code: string | null;
  amountRwf: number;
  display: string;
}

/**
 * Buy sheet (E30): shows the maker's automatic time-boxed offer and lets the shopper add a code.
 * The order re-validates everything at hold-to-buy; maker-funded only.
 */
export function DiscountField({ variantId, open, onChange }: { variantId: string; open: boolean; onChange: (d: AppliedDiscount | null) => void }) {
  const [offer, setOffer] = useState<{ label: string; display: string; amountRwf: number; endsAt: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<AppliedDiscount | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api<typeof offer>(`/discounts/offer?variantId=${variantId}`)
      .then((o) => {
        setOffer(o);
        if (o && !applied) onChange({ code: null, amountRwf: o.amountRwf, display: o.display });
      })
      .catch(() => setOffer(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variantId]);

  async function check() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ code: string; applied: string | null; display: string | null; amountRwf: number }>("/discounts/check", { method: "POST", json: { variantId, code } });
      const d = { code: r.applied ? r.code : null, amountRwf: r.amountRwf, display: r.display ?? "" };
      setApplied(d);
      onChange(r.applied ? d : offer ? { code: null, amountRwf: offer.amountRwf, display: offer.display } : null);
      if (!r.applied) setErr("Your automatic offer is already the better deal.");
      setEditing(false);
      navigator.vibrate?.(12);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ends = offer?.endsAt ? new Date(offer.endsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : null;
  return (
    <div className="space-y-2">
      {offer && !applied?.code && (
        <p className="flex items-center gap-2 rounded-2xl bg-gold/15 px-3 py-2 text-sm text-gold ring-1 ring-inset ring-gold/30">
          <span aria-hidden>🏷️</span>
          <span className="flex-1"><b>{offer.label || "Offer"}</b> {offer.display} · −{rwf(offer.amountRwf)}{ends ? ` · until ${ends}` : ""}</span>
        </p>
      )}
      {applied?.code && (
        <p className="flex items-center gap-2 rounded-2xl bg-mint/15 px-3 py-2 text-sm text-mint ring-1 ring-inset ring-mint/30">
          <span aria-hidden>✓</span>
          <span className="flex-1">Code <b className="font-mono">{applied.code}</b> {applied.display} · −{rwf(applied.amountRwf)}</span>
          <button type="button" className="text-xs underline" onClick={() => { setApplied(null); setCode(""); onChange(offer ? { code: null, amountRwf: offer.amountRwf, display: offer.display } : null); }}>Remove</button>
        </p>
      )}
      {!applied?.code &&
        (editing ? (
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} maxLength={20} aria-label="Discount code" placeholder="CODE" autoFocus className="glass h-11 min-w-0 flex-1 rounded-2xl px-4 font-mono tracking-widest outline-none placeholder:text-white/40" />
            <button type="button" onClick={check} disabled={busy || code.length < 3} className="glass h-11 rounded-2xl px-4 text-sm font-bold disabled:opacity-40">{busy ? "…" : "Apply"}</button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-white/70 underline underline-offset-2">Have a code from the maker?</button>
        ))}
      {err && (isExpectedText(err) ? <LimitState error={err} /> : <p className="text-xs text-gold" role="status">{err}</p>)}
    </div>
  );
}

/** Maker Space: opt in to WhatsApp "new collection" updates from this maker (explicit, revocable). */
export function CollectionAlerts({ maker }: { maker: MakerSpace }) {
  const { me, locale } = useSession();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!me) return;
    void api<{ optedIn: boolean }>(`/pages/${maker.id}/broadcast-optin`).then((r) => setOn(r.optedIn)).catch(() => setOn(false));
  }, [me, maker.id]);
  if (!me || on === null) return null;
  async function toggle() {
    const r = await api<{ optedIn: boolean }>(`/pages/${maker.id}/broadcast-optin`, { method: "POST", json: { optedIn: !on, locale } });
    setOn(r.optedIn);
    navigator.vibrate?.(10);
  }
  return (
    <section className="mx-5 mt-5 flex items-center gap-3 rounded-3xl glass p-4">
      <span className="text-2xl" aria-hidden>💬</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">New pieces on WhatsApp</span>
        <span className="block text-xs text-mut">{on ? "New collections only · reply STOP anytime" : `Get ${maker.name}'s new collections. At most a few a week.`}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label="WhatsApp updates from this maker" onClick={toggle} className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? "bg-mint" : "bg-white/20"}`}>
        <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
      </button>
    </section>
  );
}
