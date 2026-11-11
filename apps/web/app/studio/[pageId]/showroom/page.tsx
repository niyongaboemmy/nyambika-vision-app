"use client";

import { RUNWAY_SKINS, SHOW, SHOWROOM_BUDGET } from "@nyambika/contracts";
import { useEffect, useState } from "react";
import { Badge, Card, Chip, Empty, Field, Icon, Input, Kpi, Meter, Note, ScreenSkeleton, SButton, SectionTitle, SLink, StudioSheet, Switch, Textarea } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { fmtWhen } from "@/lib/vr";
import { fmtMB } from "@/lib/xr";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

interface Candidate {
  productId: string;
  title: string;
  priceRwf: number;
  category: string;
  photo: string | null;
  has3d: boolean;
  runway: boolean;
}

interface StudioShow {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  status: string;
  phase: "CANCELLED" | "UPCOMING" | "DOORS_OPEN" | "LIVE" | "ENDED";
  runwayStatus: string;
  items: { productId: string; variantId: string; status: string }[];
  cover: string | null;
  rsvps: number;
  reactions: number;
  peakViewers: number;
  durationSec: number;
}

interface VrStudio {
  page: { id: string; handle: string; name: string; theme: string };
  booth: { enabled: boolean; banner: string; featured: string[] };
  showroom: { pieces: number; bytes: number; limitBytes: number; mannequins: number };
  candidates: Candidate[];
  shows: StudioShow[];
}

const PHASE_LABEL: Record<StudioShow["phase"], [string, string]> = {
  UPCOMING: ["PENDING_APPROVAL", "Scheduled"],
  DOORS_OPEN: ["ACCEPTED", "Doors open"],
  LIVE: ["LIVE", "Live now"],
  ENDED: ["COMPLETED", "Ended · replay"],
  CANCELLED: ["CANCELLED", "Cancelled"],
};

/** E35 studio: the 3D showroom booth (FR-VR-03, no 3D skills needed) and virtual fashion shows (FR-VR-05). */
export default function ShowroomStudioPage() {
  const { page } = useManagedPage();
  const { data, error, reload } = useApi<VrStudio>(`/vr/pages/${page.id}`);
  const [creating, setCreating] = useState(false);
  if (error) return <Note error={error} />;
  if (!data) return <ScreenSkeleton />;
  return (
    <div className="space-y-5">
      <SectionTitle as="h1" title="Showroom & shows" eyebrow={page.name} action={<SButton onClick={() => setCreating(true)}><Icon name="plus" className="size-4" /> Schedule a show</SButton>} />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <BoothCard data={data} onSaved={reload} />
        <ShowsCard data={data} onNew={() => setCreating(true)} onChanged={reload} />
      </div>
      <ShowSheet open={creating} onClose={() => setCreating(false)} data={data} onDone={() => (setCreating(false), void reload())} />
    </div>
  );
}

function BoothCard({ data, onSaved }: { data: VrStudio; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(data.booth.enabled);
  const [banner, setBanner] = useState(data.booth.banner);
  const [featured, setFeatured] = useState<string[]>(data.booth.featured);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const with3d = data.candidates.filter((c) => c.has3d);
  const toggle = (id: string) => setFeatured((f) => (f.includes(id) ? f.filter((x) => x !== id) : f.length >= SHOWROOM_BUDGET.mannequins ? f : [...f, id]));
  async function save() {
    setBusy(true);
    setMsg({});
    try {
      await api(`/vr/pages/${data.page.id}/booth`, { method: "PUT", json: { enabled, banner, featured } });
      setMsg({ ok: "Showroom saved" });
      onSaved();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-cocoa-2">3D showroom</p>
          <h2 className="font-display text-xl font-black text-cocoa">Your room in 3D and VR</h2>
        </div>
        <Badge value={enabled && data.showroom.pieces ? "LIVE" : "PAUSED"} label={enabled && data.showroom.pieces ? "Open" : "Closed"} />
      </div>
      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <Kpi label="Pieces in the room" value={data.showroom.pieces} hint={`${Math.min(data.showroom.pieces, SHOWROOM_BUDGET.mannequins)} on mannequins`} />
        <div className="st-card rounded-[18px] p-3">
          <Meter value={data.showroom.bytes} max={data.showroom.limitBytes} label={`Room size ${fmtMB(data.showroom.bytes)} of ${fmtMB(data.showroom.limitBytes)}`} />
          <p className="mt-1 text-[11px] text-cocoa-2">Loads in seconds on Wi-Fi</p>
        </div>
      </div>
      {with3d.length === 0 ? (
        <Empty icon="layers" title="No 3D pieces yet" action={<SLink href={`/studio/${data.page.id}/products`} variant="outline">Open my products</SLink>}>
          Build and approve a 3D model on a product page; it then appears in your showroom and on the 3D shelf.
        </Empty>
      ) : (
        <>
          <Switch checked={enabled} onChange={setEnabled} label="Showroom open" description="Shoppers can walk your room on a phone or enter it with a VR headset." />
          <Field label="Welcome line" hint="Shown on the banner above your mannequins (80 characters).">
            <Input value={banner} maxLength={80} onChange={(e) => setBanner(e.target.value)} placeholder="Murakaza neza · Welcome to my atelier" />
          </Field>
          <Field label={`On the mannequins (${featured.length}/${SHOWROOM_BUDGET.mannequins})`} hint="The rest hang on the rails. Pick none to use your page order." group>
            <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {with3d.map((c) => (
                <Tile key={c.productId} c={c} on={featured.includes(c.productId)} order={featured.indexOf(c.productId) + 1} onClick={() => toggle(c.productId)} />
              ))}
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <SButton onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save showroom"}</SButton>
            <SLink href={`/m/${data.page.handle}/showroom`} variant="outline" target="_blank" rel="noreferrer"><Icon name="eye" className="size-4" /> Open showroom</SLink>
          </div>
          <Note ok={msg.ok} error={msg.error} />
        </>
      )}
    </Card>
  );
}

function Tile({ c, on, order, onClick, note }: { c: Candidate; on: boolean; order: number; onClick: () => void; note?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${c.title}, ${rwf(c.priceRwf)}${note ? `, ${note}` : ""}`}
      onClick={onClick}
      className={`st-press relative w-[104px] shrink-0 overflow-hidden rounded-2xl bg-white text-left ring-2 ring-inset transition ${on ? "ring-violet-ink shadow-[0_8px_20px_-10px_rgba(98,57,201,.6)]" : "ring-hairline"}`}
    >
      <span className="block aspect-[4/5] bg-paper-2">{c.photo ? <img src={c.photo} alt="" className="size-full object-cover" /> : <Icon name="hanger" className="m-auto mt-8 size-6 text-cocoa-3" />}</span>
      <span className="block truncate px-2 pt-1.5 text-xs font-bold text-cocoa">{c.title}</span>
      <span className="block px-2 pb-2 text-[11px] font-semibold text-cocoa-2">{note ?? rwf(c.priceRwf)}</span>
      {on && <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-violet-ink text-xs font-black text-white">{order}</span>}
    </button>
  );
}

function ShowsCard({ data, onNew, onChanged }: { data: VrStudio; onNew: () => void; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const url = (id: string) => `${window.location.origin}/m/${data.page.handle}/shows/${id}`;
  async function cancel(id: string) {
    if (!confirm("Cancel this show? People who RSVP'd get no reminder.")) return;
    try {
      await api(`/vr/pages/${data.page.id}/shows/${id}/cancel`, { method: "POST" });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card className="min-w-0 space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-cocoa-2">Virtual fashion shows</p>
        <h2 className="font-display text-xl font-black text-cocoa">A runway for your collection</h2>
        <p className="mt-1 text-sm text-cocoa-2">Your pieces walk in 3D on an AI runway model (never a real shopper). Shoppers RSVP for a WhatsApp reminder, react live and buy with one hold.</p>
      </div>
      {data.shows.length === 0 ? (
        <Empty icon="sparkle" title="No shows yet" action={<SButton onClick={onNew}>Schedule your first show</SButton>}>Pick a date and up to {SHOW.maxItems} pieces. We build the runway for you.</Empty>
      ) : (
        <ul className="space-y-3">
          {data.shows.map((s) => {
            const [tone, label] = PHASE_LABEL[s.phase];
            const upcoming = s.phase === "UPCOMING" || s.phase === "DOORS_OPEN";
            return (
              <li key={s.id} className="flex gap-3 rounded-2xl bg-white p-2.5 ring-1 ring-inset ring-hairline">
                {s.cover ? <img src={s.cover} alt="" className="h-24 w-20 shrink-0 rounded-xl object-cover" /> : <span className="h-24 w-20 shrink-0 rounded-xl bg-paper-2" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge value={tone} label={label} />
                    {s.status !== "CANCELLED" && s.runwayStatus !== "READY" && <Chip tone={s.runwayStatus === "FAILED" ? "red" : "gold"}>Runway {s.runwayStatus.toLowerCase()}</Chip>}
                  </div>
                  <p className="truncate font-bold text-cocoa">{s.title}</p>
                  <p className="text-xs text-cocoa-2">{fmtWhen(s.startsAt)} · {s.items.length} looks · {Math.ceil(s.durationSec / 60)} min</p>
                  <p className="text-xs font-semibold text-cocoa">{s.rsvps} RSVP · {s.peakViewers} peak viewers · {s.reactions} reactions</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <SLink href={`/m/${data.page.handle}/shows/${s.id}`} variant="soft" className="min-h-9 px-3 text-xs" target="_blank" rel="noreferrer">Open</SLink>
                    <SButton variant="soft" className="min-h-9 px-3 text-xs" onClick={() => void navigator.clipboard?.writeText(url(s.id)).then(() => setCopied(s.id))}>
                      <Icon name="copy" className="size-3.5" /> {copied === s.id ? "Copied" : "Copy link"}
                    </SButton>
                    {upcoming && <SButton variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => void cancel(s.id)}>Cancel show</SButton>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Note error={err} />
    </Card>
  );
}

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ShowSheet({ open, onClose, data, onDone }: { open: boolean; onClose: () => void; data: VrStudio; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  /** Exact time from a quick chip ("Now" must not round down to the minute). */
  const [exact, setExact] = useState<Date | null>(null);
  const [desc, setDesc] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [skin, setSkin] = useState<string>("#825C43");
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = new Date(Date.now() + 86400_000);
    t.setHours(18, 0, 0, 0);
    setWhen(localInput(t));
    setExact(null);
    setErr(null);
  }, [open]);
  const toggle = (id: string) => setItems((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= SHOW.maxItems ? x : [...x, id]));
  const quick: [string, () => Date][] = [
    ["Now", () => new Date()],
    ["In 1 hour", () => new Date(Date.now() + 3600_000)],
    ["Tomorrow 18:00", () => {
      const t = new Date(Date.now() + 86400_000);
      t.setHours(18, 0, 0, 0);
      return t;
    }],
  ];
  const usable = data.candidates.filter((c) => c.runway || c.has3d);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const show = await api<{ id: string }>(`/vr/pages/${data.page.id}/shows`, {
        method: "POST",
        json: { title, description: desc, startsAt: (exact ?? new Date(when)).toISOString(), items: items.map((productId) => ({ productId })), modelSkin: skin },
      });
      if (cover) {
        const fd = new FormData();
        fd.append("file", cover);
        await api(`/vr/pages/${data.page.id}/shows/${show.id}/cover`, { method: "POST", body: fd });
      }
      setTitle("");
      setDesc("");
      setItems([]);
      setCover(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StudioSheet
      open={open}
      onClose={onClose}
      title="Schedule a fashion show"
      footer={<SButton className="w-full" onClick={() => void submit()} disabled={busy || title.trim().length < 3 || !items.length || !when}>{busy ? "Scheduling…" : `Schedule show · ${items.length} look${items.length === 1 ? "" : "s"}`}</SButton>}
    >
      <div className="space-y-4">
        <Field label="Show name">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Imigongo Nights · launch show" />
        </Field>
        <Field label="Date and time" hint="Kigali time on your phone. Pick “Now” to go live straight away.">
          <Input type="datetime-local" value={when} onChange={(e) => (setWhen(e.target.value), setExact(null))} />
        </Field>
        <Field label="Quick times" group>
          <div className="flex flex-wrap gap-2">
            {quick.map(([label, at]) => (
              <SButton key={label} type="button" variant="soft" className="min-h-9 px-3 text-xs" onClick={() => {
                const d = at();
                setWhen(localInput(d));
                setExact(d);
              }}>{label}</SButton>
            ))}
          </div>
        </Field>
        <Field label={`Looks on the runway (${items.length}/${SHOW.maxItems})`} hint="They walk in the order you tap them. Bags and shoes walk on a stand." group>
          {usable.length ? (
            <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {usable.map((c) => (
                <Tile key={c.productId} c={c} on={items.includes(c.productId)} order={items.indexOf(c.productId) + 1} onClick={() => toggle(c.productId)} note={c.runway ? undefined : "on a stand"} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-cocoa-2">Add a photo with a clean cut-out to a product first.</p>
          )}
        </Field>
        <Field label="Runway model skin tone" hint="A synthetic AI model, never a real person or a shopper's twin." group>
          <div className="flex gap-2" role="radiogroup" aria-label="Runway model skin tone">
            {RUNWAY_SKINS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={skin === s} aria-label={`Skin tone ${s}`} onClick={() => setSkin(s)} className={`size-10 rounded-full ring-2 ring-offset-2 ${skin === s ? "ring-violet-ink" : "ring-transparent"}`} style={{ background: s }} />
            ))}
          </div>
        </Field>
        <Field label="About the show (optional)">
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} placeholder="Four new dresses walk the runway in 3D…" />
        </Field>
        <Field label="Cover image (optional)" hint="Defaults to the first look's photo.">
          <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
        </Field>
        <Note error={err} />
      </div>
    </StudioSheet>
  );
}
