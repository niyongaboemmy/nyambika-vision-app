"use client";

import { useEffect, useState } from "react";
import { Button, Screen, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Push {
  providerRef: string;
  status: string;
  amountRwf: number;
  to: string;
  code: string;
  wallet: string;
}

/** Development stand-in for the shopper's phone: MoMo/Airtel USSD push with PIN entry. */
export default function Handset() {
  const { me } = useSession();
  const [phone, setPhone] = useState("");
  const [pushes, setPushes] = useState<Push[]>([]);
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (me && !phone) setPhone(me.phone);
  }, [me, phone]);
  useEffect(() => {
    if (!phone) return;
    const load = () => api<Push[]>(`/payments/mock/handset?phone=${encodeURIComponent(phone)}`).then(setPushes).catch(() => {});
    void load();
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, [phone]);
  const pending = pushes.find((p) => p.status === "PENDING");
  async function decide(approve: boolean) {
    if (!pending) return;
    await api(`/payments/mock/handset/${pending.providerRef}`, { method: "POST", json: { pin: pin || "00000", approve } });
    setPin("");
  }
  return (
    <Screen aurora={false}>
      <TopBar back="/" title="Simulated handset (dev)" />
      <main className="space-y-4 p-4">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Payer phone" className="glass h-12 w-full rounded-2xl px-4 outline-none" />
        {pending ? (
          <section className="rounded-3xl border border-yellow-400/40 bg-yellow-400/10 p-5">
            <p className="text-xs uppercase tracking-widest text-yellow-300">{pending.wallet === "MTN_MOMO" ? "MTN MoMo" : "Airtel Money"} · USSD</p>
            <p className="mt-2 text-lg">Pay <b>{rwf(pending.amountRwf)}</b> to <b>{pending.to}</b> for {pending.code}?</p>
            <input inputMode="numeric" maxLength={5} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Enter PIN" aria-label="PIN" className="mt-4 h-14 w-full rounded-2xl bg-black/40 px-4 text-center text-2xl tracking-[.5em] outline-none" />
            <p className="mt-1 text-center text-xs text-mut">Any 5 digits approve · 0000 declines</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="glass" onClick={() => decide(false)}>Cancel</Button>
              <Button onClick={() => decide(true)} disabled={pin.length < 4}>Approve</Button>
            </div>
          </section>
        ) : (
          <p className="pt-6 text-center text-mut">No pending payment requests.</p>
        )}
        <ul className="space-y-1 text-sm text-mut">
          {pushes.filter((p) => p.status !== "PENDING").map((p) => <li key={p.providerRef}>{p.code} · {rwf(p.amountRwf)} · {p.status}</li>)}
        </ul>
      </main>
    </Screen>
  );
}
