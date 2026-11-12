"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Stepper } from "@/components/ios";
import { Card, Chip, Field, Icon, Input, Note, SButton } from "@/components/studio";
import { DeskNav } from "@/components/tailor-studio";
import { api } from "@/lib/api";
import { useDrag } from "@/lib/drag";
import { haptic } from "@/lib/native";
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
const SLOT_PREVIEW = 6;

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
  const [showAll, setShowAll] = useState(false);

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
      setMsg(`${r.created} time${r.created === 1 ? "" : "s"} published · bookable now`);
      setPicked([]);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <DeskNav pageId={page.id} />
      <div className="flex items-center justify-between">
        <SButton variant="outline" className="w-11 px-0" aria-label="Previous week" disabled={week === 0} onClick={() => { setWeek(week - 1); setDay(0); }}><Icon name="back" className="size-4" /></SButton>
        <p className="font-bold">{week === 0 ? "This week" : week === 1 ? "Next week" : `In ${week} weeks`}</p>
        <SButton variant="outline" className="w-11 px-0" aria-label="Next week" onClick={() => { setWeek(week + 1); setDay(0); }}><Icon name="arrowRight" className="size-4" /></SButton>
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

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">{new Date(days[day]).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h3>
          {data && todays.length > 0 && (
            <span className="flex gap-1.5">
              <Chip tone="violet">{todays.filter((s) => s.booked).length} booked</Chip>
              <Chip>{todays.filter((s) => !s.booked).length} open</Chip>
            </span>
          )}
        </div>
        {!data && <div className="h-16 animate-pulse rounded-2xl bg-stone-100" />}
        {data && todays.length === 0 && <p className="text-sm text-stone-600">No times yet</p>}
        <ul className="space-y-2">
          {(showAll ? todays : todays.slice(0, SLOT_PREVIEW)).map((s) => {
            const time = kigaliTime(s.startsAt, { hour: "2-digit", minute: "2-digit", hour12: false });
            const remove = async () => {
              haptic("medium");
              await api(`/pages/${page.id}/slots/${s.id}`, { method: "DELETE" });
              await reload();
            };
            const row = (
              <div className={`flex items-center gap-3 rounded-2xl p-3 ${s.booked ? "bg-fuchsia-50 ring-1 ring-inset ring-fuchsia-200" : "bg-stone-50 ring-1 ring-inset ring-stone-200"}`}>
                <span className="w-14 text-lg font-black tabular-nums">{time}</span>
                <div className="min-w-0 flex-1 text-sm">
                  {s.booked ? (
                    <>
                      <p className="font-semibold">{s.customer?.name ?? s.customer?.phone} · fitting</p>
                      {s.customOrder && <Link href={`/studio/${page.id}/tailor/${s.customOrder.id}`} className="text-stone-600 underline">{s.customOrder.code} · {s.customOrder.title}</Link>}
                    </>
                  ) : (
                    <p className="truncate text-stone-600">Open · {s.durationMin} min · {s.location}</p>
                  )}
                </div>
                {!s.booked && (
                  <SButton variant="ghost" className="w-11 px-0" aria-label={`Remove ${time} slot`} onClick={remove}><Icon name="trash" className="size-4" /></SButton>
                )}
              </div>
            );
            return <li key={s.id}>{s.booked ? row : <SwipeToDelete label={`Remove ${time}`} onDelete={remove}>{row}</SwipeToDelete>}</li>;
          })}
        </ul>
        {todays.length > SLOT_PREVIEW && (
          <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} className="st-press inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-2xl text-sm font-semibold text-stone-600 hover:text-stone-900">
            {showAll ? "Show less" : `Show all ${todays.length}`}
            <Icon name="chevron" className={`size-3.5 transition-transform ${showAll ? "-rotate-90" : "rotate-90"}`} />
          </button>
        )}
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
          <div className="space-y-1.5">
            <span className="block text-[13px] font-bold text-cocoa">Length</span>
            <Stepper label="minutes" unit="min" value={duration} onChange={setDuration} min={15} max={120} step={15} />
          </div>
          <Field label="Where">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <Note error={err} ok={msg} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SButton className="min-h-12" disabled={busy || !picked.length} onClick={() => publish(false)}>Publish {picked.length || ""} time{picked.length === 1 ? "" : "s"}</SButton>
          <SButton variant="outline" className="min-h-12" disabled={busy || !picked.length} onClick={() => publish(true)}>Same times rest of week</SButton>
        </div>
      </Card>
    </div>
  );
}

const REVEAL = 96;

/**
 * iOS-style swipe: drag a row left to reveal a red Remove button (the row's own trash button stays for mouse and
 * keyboard). Springs back on a short drag; reduced motion just snaps.
 */
function SwipeToDelete({ label, onDelete, children }: { label: string; onDelete: () => void; children: ReactNode }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const bind = useDrag(
    ({ movement: [dx], last, tap }) => {
      if (tap) return;
      const base = open ? -REVEAL : 0;
      const next = Math.max(-REVEAL - 24, Math.min(0, base + dx));
      if (!last) {
        setDragging(true);
        setX(next);
        return;
      }
      setDragging(false);
      const isOpen = next < -REVEAL / 2;
      if (isOpen && !open) haptic("light");
      setOpen(isOpen);
      setX(isOpen ? -REVEAL : 0);
    },
    { axis: "x" },
  );
  return (
    <div className="relative overflow-hidden rounded-2xl">
      {open && (
        <button type="button" aria-label={label} onClick={onDelete} className="absolute inset-y-0 right-0 flex w-24 items-center justify-center gap-1 bg-red-700 text-sm font-bold text-[#fff]">
          <Icon name="trash" className="size-4" /> Remove
        </button>
      )}
      <div {...bind()} style={{ transform: `translateX(${x}px)`, touchAction: "pan-y" }} className={`relative rounded-2xl bg-surface ${dragging ? "" : "transition-transform duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none"}`}>
        {children}
      </div>
    </div>
  );
}
