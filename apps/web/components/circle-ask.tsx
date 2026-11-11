"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import type { Look } from "@/lib/looks";
import type { OwnerPoll } from "@/lib/social";

const MAX = 4;

function defaultQuestion(intentLabel?: string | null) {
  const m = intentLabel?.match(/^For: (.+?)(?: · (\w+))?$/);
  if (m) return `Which one for ${m[2] ? `${m[2]}'s ` : "the "}${m[1].toLowerCase()}?`;
  return "Which one for Saturday?";
}

/** E25 · Ask your circle: pick 2–4 looks, see exactly what is shared, consent, share to WhatsApp. */
export function CircleAsk({ look, open, onClose, intentLabel }: { look: Look; open: boolean; onClose: () => void; intentLabel?: string | null }) {
  const [step, setStep] = useState<"pick" | "review" | "done">("pick");
  const [candidates, setCandidates] = useState<Look[] | null>(null);
  const [picked, setPicked] = useState<string[]>([look.id]);
  const [question, setQuestion] = useState(defaultQuestion(intentLabel));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<OwnerPoll | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setPicked(look.status === "DELIVERED" ? [look.id] : []);
    setConsent(false);
    setPoll(null);
    setError(null);
    setCandidates(null);
    api<Look[]>(`/circle/candidates?lookId=${look.id}`).then(setCandidates).catch((e) => setError(e.message));
  }, [open, look.id, look.status]);

  const toggle = (id: string) => {
    navigator.vibrate?.(8);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]));
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<OwnerPoll>("/circle/polls", { method: "POST", json: { lookIds: picked, question, consent: true } });
      setPoll(p);
      setStep("done");
      navigator.vibrate?.([12, 30, 12]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = (candidates ?? []).filter((c) => picked.includes(c.id)).sort((a, b) => picked.indexOf(a.id) - picked.indexOf(b.id));
  const shareText = poll ? `${poll.question} Vote for my outfit 👗 ${poll.shareUrl}` : "";

  return (
    <Sheet open={open} onClose={() => !busy && onClose()}>
      {step === "pick" && (
        <div>
          <h3 className="font-display text-2xl font-black">Ask your circle 👥</h3>
          <p className="text-sm text-mut">Pick 2–{MAX} looks. Friends vote from WhatsApp, no account needed.</p>
          <div className="mt-4 grid max-h-[42vh] grid-cols-3 gap-2 overflow-y-auto no-scrollbar" role="group" aria-label="Your looks">
            {candidates === null
              ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton aspect-[9/14] rounded-2xl" />)
              : candidates.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${c.product.title}, ${c.variant.colourName}`}
                      onClick={() => toggle(c.id)}
                      className={`relative aspect-[9/14] overflow-hidden rounded-2xl border-2 bg-ink-3 transition duration-200 ${on ? "scale-[.97] border-gold shadow-[0_0_24px_rgba(242,184,75,.35)]" : "border-white/10"}`}
                    >
                      {c.image && <img src={c.image} alt="" className="h-full w-full object-cover" />}
                      <span className={`absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full text-xs font-black ${on ? "bg-gold text-ink" : "border border-white/50 bg-black/40"}`}>
                        {on ? picked.indexOf(c.id) + 1 : ""}
                      </span>
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-left text-[11px] font-semibold">{c.variant.colourName}</span>
                    </button>
                  );
                })}
          </div>
          {candidates && candidates.length < 2 && <p className="mt-3 text-sm text-gold">You need at least two finished looks. Swipe through a few more first.</p>}
          <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-mut" htmlFor="circle-q">Your question</label>
          <input id="circle-q" value={question} maxLength={120} onChange={(e) => setQuestion(e.target.value)} className="glass mt-1.5 h-12 w-full rounded-2xl px-4 outline-none" />
          <div className="mt-2 flex flex-wrap gap-2">
            {["Which one for Saturday?", "Which colour suits me?", "Wedding: which one?"].map((q) => <Chip key={q} active={q === question} onClick={() => setQuestion(q)}>{q}</Chip>)}
          </div>
          <ErrorNote error={error} />
          <Button className="mt-4 w-full" disabled={picked.length < 2 || question.trim().length < 3} onClick={() => setStep("review")}>
            Next · {picked.length} of {MAX} picked
          </Button>
        </div>
      )}

      {step === "review" && (
        <div>
          <h3 className="font-display text-2xl font-black">What your circle will see</h3>
          <p className="mt-1 text-sm text-txt/80">“{question}”</p>
          <div className="mt-3 flex gap-2">
            {chosen.map((c) => (
              <div key={c.id} className="relative aspect-[9/14] flex-1 overflow-hidden rounded-2xl bg-ink-3">
                {c.image && <img src={c.image} alt={`${c.variant.colourName} look`} className="h-full w-full object-cover" />}
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-bold">✦ AI preview</span>
                <span className="absolute bottom-1.5 right-1.5 size-3 rounded-full orb" aria-hidden />
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-txt/90">
            <li>🖼️ {chosen.length} copies of these looks, each stamped <b>AI preview</b> + Nyambika mark. Your originals stay private.</li>
            <li>🙈 Not your name, phone, twin photo or measurements.</li>
            <li>⏳ The link closes by itself in 72 hours. You can take it down any time.</li>
            <li>🧵 Makers never see polls.</li>
          </ul>
          <label className="glass mt-4 flex items-start gap-3 rounded-2xl p-3 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[#F2B84B]" />
            <span>I choose to share these {chosen.length} AI previews of me with anyone who has the link.</span>
          </label>
          <ErrorNote error={error} />
          <div className="mt-4 flex gap-2">
            <Button variant="glass" onClick={() => setStep("pick")} disabled={busy}>Back</Button>
            <Button className="flex-1" disabled={!consent || busy} onClick={create}>{busy ? "Stamping previews…" : "Create poll"}</Button>
          </div>
        </div>
      )}

      {step === "done" && poll && (
        <div className="text-center">
          <div className="mx-auto mb-3 flex justify-center -space-x-5">
            {poll.options.map((o, i) => (
              <img key={o.id} src={o.image ?? ""} alt="" className="h-28 w-20 animate-rise rounded-2xl border-2 border-ink-2 object-cover shadow-xl" style={{ animationDelay: `${i * 80}ms`, transform: `rotate(${(i - (poll.options.length - 1) / 2) * 6}deg)` }} />
            ))}
          </div>
          <h3 className="font-display text-2xl font-black text-grad">Your poll is live</h3>
          <p className="text-sm text-mut">Send it to your circle. Votes appear live.</p>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 font-bold text-[#062b14]">
            Share on WhatsApp
          </a>
          <div className="mt-2 flex gap-2">
            <Button variant="glass" className="flex-1" onClick={async () => { await navigator.clipboard?.writeText(poll.shareUrl).catch(() => {}); setCopied(true); }}>
              {copied ? "Link copied ✓" : "Copy link"}
            </Button>
            <Link href={`/circle/${poll.id}`} className="glass inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl font-semibold">Live results →</Link>
          </div>
        </div>
      )}
    </Sheet>
  );
}
