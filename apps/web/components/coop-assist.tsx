"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip, Icon, Input, Note, SButton, StudioSheet, Switch } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { speak, type CoopMe, type MakerAccessRow, type Statement } from "@/lib/growth";
import type { Maker } from "@/lib/types";

/* E31 low-literacy cooperative flows: per-maker modes, assisted mode with recorded consent, statements read aloud. */

const lists = new Map<string, Promise<MakerAccessRow[]>>();
function accessList(pageId: string, fresh = false) {
  if (fresh || !lists.has(pageId)) lists.set(pageId, api<MakerAccessRow[]>(`/pages/${pageId}/maker-access`));
  return lists.get(pageId)!;
}

/** Makers screen: one line per maker card. */
export function MakerAccessPanel({ pageId, maker }: { pageId: string; maker: Maker }) {
  const [row, setRow] = useState<MakerAccessRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [statement, setStatement] = useState(false);
  const load = async (fresh = false) => setRow((await accessList(pageId, fresh)).find((r) => r.makerId === maker.id) ?? null);
  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, maker.id]);

  async function patch(body: object) {
    setErr(null);
    try {
      await api(`/pages/${pageId}/makers/${maker.id}/access`, { method: "PATCH", json: body });
      await load(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!row) return null;
  const active = row.assist?.status === "ACTIVE";
  return (
    <div className="space-y-2.5 border-t border-hairline pt-3">
      <p className="text-[11px] font-black uppercase tracking-wider text-cocoa-2">Easy access</p>
      <Switch checked={row.voiceMode} onChange={(v) => patch({ voiceMode: v })} label="🔊 Voice & icon mode" description="Big pictures · spoken RW · number pad" />
      <Switch checked={row.smsMode} onChange={(v) => patch({ smsMode: v })} disabled={!maker.phone} label="📟 SMS & USSD (*775#)" description={maker.phone ? "Alerts, sales, payouts on any phone" : "Add a phone number first"} />
      <Note error={err} />
      <div className="flex flex-wrap items-center gap-2">
        {active ? <Chip tone="violet"><Icon name="shield" className="size-3.5" /> Helping allowed until {new Date(row.assist!.expiresAt!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Chip> : row.assist?.status === "PENDING" ? <Chip tone="gold">Waiting for {maker.name.split(" ")[0]}&apos;s OK</Chip> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {active ? (
          <Link href={`/studio/${pageId}/easy?assist=${maker.id}`} className="st-press st-cta inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 text-sm font-bold text-white">
            <Icon name="users" className="size-4" /> Help {maker.name.split(" ")[0]}
          </Link>
        ) : (
          <SButton variant="outline" onClick={() => setConsent(true)} disabled={!maker.phone}>
            <Icon name="shield" className="size-4" /> Assisted mode
          </SButton>
        )}
        <SButton variant="soft" onClick={() => setStatement(true)}>🔊 Statement</SButton>
      </div>
      {active && (
        <button type="button" className="text-xs font-bold text-red-800 underline" onClick={async () => { await api(`/pages/${pageId}/makers/${maker.id}/assist/revoke`, { method: "POST" }); await load(true); }}>
          Stop assisted mode
        </button>
      )}
      <ConsentSheet open={consent} onClose={() => setConsent(false)} pageId={pageId} maker={maker} pending={row.assist?.status === "PENDING" ? row.assist.id : null} onDone={() => load(true)} />
      <StatementSheet open={statement} onClose={() => setStatement(false)} pageId={pageId} makerId={maker.id} />
    </div>
  );
}

function ConsentSheet({ open, onClose, pageId, maker, pending, onDone }: { open: boolean; onClose: () => void; pageId: string; maker: Maker; pending: string | null; onDone: () => Promise<void> }) {
  const [grant, setGrant] = useState<{ grantId: string; consentText: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const first = maker.name.split(" ")[0];

  // The maker may also approve on their own phone (USSD 4 or the app): watch for it.
  useEffect(() => {
    if (!open || !(grant || pending)) return;
    const id = setInterval(async () => {
      const rows = await accessList(pageId, true);
      if (rows.find((r) => r.makerId === maker.id)?.assist?.status === "ACTIVE") {
        setOk(`${first} said yes. You can help now.`);
        await onDone();
        clearInterval(id);
      }
    }, 2500);
    return () => clearInterval(id);
  }, [open, grant, pending, pageId, maker.id, first, onDone]);

  async function ask() {
    setErr(null);
    try {
      setGrant(await api(`/pages/${pageId}/makers/${maker.id}/assist/request`, { method: "POST", json: { scopes: ["PRODUCTS", "ORDERS"] } }));
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function confirm() {
    setErr(null);
    try {
      await api(`/pages/${pageId}/makers/${maker.id}/assist/confirm`, { method: "POST", json: { grantId: grant?.grantId ?? pending, code } });
      setOk(`Consent recorded. You can help ${first} for 30 days.`);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <StudioSheet open={open} onClose={onClose} title={`Help ${first} with consent`}>
      <div className="space-y-4">
        <ol className="space-y-2 text-sm text-cocoa">
          {[
            ["🗣️", `Ask ${first} if they want your help adding pieces and accepting orders.`],
            ["📩", `We text ${first} a 6-digit code (or they dial *775# → 4).`],
            ["🔢", `${first} reads the code to you. That is their recorded consent, for 30 days.`],
          ].map(([e, t]) => (
            <li key={t} className="flex items-start gap-3 rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline"><span className="text-xl" aria-hidden>{e}</span><span>{t}</span></li>
          ))}
        </ol>
        {grant && <p className="rounded-2xl bg-violet-50 p-3 text-sm italic leading-relaxed text-violet-ink ring-1 ring-inset ring-violet-200">“{grant.consentText}”</p>}
        {!grant && !pending ? (
          <SButton className="min-h-12 w-full" onClick={ask}>Send {first} the code</SButton>
        ) : (
          <>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold text-cocoa">Code {first} reads to you</span>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center font-mono text-2xl tracking-[.4em]" />
            </label>
            <SButton className="min-h-12 w-full" onClick={confirm} disabled={code.length !== 6}>Record consent</SButton>
            <button type="button" onClick={ask} className="min-h-11 w-full text-center text-xs font-bold text-violet-ink underline">Send a new code</button>
          </>
        )}
        <Note error={err} ok={ok} />
        <p className="flex items-center gap-1.5 text-xs font-semibold text-cocoa-2"><Icon name="shield" className="size-3.5 shrink-0" />Logged under both names · {first} can stop any time</p>
      </div>
    </StudioSheet>
  );
}

export function StatementSheet({ open, onClose, pageId, makerId, locale = "rw" }: { open: boolean; onClose: () => void; pageId: string; makerId: string; locale?: "rw" | "en" | "fr" }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [lang, setLang] = useState(locale);
  const [s, setS] = useState<Statement | null>(null);
  useEffect(() => {
    if (!open) return;
    void api<Statement>(`/pages/${pageId}/makers/${makerId}/statement?month=${month}&locale=${lang}`).then(setS).catch(() => setS(null));
  }, [open, pageId, makerId, month, lang]);
  return (
    <StudioSheet open={open} onClose={onClose} title={s ? `Statement · ${s.maker.name}` : "Statement"}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} aria-label="Language" className="rounded-2xl border border-hairline bg-white px-3 text-sm font-bold text-cocoa">
            <option value="rw">RW</option>
            <option value="en">EN</option>
            <option value="fr">FR</option>
          </select>
        </div>
        {s && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-paper p-2.5 ring-1 ring-inset ring-hairline"><p className="text-[11px] font-bold text-cocoa-2">Pieces</p><p className="font-display text-xl font-black text-cocoa">{s.totals.count}</p></div>
              <div className="rounded-2xl bg-emerald-50 p-2.5 ring-1 ring-inset ring-emerald-200"><p className="text-[11px] font-bold text-mint-ink">Direct to MoMo</p><p className="truncate font-display text-base font-black text-cocoa">{rwf(s.totals.directRwf)}</p></div>
              <div className="rounded-2xl bg-violet-50 p-2.5 ring-1 ring-inset ring-violet-200"><p className="text-[11px] font-bold text-violet-ink">Coop pays</p><p className="truncate font-display text-base font-black text-cocoa">{rwf(s.totals.cooperativeRwf)}</p></div>
            </div>
            <SButton className="min-h-12 w-full" onClick={() => speak(s.spoken, s.locale)}>🔊 Read it aloud</SButton>
            <p className="rounded-2xl bg-paper p-3 text-sm leading-relaxed text-cocoa-2">{s.spoken}</p>
            <ul className="divide-y divide-hairline text-sm">
              {s.lines.map((l) => (
                <li key={l.code + l.title} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block truncate font-bold text-cocoa">{l.title} · {l.size}</span><span className="text-xs text-cocoa-2">{l.code} · {new Date(l.date).toLocaleDateString("en-GB")} · {l.route === "DIRECT" ? "to your MoMo" : "via cooperative"}</span></span>
                  <span className="shrink-0 font-bold tabular-nums text-cocoa">{rwf(l.amountRwf)}</span>
                </li>
              ))}
              {s.lines.length === 0 && <li className="py-2 text-cocoa-2">No sales this month.</li>}
            </ul>
            <a href={`/api/pages/${pageId}/coop-statement.csv?month=${month}&locale=${lang}`} className="block text-center text-xs font-bold text-violet-ink underline">Cooperative statement (all makers, CSV)</a>
          </>
        )}
      </div>
    </StudioSheet>
  );
}

/** Studio home for a coop maker: opens the voice-and-icon mode when the admin switched it on. */
export function VoiceModeGate({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [me, setMe] = useState<CoopMe | null>(null);
  useEffect(() => {
    void api<CoopMe>(`/coop/me/${pageId}`)
      .then((m) => {
        setMe(m);
        let off = false;
        try {
          off = sessionStorage.getItem("nya_easy_off") === "1";
        } catch {
          off = false;
        }
        if (m.access.voiceMode && !off) router.replace(`/studio/${pageId}/easy`);
      })
      .catch(() => undefined);
  }, [pageId, router]);
  if (!me) return null;
  return (
    <Link href={`/studio/${pageId}/easy`} className="st-press st-hero flex items-center gap-4 rounded-[26px] p-4">
      <span className="grid size-16 shrink-0 place-items-center rounded-[22px] bg-white text-3xl shadow-sm" aria-hidden>🔊</span>
      <span className="min-w-0">
        <span className="block font-display text-xl font-black text-cocoa">Uburyo bworoshye</span>
        <span className="block text-sm text-cocoa-2">Easy mode: pictures and voice</span>
      </span>
      <Icon name="chevron" className="ml-auto size-6 shrink-0 text-cocoa-2" />
    </Link>
  );
}
