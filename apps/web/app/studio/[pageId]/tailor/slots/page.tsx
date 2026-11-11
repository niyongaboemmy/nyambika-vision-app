"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Field, Input, Note, SButton, Select } from "@/components/studio";
import { DeskNav } from "@/components/tailor-studio";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { kigaliTime } from "@/lib/tailor";
import { useManagedPage } from "../../layout";

interface Slot {
  id: string;
  startsAt: string;
  durationMin: number;
  location: string;
  booked: boolean;
  customOrder: { id: string; code: string; title: string } | null;
  customer: { name: string | null; phone: string } | null;
}

const TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const DAY = 86400_000;

/** Kigali is UTC+2 all year: build the instant for a local date + time. */
function kigaliInstant(dayStartUtc: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dayStartUtc + (h - 2) * 3600_000 + m * 60_000);
}

function weekStart(offset: number) {
  const now = new Date(Date.now() + 2 * 3600_000); // Kigali wall clock
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return d + offset * 7 * DAY;
}

/** Fitting slot planner (FR-SIZE-07): phone-friendly week strip, tap times to publish. */
export default function Slots() {
  const { page } = useManagedPage();
  const [week, setWeek] = useState(0);
  const start = weekStart(week);
  const from = new Date(start - 2 * 3600_000).toISOString();
  const { data, reload } = useApi<Slot[]>(`/pages/${page.id}/slots?from=${encodeURIComponent(from)}`);
  const [day, setDay] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [duration, setDuration] = useState(45);
  const [location, setLocation] = useState(`${page.sector} studio`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => start + i * DAY), [start]);
  const dayKey = (iso: string | number) => kigaliTime(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
  const byDay = (d: number) => (data ?? []).filter((s) => dayKey(s.startsAt) === dayKey(d - 2 * 3600_000 + 12 * 3600_000));
  const todays = byDay(days[day]);
  const taken = new Set(todays.map((s) => kigaliTime(s.startsAt, { hour: "2-digit", minute: "2-digit", hour12: false })));

  async function publish(copyWeek = false) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const targets = copyWeek ? days.slice(day) : [days[day]];
      const slots = targets.flatMap((d) => picked.map((t) => ({ startsAt: kigaliInstant(d, t).toISOString(), durationMin: duration, location }))).filter((s) => new Date(s.startsAt).getTime() > Date.now());
      if (!slots.length) throw new Error("Pick times in the future");
      const r = await api<{ created: number }>(`/pages/${page.id}/slots`, { method: "POST", json: { slots } });
      setMsg(`${r.created} fitting time${r.created === 1 ? "" : "s"} published. Customers can book them now.`);
      setPicked([]);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <DeskNav pageId={page.id} />
      <div className="flex items-center justify-between">
        <SButton variant="outline" aria-label="Previous week" disabled={week === 0} onClick={() => { setWeek(week - 1); setDay(0); }}>←</SButton>
        <p className="font-bold">{week === 0 ? "This week" : week === 1 ? "Next week" : `In ${week} weeks`}</p>
        <SButton variant="outline" aria-label="Next week" onClick={() => { setWeek(week + 1); setDay(0); }}>→</SButton>
      </div>

      <div className="grid grid-cols-7 gap-1.5" role="tablist" aria-label="Day">
        {days.map((d, i) => {
          const n = byDay(d);
          const booked = n.filter((s) => s.booked).length;
          return (
            <button key={d} role="tab" aria-selected={i === day} onClick={() => { setDay(i); setPicked([]); }} className={`flex min-h-20 flex-col items-center justify-center rounded-2xl ${i === day ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-200"}`}>
              <span className="text-[11px] font-semibold uppercase">{new Date(d).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
              <span className="text-xl font-black">{new Date(d).getUTCDate()}</span>
              <span className="mt-0.5 flex gap-0.5" aria-label={`${n.length} slots, ${booked} booked`}>
                {n.slice(0, 4).map((s) => <span key={s.id} className={`size-1.5 rounded-full ${s.booked ? "bg-fuchsia-500" : i === day ? "bg-white/70" : "bg-stone-400"}`} />)}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="space-y-2">
        <h3 className="font-bold">{new Date(days[day]).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h3>
        {!data && <div className="h-16 animate-pulse rounded-2xl bg-stone-100" />}
        {data && todays.length === 0 && <p className="text-sm text-stone-600">No fitting times yet. Tap times below to publish some.</p>}
        <ul className="space-y-2">
          {todays.map((s) => (
            <li key={s.id} className={`flex items-center gap-3 rounded-2xl p-3 ${s.booked ? "bg-fuchsia-50 ring-1 ring-fuchsia-200" : "bg-stone-50 ring-1 ring-stone-200"}`}>
              <span className="w-14 text-lg font-black">{kigaliTime(s.startsAt, { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              <div className="min-w-0 flex-1 text-sm">
                {s.booked ? (
                  <>
                    <p className="font-semibold">{s.customer?.name ?? s.customer?.phone} · fitting</p>
                    {s.customOrder && <Link href={`/studio/${page.id}/tailor/${s.customOrder.id}`} className="text-stone-600 underline">{s.customOrder.code} · {s.customOrder.title}</Link>}
                  </>
                ) : (
                  <p className="text-stone-600">Open · {s.durationMin} min · {s.location}</p>
                )}
              </div>
              {!s.booked && (
                <SButton variant="ghost" aria-label="Remove slot" onClick={async () => { await api(`/pages/${page.id}/slots/${s.id}`, { method: "DELETE" }); await reload(); }}>✕</SButton>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-bold">Add fitting times</h3>
        <Field label="Times" group>
          <div className="grid grid-cols-5 gap-2">
            {TIMES.map((t) => {
              const exists = taken.has(t);
              const on = picked.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} disabled={exists} onClick={() => setPicked(on ? picked.filter((x) => x !== t) : [...picked, t])} className={`min-h-12 rounded-xl text-sm font-bold ${exists ? "bg-stone-100 text-stone-400 line-through" : on ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-300"}`}>
                  {t}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Length">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} min</option>)}
            </Select>
          </Field>
          <Field label="Where">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <Note error={err} ok={msg} />
        <div className="flex flex-wrap gap-2">
          <SButton className="min-h-12 flex-1" disabled={busy || !picked.length} onClick={() => publish(false)}>Publish {picked.length || ""} time{picked.length === 1 ? "" : "s"}</SButton>
          <SButton variant="outline" className="min-h-12" disabled={busy || !picked.length} onClick={() => publish(true)}>Same times rest of week</SButton>
        </div>
      </Card>
    </div>
  );
}
