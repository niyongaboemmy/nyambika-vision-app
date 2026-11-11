"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddressesCard } from "@/components/bag";
import { NotificationPrefsCard } from "@/components/notification-prefs";
import { PasskeysCard } from "@/components/passkeys";
import { Icon, type IconName } from "@/components/icons";
import { Button, ErrorNote, LearnMore, Screen, Sheet, TopBar } from "@/components/ui";
import { Group, GroupRow } from "@/components/ios";
import { ShopperSwitch } from "@/components/shopper-switch";
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

const PURPOSE: Record<string, { title: string; body: string; icon: IconName; tone: Tone }> = {
  TWIN_PROCESSING: { title: "Keep my private twin", body: "Encrypted · looks appear on you", icon: "user", tone: "violet" },
  TRYON_GENERATION: { title: "Render looks on my twin", body: "AI previews · off pauses looks", icon: "sparkle", tone: "terra" },
  VOICE_PROCESSING: { title: "Voice Muse", body: "Speech → text · audio never stored", icon: "mic", tone: "sky" },
  MARKETING: { title: "News from makers I follow", body: "WhatsApp · new collections", icon: "chat", tone: "mint" },
  AVATAR_3D: { title: "Keep my private 3D twin", body: "Encrypted · off deletes it", icon: "cube", tone: "violet" },
};
type Tone = "terra" | "violet" | "mint" | "sky" | "gold" | "red" | "stone";

/** The five promises as scannable tiles; the full wording sits behind "Learn more". */
const PROMISES: { icon: IconName; label: string; tone: Tone }[] = [
  { icon: "lock", label: "Twin encrypted · only you", tone: "violet" },
  { icon: "shield", label: "Never shared with makers", tone: "mint" },
  { icon: "sparkle", label: "AI label · C2PA", tone: "terra" },
  { icon: "wallet", label: "Paid directly to the maker", tone: "gold" },
  { icon: "mic", label: "Audio never stored", tone: "sky" },
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
      <TopBar back="/" title={t("trust.title")} large />
      <main className="space-y-6 px-4 pb-12">
        <ErrorNote error={error} />
        <div>
          <Group header="Your promise">
            {PROMISES.map((p) => (
              <GroupRow key={p.label} icon={p.icon} tone={p.tone} title={p.label} />
            ))}
          </Group>
          <LearnMore className="mt-1.5 px-4">
            <ul className="space-y-1.5">
              <li>Your twin is encrypted and only you can see it.</li>
              <li>Makers never receive your twin or your looks, only what you order.</li>
              <li>Every AI look is labelled and carries Content Credentials (C2PA).</li>
              <li>You pay makers directly. Nyambika never holds your money.</li>
              <li>When you speak to the Muse, your recording is turned into text and deleted straight away; no audio is kept.</li>
            </ul>
          </LearnMore>
        </div>

        {data && (
          <>
            <Group header="My data">
              <GroupRow
                icon="mirror"
                tone="violet"
                title="My twin"
                subtitle={data.twin ? `v${data.twin.version} · size ${data.twin.size ?? "—"} · ${new Date(data.twin.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "No twin · looks use an AI model"}
                value={data.twin ? "View" : "Create"}
                href="/mirror"
              />
              <GroupRow icon="sparkle" tone="terra" title="Looks" value={<span className="tabular">{data.counts.looks}</span>} />
              <GroupRow icon="heart" tone="red" title="Saved looks" value={<span className="tabular">{data.counts.saved}</span>} href="/saved" />
              <GroupRow icon="bag" tone="gold" title="Orders" value={<span className="tabular">{data.counts.orders}</span>} href="/orders" />
            </Group>

            <Group
              header="Consents"
              footer={
                <span className={`inline-flex items-center gap-1 ${data.ledgerVerified ? "text-mint" : "text-terra"}`}>
                  <Icon name={data.ledgerVerified ? "checkCircle" : "alert"} className="size-3.5" />
                  {data.ledgerVerified ? "ledger verified" : "ledger check failed"}
                </span>
              }
            >
              {data.consents.map((c) => (
                <GroupRow
                  key={c.purpose}
                  icon={PURPOSE[c.purpose]?.icon}
                  tone={PURPOSE[c.purpose]?.tone}
                  title={PURPOSE[c.purpose]?.title ?? c.purpose}
                  subtitle={PURPOSE[c.purpose]?.body}
                  accessory={<ShopperSwitch checked={c.granted} onChange={(v) => toggle(c.purpose, v)} label={PURPOSE[c.purpose]?.title ?? c.purpose} />}
                />
              ))}
            </Group>

            <NotificationPrefsCard />
            <PasskeysCard />
            <AddressesCard />

            <Group header="Export & delete">
              <GroupRow icon="download" tone="sky" title="Download my data" value="JSON" onClick={() => window.location.assign("/api/privacy/export")} />
              {data.twin && <GroupRow icon="trash" tone="red" title="Delete twin" destructive onClick={() => setConfirm("TWIN")} />}
              <GroupRow icon="trash" tone="red" title="Delete looks" destructive onClick={() => setConfirm("LOOKS")} />
              <GroupRow icon="logout" tone="red" title="Delete my account" destructive onClick={() => setConfirm("ACCOUNT")} />
            </Group>
          </>
        )}
      </main>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)}>
        <p className="font-display text-xl font-black">
          {confirm === "TWIN" ? "Delete your twin?" : confirm === "LOOKS" ? "Delete all your looks?" : "Delete your account?"}
        </p>
        <p className="mt-2 text-sm text-mut">
          {confirm === "TWIN" && "Your twin and every look made from it are erased now."}
          {confirm === "LOOKS" && "All looks, saved looks and Muse history are erased."}
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
