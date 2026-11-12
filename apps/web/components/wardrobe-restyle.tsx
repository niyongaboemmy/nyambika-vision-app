"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Sheet } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { nice, OCCASIONS, type WardrobeEventView } from "@/lib/social";
import { Icon } from "@/components/icons";

interface MuseIntent {
  id: string;
  input: string;
  occasion: string;
  date: string | null;
  budgetMax: number | null;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => iso(new Date(Date.now() + n * 86400_000));
const nextSaturday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return iso(d);
};

/** E26 · Restyle for an event: pick an event (manual or from a recent Muse ask) → 3 outfits on your twin. */
export function RestyleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [intents, setIntents] = useState<MuseIntent[] | null>(null);
  const [title, setTitle] = useState("");
  const [occasion, setOccasion] = useState("wedding");
  const [date, setDate] = useState(addDays(3));
  const [budget, setBudget] = useState<number | null>(40000);
  const [intentId, setIntentId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<MuseIntent[]>("/wardrobe/intents").then(setIntents).catch(() => setIntents([]));
  }, [open]);

  function fromMuse(i: MuseIntent) {
    setIntentId(i.id);
    setOccasion(i.occasion);
    setTitle(nice(i.occasion));
    if (i.date && i.date >= iso(new Date())) setDate(i.date);
    if (i.budgetMax) setBudget(i.budgetMax);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const e = await api<WardrobeEventView>("/wardrobe/events", { method: "POST", json: { title: title.trim() || undefined, occasion, date, budgetMax: budget, intentSessionId: intentId } });
      navigator.vibrate?.(12);
      router.push(`/wardrobe/events/${e.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()}>
      <h2 className="flex items-center gap-2 font-display text-2xl font-black">Restyle for an event <Icon name="sparkle" className="size-6 text-gold" /></h2>
      <p className="text-sm text-mut">Your pieces + 1–2 new · on your twin</p>
      <div className="mt-4 max-h-[62vh] space-y-4 overflow-y-auto no-scrollbar pb-1">
        {intents && intents.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">From your Muse</legend>
            <div className="flex flex-wrap gap-2">
              {intents.map((i) => <Chip key={i.id} active={intentId === i.id} onClick={() => fromMuse(i)}><Icon name="mic" className="size-4" /> “{i.input.length > 28 ? `${i.input.slice(0, 28)}…` : i.input}”</Chip>)}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Occasion</legend>
          <div className="flex flex-wrap gap-2">
            {OCCASIONS.map((o) => <Chip key={o} active={occasion === o} onClick={() => { setOccasion(o); setIntentId(undefined); }}>{nice(o)}</Chip>)}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-mut">Name it (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder={`e.g. ${occasion === "wedding" ? "Aline's wedding" : nice(occasion)}`} className="glass mt-1.5 h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">When</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={date === addDays(3)} onClick={() => setDate(addDays(3))}>In 3 days</Chip>
            <Chip active={date === nextSaturday()} onClick={() => setDate(nextSaturday())}>Saturday</Chip>
            <Chip active={date === addDays(7)} onClick={() => setDate(addDays(7))}>Next week</Chip>
            <input type="date" aria-label="Event date" value={date} min={iso(new Date())} onChange={(e) => setDate(e.target.value)} className="glass h-11 rounded-2xl px-3 text-sm outline-none [color-scheme:dark]" />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Budget for new pieces</legend>
          <div className="flex flex-wrap gap-2">
            {[20000, 40000, 80000].map((b) => <Chip key={b} active={budget === b} onClick={() => setBudget(b)}>≤ {rwf(b)}</Chip>)}
            <Chip active={budget === null} onClick={() => setBudget(null)}>Any</Chip>
          </div>
        </fieldset>
      </div>
      <ErrorNote error={error} />
      <Button className="mt-4 w-full" disabled={busy} onClick={submit}>{busy ? "Styling your wardrobe…" : <><Icon name="sparkle" className="size-5" /> Style 3 outfits</>}</Button>
      <p className="mt-2 text-center text-xs text-mut">Uses daily looks · AI label · C2PA</p>
    </Sheet>
  );
}
