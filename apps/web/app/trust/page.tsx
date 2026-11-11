"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddressesCard } from "@/components/bag";
import { NotificationPrefsCard } from "@/components/notification-prefs";
import { PasskeysCard } from "@/components/passkeys";
import { Icon, type IconName } from "@/components/studio";
import { Button, ErrorNote, LearnMore, Screen, Sheet, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Privacy {
  consents: { purpose: string; granted: boolean; at: string | null }[];
  ledgerVerified: boolean;
  twin: { version: number; createdAt: string; size: string | null } | null;
  counts: { looks: number; saved: number; orders: number };
  deletionJobs: { id: string; scope: string; status: string; steps: { step: string; detail?: string }[]; completedAt: string | null }[];
}

const PURPOSE: Record<string, { title: string; body: string }> = {
  TWIN_PROCESSING: { title: "Keep my private twin", body: "Encrypted · looks appear on you" },
  TRYON_GENERATION: { title: "Render looks on my twin", body: "AI previews · off pauses looks" },
  VOICE_PROCESSING: { title: "Voice Muse", body: "Speech → text · audio never stored" },
  MARKETING: { title: "News from makers I follow", body: "WhatsApp · new collections" },
  AVATAR_3D: { title: "Keep my private 3D twin", body: "Encrypted · off deletes it" },
};

/** The five promises as scannable tiles; the full wording sits behind "Learn more". */
const PROMISES: { icon: IconName; label: string }[] = [
  { icon: "lock", label: "Twin encrypted, only you see it" },
  { icon: "shield", label: "Makers never get your twin or looks" },
  { icon: "sparkle", label: "AI looks labelled · C2PA" },
  { icon: "wallet", label: "Paid directly to the maker" },
  { icon: "mic", label: "Audio is never stored · voice becomes text" },
];

/** Trust centre (prototype v2 structure · FR-PRV): consents, data, deletion. */
export default function Trust() {
  const { t, signOut } = useSession();
  const router = useRouter();
  const { data, setData, error } = useApi<Privacy>("/privacy");
  const [confirm, setConfirm] = useState<null | "TWIN" | "LOOKS" | "ACCOUNT">(null);
  const [done, setDone] = useState<Privacy["deletionJobs"][number] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(purpose: string, granted: boolean) {
    setData((d) => (d ? { ...d, consents: d.consents.map((c) => (c.purpose === purpose ? { ...c, granted } : c)) } : d));
    setData(await api<Privacy>("/privacy/consents", { method: "POST", json: { purpose, granted } }));
  }

  async function erase(scope: "TWIN" | "LOOKS" | "ACCOUNT") {
    setErr(null);
    try {
      const job = await api<Privacy["deletionJobs"][number]>("/privacy/delete", { method: "POST", json: { scope } });
      setConfirm(null);
      setDone(job);
      if (scope === "ACCOUNT") {
        await signOut();
        return;
      }
      setData(await api<Privacy>("/privacy"));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Screen>
      <TopBar back="/" title={t("trust.title")} />
      <main className="space-y-4 px-4 pb-10">
        <ErrorNote error={error} />
        <section className="glass rounded-3xl p-4" aria-labelledby="promise">
          <h2 id="promise" className="font-display text-lg font-black">Your promise</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {PROMISES.map((p, i) => (
              <li key={p.label} className={`flex items-start gap-2 rounded-2xl bg-white/[.06] p-3 text-[13px] font-semibold leading-snug ${i === PROMISES.length - 1 ? "col-span-2" : ""}`}>
                <Icon name={p.icon} className="mt-px size-4 shrink-0 text-gold" />
                {p.label}
              </li>
            ))}
          </ul>
          <LearnMore className="mt-2">
            <ul className="space-y-1.5">
              <li>Your twin is encrypted and only you can see it.</li>
              <li>Makers never receive your twin or your looks, only what you order.</li>
              <li>Every AI look is labelled and carries Content Credentials (C2PA).</li>
              <li>You pay makers directly. Nyambika never holds your money.</li>
              <li>When you speak to the Muse, your recording is turned into text and deleted straight away; no audio is kept.</li>
            </ul>
          </LearnMore>
        </section>

        {data && (
          <>
            <section className="glass rounded-3xl p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 font-semibold"><Icon name="mirror" className="size-4 text-gold" /> My twin</p>
                <Link href="/mirror" className="text-sm text-gold">{data.twin ? "View / retake" : "Create"}</Link>
              </div>
              <p className="mt-1 text-sm text-mut">
                {data.twin ? `Version ${data.twin.version} · size ${data.twin.size ?? "—"} · since ${new Date(data.twin.createdAt).toLocaleDateString()}` : "No twin. Looks show on an AI model."}
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                {([["Looks", data.counts.looks], ["Saved", data.counts.saved], ["Orders", data.counts.orders]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-white/[.06] py-2">
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-mut">{k}</dt>
                    <dd className="tabular font-display text-xl font-black">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="glass space-y-3 rounded-3xl p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Consents</p>
                <span className={`text-xs ${data.ledgerVerified ? "text-mint" : "text-terra"}`}>{data.ledgerVerified ? "✓ ledger verified" : "⚠ ledger check failed"}</span>
              </div>
              {data.consents.map((c) => (
                <label key={c.purpose} className="flex min-h-12 cursor-pointer items-center gap-3">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{PURPOSE[c.purpose]?.title ?? c.purpose}</span>
                    <span className="block text-xs text-mut">{PURPOSE[c.purpose]?.body}</span>
                  </span>
                  <input type="checkbox" role="switch" className="sr-only" checked={c.granted} onChange={(e) => toggle(c.purpose, e.target.checked)} aria-label={PURPOSE[c.purpose]?.title} />
                  <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition ${c.granted ? "bg-[#0f8a5f]" : "bg-white/20"}`}>
                    <span className={`absolute top-0.5 size-6 rounded-full bg-[#fff] shadow transition-all duration-200 ${c.granted ? "left-[22px]" : "left-0.5"}`} />
                  </span>
                </label>
              ))}
            </section>

            <NotificationPrefsCard />
            <PasskeysCard />
            <AddressesCard />

            <section className="glass space-y-2 rounded-3xl p-4">
              <p className="font-semibold">My data</p>
              <a href="/api/privacy/export" className="glass press flex min-h-12 items-center justify-center gap-2 rounded-2xl font-semibold"><Icon name="download" className="size-4" /> Download my data (JSON)</a>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="glass" disabled={!data.twin} onClick={() => setConfirm("TWIN")}>Delete twin</Button>
                <Button variant="glass" onClick={() => setConfirm("LOOKS")}>Delete looks</Button>
              </div>
              <Button variant="danger" className="w-full" onClick={() => setConfirm("ACCOUNT")}>Delete my account</Button>
            </section>
          </>
        )}
      </main>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)}>
        <p className="font-display text-xl font-black">
          {confirm === "TWIN" ? "Delete your twin?" : confirm === "LOOKS" ? "Delete all your looks?" : "Delete your account?"}
        </p>
        <p className="mt-2 text-sm text-mut">
          {confirm === "TWIN" && "Your twin image and every look rendered from it are erased now. You can create a new twin later."}
          {confirm === "LOOKS" && "All generated looks and Muse history are erased. Saved looks too."}
          {confirm === "ACCOUNT" && "Twin, looks and history are erased and you are signed out. Order records stay for the legal period without your name or phone."}
        </p>
        <ErrorNote error={err} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="glass" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => confirm && erase(confirm)}>{t("common.delete")}</Button>
        </div>
      </Sheet>

      <Sheet open={done !== null} onClose={() => { setDone(null); if (done?.scope === "ACCOUNT") router.replace("/"); }}>
        <p className="font-display text-xl font-black">Deleted ✓</p>
        <ul className="mt-2 space-y-1 text-sm">
          {done?.steps.map((s) => <li key={s.step}>✓ {s.step}{s.detail ? <span className="text-mut"> · {s.detail}</span> : null}</li>)}
        </ul>
      </Sheet>
    </Screen>
  );
}
