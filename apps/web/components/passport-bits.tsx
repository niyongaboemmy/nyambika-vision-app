"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Print / save as PDF for hang-tags and labels (FR-DPP-02). */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-cocoa px-5 text-sm font-bold text-white hover:bg-cocoa-2 print:hidden ${className}`}>
      Print passport &amp; hang-tag
    </button>
  );
}

/** FR-DPP-04: a host verifies "Made in …" and impact claims (shown only to host roles). */
export function HostVerify({ productId, verified }: { productId: string; verified: boolean }) {
  const { me } = useSession();
  const [on, setOn] = useState(verified);
  const [busy, setBusy] = useState(false);
  if (!me?.isHost) return null;
  async function toggle() {
    setBusy(true);
    try {
      const r = await api<{ claimsVerified: boolean }>(`/passports/${productId}/verify`, { method: "POST", json: { verified: !on } });
      setOn(r.claimsVerified);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" disabled={busy} onClick={toggle} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold bg-violet-50 text-violet-ink hover:bg-violet-100 print:hidden">
      {on ? "Host: withdraw claim verification" : "Host: verify these claims"}
    </button>
  );
}
