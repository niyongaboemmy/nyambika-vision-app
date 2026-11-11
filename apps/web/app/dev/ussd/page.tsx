"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Sms {
  id: string;
  template: string;
  body: string;
  createdAt: string;
}

const CODE = "*775#";

/**
 * Development stand-in for a cooperative maker's feature phone (E31, FR-COOP-09):
 * dial *775# to run the USSD menu (sales, next payout, approve an order, allow admin help)
 * and read the SMS inbox (order alerts, consent codes) from the messaging outbox.
 */
export default function UssdSimulator() {
  const [phone, setPhone] = useState("0788100004");
  const [session, setSession] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [screen, setScreen] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sms, setSms] = useState<Sms[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSms = useCallback(() => api<Sms[]>(`/dev/sms?phone=${encodeURIComponent(phone)}`).then(setSms).catch(() => {}), [phone]);
  useEffect(() => {
    void loadSms();
    const id = setInterval(loadSms, 3000);
    return () => clearInterval(id);
  }, [loadSms]);

  async function send(nextPath: string[], sid: string) {
    setBusy(true);
    try {
      const text = await api<string>("/ussd", { method: "POST", json: { sessionId: sid, serviceCode: CODE, phoneNumber: phone, text: nextPath.join("*") } });
      const t = String(text);
      setScreen(t.replace(/^(CON|END) /, ""));
      setOpen(t.startsWith("CON"));
      setPath(nextPath);
      if (!t.startsWith("CON")) setSession(null);
      void loadSms();
    } catch (e) {
      setScreen(`Connection problem: ${(e as Error).message}`);
      setOpen(false);
    } finally {
      setBusy(false);
      setInput("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  function dial() {
    if (input && input !== CODE) {
      setScreen("Unknown service code. Try *775#");
      setOpen(false);
      return;
    }
    const sid = `sim-${Date.now()}`;
    setSession(sid);
    void send([], sid);
  }

  function reply() {
    if (!session || !input) return;
    void send([...path, input], session);
  }

  function key(k: string) {
    navigator.vibrate?.(5);
    setInput((v) => (v + k).slice(0, 12));
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,#2b2440,#0f0c16)] px-4 py-6 text-white">
      <div className="mx-auto max-w-sm space-y-5">
        <header className="space-y-1 text-center">
          <p className="text-xs font-bold uppercase tracking-[.25em] text-amber-300">Dev simulator</p>
          <h1 className="font-display text-2xl font-black">Feature phone · USSD {CODE}</h1>
          <label className="mx-auto mt-2 flex max-w-[260px] items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-sm">
            <span className="text-white/70">SIM</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))} inputMode="tel" aria-label="Phone number of the SIM" className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none" />
          </label>
        </header>

        {/* The phone */}
        <section aria-label="Feature phone" className="mx-auto w-[300px] rounded-[44px] bg-gradient-to-b from-[#3a3a42] to-[#1d1d22] p-5 shadow-[0_30px_60px_-20px_rgba(0,0,0,.8),inset_0_2px_0_rgba(255,255,255,.12)]">
          <p className="mb-2 text-center text-[11px] font-black tracking-[.3em] text-white/50">NYAMBIKA</p>
          <div className="rounded-2xl bg-[#c9dcb0] p-3 font-mono text-[13px] leading-snug text-[#1f2a14] shadow-[inset_0_2px_8px_rgba(0,0,0,.35)]" role="log" aria-live="polite" aria-label="Phone screen">
            <div className="flex justify-between text-[10px] opacity-70"><span>▂▄▆ MTN RW</span><span>{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></div>
            <pre className="mt-2 min-h-[150px] whitespace-pre-wrap break-words font-mono text-[13px]">{busy ? "USSD code running…" : screen || "Dial *775# and press 📞"}</pre>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/[^\d*#]/g, "").slice(0, 12))}
              onKeyDown={(e) => e.key === "Enter" && (session ? reply() : dial())}
              aria-label={session ? "Reply" : "Number to dial"}
              placeholder={session ? "Reply…" : CODE}
              className="mt-2 w-full rounded-md border border-[#1f2a14]/30 bg-[#dfeccb] px-2 py-1.5 font-mono text-base outline-none placeholder:text-[#1f2a14]/40"
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => (session ? reply() : dial())} disabled={busy} className="col-span-1 min-h-12 rounded-2xl bg-emerald-600 text-lg font-black shadow-[inset_0_-3px_0_rgba(0,0,0,.25)]" aria-label={session ? "Send reply" : "Call"}>
              {session ? "Send" : "📞"}
            </button>
            <button type="button" onClick={() => setInput((v) => v.slice(0, -1))} className="min-h-12 rounded-2xl bg-white/15 text-lg font-black" aria-label="Clear one">⌫</button>
            <button type="button" onClick={() => { setSession(null); setOpen(false); setScreen(""); setPath([]); setInput(""); }} className="min-h-12 rounded-2xl bg-red-600 text-lg font-black shadow-[inset_0_-3px_0_rgba(0,0,0,.25)]" aria-label="End call">✕</button>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
              <button key={k} type="button" onClick={() => key(k)} className="min-h-12 rounded-2xl bg-gradient-to-b from-[#55555f] to-[#3a3a42] text-xl font-black shadow-[inset_0_-3px_0_rgba(0,0,0,.35)] active:translate-y-0.5" aria-label={`Key ${k}`}>
                {k}
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-white/50">{open ? "Session open · reply with a number · 0 = back" : "No session"}</p>
        </section>

        <section aria-labelledby="sms-title" className="rounded-[26px] bg-white/8 p-4 ring-1 ring-white/10">
          <h2 id="sms-title" className="text-sm font-black uppercase tracking-widest text-amber-300">SMS inbox</h2>
          {sms.length === 0 ? (
            <p className="mt-2 text-sm text-white/60">No messages for this SIM yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {sms.map((m) => (
                <li key={m.id} className="rounded-2xl bg-white/10 p-3 text-sm leading-snug">
                  <p>{m.body}</p>
                  <p className="mt-1 text-[11px] text-white/50">{new Date(m.createdAt).toLocaleTimeString("en-GB")} · {m.template}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
