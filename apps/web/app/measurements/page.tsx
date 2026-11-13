"use client";

import { MEASUREMENT_FIELDS, type Measurements } from "@nyambika/contracts/tailor-data";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Screen, TopBar } from "@/components/ui";
import { Fact, InfoTip } from "@/components/kit";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { kigaliTime, MEASUREMENT_LABEL, type MeasurementsView } from "@/lib/tailor";
import { Icon } from "@/components/icons";
import { ReturnButton } from "@/components/return-button";
import { returnTarget } from "@/lib/nav";

/** Private measurement profile (FR-SIZE-01/04/08): encrypted, shared only by explicit time-limited choice. */
export default function MeasurementsPage() {
  const { t } = useSession();
  const { data, setData, reload } = useApi<MeasurementsView>("/measurements");
  const [draft, setDraft] = useState<Measurements>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // Navigation pass: opened from the buy sheet (or a tailor ask) with ?next=: once saved, go back there.
  const [back, setBack] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setBack(returnTarget()), []);

  useEffect(() => {
    if (data) setDraft(data.profile ?? data.prefill ?? {});
  }, [data]);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => typeof v === "number" && !Number.isNaN(v)));
      setData(await api<MeasurementsView>("/measurements", { method: "PUT", json: { measurements: clean, consent: true, source: data?.profile ? "MANUAL" : data?.prefill ? "TWIN_ESTIMATE" : "MANUAL" } }));
      setOk("Saved, encrypted. Only you can see these.");
      setSaved(true);
      navigator.vibrate?.(10);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fromTwin = !data?.profile && data?.prefill;
  const fields = more ? MEASUREMENT_FIELDS : MEASUREMENT_FIELDS.slice(0, 4);
  return (
    <Screen>
      <TopBar back="/" title={t("tailor.measurements")} />
      <main className="space-y-4 px-4 pb-12">
        <section className="rounded-3xl bg-gradient-to-br from-violet/25 to-terra/20 p-4">
          <p className="font-display text-2xl font-black">Your fit, privately</p>
          <ul aria-label="How your measurements are used" className="mt-2 flex flex-wrap gap-1.5">
            <li><Fact icon="ruler">Size advice</Fact></li>
            <li><Fact icon="lock">Shared only by you · 1 tailor · 14 days</Fact></li>
          </ul>
          {fromTwin && (
            <p className="mt-2 flex items-center gap-1 rounded-2xl bg-black/30 px-3 py-2 text-sm">
              <Icon name="sparkle" className="size-4 text-gold" /> From your twin ({data!.twinSize}) · ±3 cm
              <InfoTip label="About twin estimates">Prefilled from your twin&apos;s size estimate. Expect ±3 cm: check with a tape measure.</InfoTip>
            </p>
          )}
        </section>

        {!data ? (
          <div className="h-64 rounded-3xl skeleton" />
        ) : (
          <section className="glass rounded-3xl p-4">
            <div className="grid grid-cols-2 gap-3">
              {fields.map((k) => (
                <label key={k} className="block rounded-2xl bg-black/25 p-3">
                  <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon name={MEASUREMENT_LABEL[k].glyph} className="size-4 text-gold" />{MEASUREMENT_LABEL[k].label}</span>
                  <span className="mt-1 flex items-baseline gap-1">
                    <input
                      inputMode="decimal"
                      value={draft[k] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value === "" ? undefined : Number(e.target.value.replace(",", ".")) })}
                      className="w-full bg-transparent font-display text-2xl font-black outline-none focus-visible:underline"
                      aria-describedby={`${k}-hint`}
                    />
                    <span className="text-sm text-mut">cm</span>
                  </span>
                  <span id={`${k}-hint`} className="block text-[11px] leading-tight text-mut">{MEASUREMENT_LABEL[k].hint}</span>
                </label>
              ))}
            </div>
            <button onClick={() => setMore(!more)} aria-expanded={more} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold">{more ? "Fewer measurements" : "+ Inseam, shoulder, arm, neck"}</button>
            <div className="mt-2 flex items-center gap-1 rounded-2xl bg-black/25 py-1 pl-3 pr-1">
              <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  role="switch"
                  checked={consent || Boolean(data.profile)}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-label="Store my measurements encrypted to recommend sizes"
                  className="peer sr-only"
                />
                <span className="flex-1">Store encrypted · size advice</span>
                <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold ${consent || data.profile ? "bg-[#0f8a5f]" : "bg-white/20"}`}>
                  <span className={`absolute top-0.5 size-6 rounded-full bg-[#fff] shadow transition-all ${consent || data.profile ? "left-[22px]" : "left-0.5"}`} />
                </span>
              </label>
              <InfoTip label="About storing measurements">Store my measurements encrypted to recommend sizes. I can delete them any time.</InfoTip>
            </div>
            <ErrorNote error={err} />
            {ok && <p role="status" className="mt-2 text-sm text-mint">{ok}</p>}
            {back && saved && <div className="mt-3"><ReturnButton to={back} auto /></div>}
            <Button className="mt-3 w-full" disabled={busy || (!consent && !data.profile)} onClick={save}>{busy ? "Saving…" : data.profile ? "Save changes" : "Save measurements"}</Button>
          </section>
        )}

        {data && data.shares.length > 0 && (
          <section className="glass rounded-3xl p-4">
            <p className="mb-2 font-semibold">Shared with tailors</p>
            <ul className="space-y-2">
              {data.shares.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-black/25 p-3 text-sm">
                  <span className={`size-2.5 shrink-0 rounded-full ${s.active ? "bg-mint shadow-[0_0_8px_#34d399]" : "bg-white/30"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.page?.name}{s.customOrder ? ` · ${s.customOrder.code}` : ""}</p>
                    <p className="text-xs text-mut">{s.active ? `Until ${kigaliTime(s.expiresAt, { day: "numeric", month: "short" })}` : s.revokedAt ? "Ended" : "Expired"}</p>
                  </div>
                  {s.active && (
                    <button className="min-h-11 rounded-xl px-4 font-semibold" onClick={async () => { await api(`/measurements/shares/${s.id}/revoke`, { method: "POST" }); await reload(); }}>Stop</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data?.profile && (
          <button className="min-h-11 w-full text-center text-sm text-mut underline" onClick={async () => { if (confirm("Delete your measurements and end every share?")) { await api("/measurements", { method: "DELETE" }); await reload(); } }}>
            Delete my measurements
          </button>
        )}
      </main>
    </Screen>
  );
}
