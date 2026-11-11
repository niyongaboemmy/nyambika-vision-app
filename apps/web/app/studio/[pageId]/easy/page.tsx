"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ScreenSkeleton } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { speak, type CoopMe, type Statement } from "@/lib/growth";
import { useManagedPage } from "../layout";

/*
 * E31 voice-and-icon mode (FR-COOP-08, UI-06): a friendly app for makers who read little.
 * Huge targets, pictograms with colour + shape coding, one question per screen, every prompt spoken
 * (Kinyarwanda first), number pad for prices, camera-first capture with a framing guide.
 * With ?assist=<makerId> a cooperative admin uses the same flow for a maker who gave recorded consent.
 */

type L = "rw" | "en" | "fr";
const S = {
  hello: { rw: "Muraho", en: "Hello", fr: "Bonjour" },
  add: { rw: "Ongeraho umwenda", en: "Add a piece", fr: "Ajouter une pièce" },
  money: { rw: "Amafaranga yanjye", en: "My money", fr: "Mon argent" },
  orders: { rw: "Komande", en: "Orders", fr: "Commandes" },
  help: { rw: "Ubufasha", en: "Help", fr: "Aide" },
  photo: { rw: "Fotora umwenda uwurambitse hasi, ku manywa. Shyira umwenda mu murongo.", en: "Lay the piece flat in daylight and fit it inside the outline.", fr: "Posez la pièce à plat, en pleine lumière, dans le contour." },
  takePhoto: { rw: "Fotora", en: "Take photo", fr: "Photo" },
  retake: { rw: "Ongera", en: "Again", fr: "Refaire" },
  good: { rw: "Ni byiza", en: "Looks good", fr: "C'est bien" },
  type: { rw: "Ni uwuhe mwenda?", en: "What kind of piece?", fr: "Quel type de pièce ?" },
  colour: { rw: "Ni irihe bara?", en: "Which colour?", fr: "Quelle couleur ?" },
  price: { rw: "Igiciro ni angahe?", en: "What is the price?", fr: "Quel est le prix ?" },
  review: { rw: "Reba neza, hanyuma wohereze.", en: "Check it, then send.", fr: "Vérifiez, puis envoyez." },
  send: { rw: "Ohereza", en: "Send", fr: "Envoyer" },
  sending: { rw: "Birimo koherezwa…", en: "Sending…", fr: "Envoi…" },
  sent: { rw: "Byoherejwe! Umuyobozi azabireba.", en: "Sent! Your admin will check it.", fr: "Envoyé ! L'admin va vérifier." },
  badPhoto: { rw: "Ifoto ntisobanutse. Ongera ufotore ku manywa.", en: "The photo is not clear. Take it again in daylight.", fr: "Photo pas claire. Reprenez-la en pleine lumière." },
  month: { rw: "Uku kwezi", en: "This month", fr: "Ce mois" },
  pieces: { rw: "imyenda", en: "pieces", fr: "pièces" },
  coopPays: { rw: "Koperative izakwishyura", en: "Your cooperative pays you", fr: "La coopérative vous paie" },
  direct: { rw: "Kuri MoMo yawe", en: "On your MoMo", fr: "Sur votre MoMo" },
  listen: { rw: "Umva", en: "Listen", fr: "Écouter" },
  noOrders: { rw: "Nta komande itegereje.", en: "No orders waiting.", fr: "Aucune commande en attente." },
  accept: { rw: "Emeza", en: "Accept", fr: "Accepter" },
  accepted: { rw: "Wemeje komande. Umuguzi yamenyeshejwe.", en: "Accepted. The buyer has been told.", fr: "Acceptée. L'acheteur est prévenu." },
  helpText: {
    rw: "Kanda ishusho ushaka. Ijwi rizakuyobora. Udafite telefoni igezweho, kanda *775# kuri telefoni iyo ari yo yose.",
    en: "Tap the picture you want. The voice will guide you. Without a smartphone, dial *775# on any phone.",
    fr: "Touchez l'image voulue. La voix vous guide. Sans smartphone, composez *775# sur n'importe quel téléphone.",
  },
  askHelp: { rw: "arashaka kugufasha", en: "wants to help you", fr: "veut vous aider" },
  yes: { rw: "Yego", en: "Yes", fr: "Oui" },
  no: { rw: "Oya", en: "No", fr: "Non" },
  back: { rw: "Subira", en: "Back", fr: "Retour" },
  normal: { rw: "Uburyo busanzwe", en: "Normal view", fr: "Vue normale" },
} as const;

const CATS: { key: string; label: Record<L, string>; tone: string; path: ReactNode }[] = [
  { key: "dress", label: { rw: "Ikanzu", en: "Dress", fr: "Robe" }, tone: "#E0703F", path: <path d="M24 6h16l3 10-5 3 8 37H18l8-37-5-3z" /> },
  { key: "umushanana", label: { rw: "Umushanana", en: "Umushanana", fr: "Umushanana" }, tone: "#6239C9", path: <><path d="M24 6h16l3 10-5 3 8 37H18l8-37-5-3z" /><path d="M24 8l22 46" stroke="#fff" strokeWidth="4" fill="none" /></> },
  { key: "shirt", label: { rw: "Ishati", en: "Shirt", fr: "Chemise" }, tone: "#1A8C8C", path: <path d="M22 8l10 5 10-5 14 10-7 8-5-3v31H20V23l-5 3-7-8z" /> },
  { key: "skirt", label: { rw: "Ijipo", en: "Skirt", fr: "Jupe" }, tone: "#C48A10", path: <><rect x="20" y="10" width="24" height="6" rx="2" /><path d="M20 18h24l8 38H12z" /></> },
  { key: "top", label: { rw: "Agapira", en: "Top", fr: "Haut" }, tone: "#B3261E", path: <path d="M22 12l10 3 10-3 12 10-6 6-4-3v20H20V25l-4 3-6-6z" /> },
  { key: "kids", label: { rw: "Iby'abana", en: "Kids", fr: "Enfants" }, tone: "#1F7A4D", path: <><circle cx="32" cy="14" r="7" /><path d="M26 24h12l2 6-3 2 5 22H22l5-22-3-2z" /></> },
];

const COLOURS: { name: Record<L, string>; en: string; hex: string }[] = [
  { name: { rw: "Ubururu", en: "Blue", fr: "Bleu" }, en: "Indigo", hex: "#2B4EA2" },
  { name: { rw: "Umutuku", en: "Red", fr: "Rouge" }, en: "Red", hex: "#B3261E" },
  { name: { rw: "Umuhondo", en: "Yellow", fr: "Jaune" }, en: "Gold", hex: "#D4A017" },
  { name: { rw: "Icyatsi", en: "Green", fr: "Vert" }, en: "Green", hex: "#1F7A4D" },
  { name: { rw: "Umukara", en: "Black", fr: "Noir" }, en: "Black", hex: "#222222" },
  { name: { rw: "Umweru", en: "White", fr: "Blanc" }, en: "White", hex: "#F4F1EA" },
  { name: { rw: "Iroza", en: "Pink", fr: "Rose" }, en: "Pink", hex: "#E86A9A" },
  { name: { rw: "Ikigina", en: "Brown", fr: "Marron" }, en: "Brown", hex: "#7A4A2A" },
];

type Screen = "home" | "add" | "money" | "orders" | "help";
interface Summary {
  maker: { id: string; name: string };
  sales: CoopMe["sales"];
  payout: CoopMe["payout"];
  orders: CoopMe["orders"];
  pendingAssist?: CoopMe["pendingAssist"];
  grant?: { id: string; expiresAt: string };
  locale: L;
}

export default function EasyPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Easy />
    </Suspense>
  );
}

function Easy() {
  const { page } = useManagedPage();
  const q = useSearchParams();
  const router = useRouter();
  const assist = q.get("assist");
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("home");

  const load = useCallback(async () => {
    try {
      if (assist) {
        const r = await api<Summary & { grant: Summary["grant"] }>(`/pages/${page.id}/assist/${assist}`);
        setData({ ...r, locale: "rw" });
      } else {
        const r = await api<CoopMe>(`/coop/me/${page.id}`);
        setData({ maker: r.maker, sales: r.sales, payout: r.payout, orders: r.orders, pendingAssist: r.pendingAssist, locale: r.access.locale });
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [assist, page.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const l = data?.locale ?? "rw";
  const say = useCallback((t: string) => speak(t, l), [l]);
  const go = (s: Screen, label?: string) => {
    navigator.vibrate?.(8);
    if (label) say(label);
    setScreen(s);
    window.scrollTo({ top: 0 });
  };

  if (err) return <div className="rounded-[28px] bg-red-50 p-6 text-center text-lg font-bold text-red-800">{err}</div>;
  if (!data) return <ScreenSkeleton />;
  const first = data.maker.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-6">
      {assist && (
        <p className="flex items-center gap-2 rounded-2xl bg-violet-50 p-3 text-sm font-bold text-violet-ink ring-1 ring-inset ring-violet-200">
          <span aria-hidden>🤝</span> Helping {data.maker.name} with their consent{data.grant ? ` · until ${new Date(data.grant.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""} · every step is logged
        </p>
      )}
      {screen === "home" && (
        <>
          <header className="flex items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-violet-400 font-display text-2xl font-black text-white" aria-hidden>{first[0]}</span>
            <h1 className="min-w-0 flex-1 font-display text-3xl font-black leading-tight text-cocoa">{S.hello[l]}, {first}!</h1>
            <SpeakButton onClick={() => say(`${S.hello[l]} ${first}. ${S.helpText[l]}`)} label={S.listen[l]} />
          </header>
          {data.pendingAssist && !assist && <ConsentAsk pageId={page.id} ask={data.pendingAssist} l={l} say={say} onDone={load} />}
          <div className="grid grid-cols-2 gap-4">
            <Tile shape="circle" color="#E0703F" emoji="📷" label={S.add[l]} onClick={() => go("add", S.add[l])} />
            <Tile shape="square" color="#159A66" emoji="💰" label={S.money[l]} onClick={() => go("money", S.money[l])} />
            <Tile shape="diamond" color="#6239C9" emoji="📦" label={S.orders[l]} badge={data.orders.length} onClick={() => go("orders", S.orders[l])} />
            <Tile shape="pill" color="#C48A10" emoji="🔊" label={S.help[l]} onClick={() => go("help", S.helpText[l])} />
          </div>
          {!assist && (
            <button
              type="button"
              className="mx-auto block text-sm font-bold text-cocoa-2 underline"
              onClick={() => {
                try {
                  sessionStorage.setItem("nya_easy_off", "1");
                } catch {
                  /* private mode */
                }
                router.push(`/studio/${page.id}`);
              }}
            >
              {S.normal[l]}
            </button>
          )}
        </>
      )}
      {screen !== "home" && <BackBar label={S.back[l]} onBack={() => go("home")} />}
      {screen === "add" && <AddFlow pageId={page.id} makerId={data.maker.id} assist={assist} l={l} say={say} onDone={() => { void load(); go("home"); }} />}
      {screen === "money" && <Money pageId={page.id} makerId={data.maker.id} data={data} l={l} say={say} />}
      {screen === "orders" && <Orders pageId={page.id} data={data} assist={assist} l={l} say={say} onDone={load} />}
      {screen === "help" && (
        <section className="space-y-4 rounded-[28px] bg-amber-50 p-6 text-center ring-1 ring-inset ring-amber-200">
          <p className="text-6xl" aria-hidden>🔊</p>
          <p className="text-xl font-bold leading-relaxed text-cocoa">{S.helpText[l]}</p>
          <p className="font-mono text-4xl font-black tracking-widest text-cocoa">*775#</p>
          <SpeakButton big onClick={() => say(S.helpText[l])} label={S.listen[l]} />
        </section>
      )}
    </div>
  );
}

function SpeakButton({ onClick, label, big }: { onClick: () => void; label: string; big?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`st-press grid shrink-0 place-items-center rounded-full bg-cocoa text-white shadow-lg ${big ? "mx-auto size-20 text-3xl" : "size-14 text-2xl"}`}>
      <span aria-hidden>🔊</span>
    </button>
  );
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="st-press flex min-h-14 items-center gap-3 rounded-2xl bg-white px-4 text-lg font-extrabold text-cocoa ring-1 ring-inset ring-hairline">
      <span aria-hidden className="text-2xl">⬅️</span> {label}
    </button>
  );
}

const SHAPE: Record<string, string> = {
  circle: "rounded-full",
  square: "rounded-[22px]",
  diamond: "rounded-[18px] rotate-45",
  pill: "rounded-[30px] w-[86px]",
};

/** Big home tile: colour + shape coding so makers recognise it without reading. */
function Tile({ emoji, label, color, shape, badge, onClick }: { emoji: string; label: string; color: string; shape: keyof typeof SHAPE; badge?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="st-press st-card relative flex aspect-square flex-col items-center justify-center gap-3 rounded-[32px] p-3 text-center" style={{ boxShadow: `inset 0 -6px 0 ${color}22` }}>
      <span className={`grid size-[74px] place-items-center ${SHAPE[shape]}`} style={{ background: color }}>
        <span className={`text-4xl ${shape === "diamond" ? "-rotate-45" : ""}`} aria-hidden>{emoji}</span>
      </span>
      <span className="font-display text-xl font-black leading-tight text-cocoa">{label}</span>
      {badge ? <span className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-terra-ink text-lg font-black text-white ring-4 ring-white" aria-label={`${badge}`}>{badge}</span> : null}
    </button>
  );
}

function ConsentAsk({ pageId, ask, l, say, onDone }: { pageId: string; ask: NonNullable<CoopMe["pendingAssist"]>; l: L; say: (t: string) => void; onDone: () => Promise<void> }) {
  const answer = async (approve: boolean) => {
    await api(`/coop/me/${pageId}/assist/${ask.id}`, { method: "POST", json: { approve } });
    await onDone();
  };
  return (
    <section className="space-y-3 rounded-[28px] bg-violet-50 p-5 ring-2 ring-inset ring-violet-200">
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>🤝</span>
        <p className="flex-1 text-lg font-extrabold text-cocoa">{ask.adminName} {S.askHelp[l]}</p>
        <SpeakButton onClick={() => say(ask.consentText)} label={S.listen[l]} />
      </div>
      <p className="text-sm leading-relaxed text-violet-ink">{ask.consentText}</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => answer(true)} className="st-press min-h-16 rounded-2xl bg-emerald-600 text-xl font-black text-white">👍 {S.yes[l]}</button>
        <button type="button" onClick={() => answer(false)} className="st-press min-h-16 rounded-2xl bg-white text-xl font-black text-cocoa ring-2 ring-inset ring-hairline">👎 {S.no[l]}</button>
      </div>
    </section>
  );
}

// ---------------- Add a piece: photo → type → colour → price → send ----------------

function AddFlow({ pageId, makerId, assist, l, say, onDone }: { pageId: string; makerId: string; assist: string | null; l: L; say: (t: string) => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof CATS)[number] | null>(null);
  const [colour, setColour] = useState<(typeof COLOURS)[number] | null>(null);
  const [price, setPrice] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "bad">("idle");
  const [err, setErr] = useState<string | null>(null);
  const prompts = [S.photo[l], S.type[l], S.colour[l], S.price[l], S.review[l]];
  useEffect(() => {
    say(prompts[step]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function setShot(b: Blob) {
    setPhoto(b);
    setPreview(URL.createObjectURL(b));
  }

  async function send() {
    if (!photo || !cat || !colour || !price) return;
    setState("sending");
    setErr(null);
    try {
      const title = `${colour.en} ${cat.label.en.toLowerCase()}`;
      const body = { title, category: cat.key, priceRwf: Number(price), madeToOrder: true, leadTimeDays: 3, makerIds: [makerId], payoutTarget: "PAGE", variants: [{ colourName: colour.en, colourHex: colour.hex, sizes: ["S", "M", "L", "XL"], stock: 0 }] };
      const p = assist
        ? await api<{ id: string; variants: { id: string }[] }>(`/pages/${pageId}/assist/${assist}/products`, { method: "POST", json: body })
        : await api<{ id: string; variants: { id: string }[] }>(`/pages/${pageId}/products`, { method: "POST", json: body });
      const fd = new FormData();
      fd.append("file", new File([photo], "piece.jpg", { type: photo.type || "image/jpeg" }));
      const r = await api<{ readiness: string }>(`/variants/${p.variants[0].id}/image`, { method: "POST", body: fd });
      // Makers submit for approval; an admin helping a maker submits the same way (approval stays a separate step).
      if (!assist) await api(`/products/${p.id}/status`, { method: "POST", json: { action: "publish" } });
      if (r.readiness === "NEEDS_BETTER_PHOTO") {
        setState("bad");
        say(S.badPhoto[l]);
      } else {
        setState("sent");
        say(S.sent[l]);
        navigator.vibrate?.([30, 60, 30]);
      }
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }

  if (state === "sent" || state === "bad")
    return (
      <section className={`space-y-5 rounded-[32px] p-8 text-center ${state === "sent" ? "bg-emerald-50" : "bg-amber-50"}`}>
        <p className="text-7xl" aria-hidden>{state === "sent" ? "🎉" : "💡"}</p>
        <p className="font-display text-2xl font-black text-cocoa">{state === "sent" ? S.sent[l] : S.badPhoto[l]}</p>
        <button type="button" onClick={onDone} className="st-press mx-auto grid size-24 place-items-center rounded-full bg-emerald-600 text-5xl text-white shadow-lg" aria-label={S.good[l]}>✓</button>
      </section>
    );

  return (
    <section className="space-y-5">
      <ol className="flex justify-center gap-2" aria-label={`Step ${step + 1} of 5`}>
        {prompts.map((_, i) => <li key={i} className={`h-3 rounded-full transition-all ${i === step ? "w-10 bg-terra-ink" : i < step ? "w-3 bg-emerald-500" : "w-3 bg-paper-3"}`} />)}
      </ol>
      <div className="flex items-center gap-3">
        <p className="flex-1 font-display text-2xl font-black leading-tight text-cocoa">{prompts[step]}</p>
        <SpeakButton onClick={() => say(prompts[step])} label={S.listen[l]} />
      </div>

      {step === 0 && <Capture preview={preview} onShot={setShot} l={l} onNext={() => setStep(1)} />}

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CATS.map((c) => (
            <button key={c.key} type="button" aria-pressed={cat?.key === c.key} onClick={() => { setCat(c); say(c.label[l]); setTimeout(() => setStep(2), 450); }} className={`st-press st-card flex flex-col items-center gap-2 rounded-[26px] p-4 ring-4 ring-inset ${cat?.key === c.key ? "ring-cocoa" : "ring-transparent"}`}>
              <svg viewBox="0 0 64 64" className="size-20" fill={c.tone} aria-hidden>{c.path}</svg>
              <span className="text-lg font-black text-cocoa">{c.label[l]}</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-4 gap-3">
          {COLOURS.map((c) => (
            <button key={c.hex} type="button" aria-pressed={colour?.hex === c.hex} aria-label={c.name[l]} onClick={() => { setColour(c); say(c.name[l]); setTimeout(() => setStep(3), 450); }} className="st-press flex flex-col items-center gap-1.5">
              <span className={`grid size-[68px] place-items-center rounded-full ring-4 ${colour?.hex === c.hex ? "ring-cocoa" : "ring-white"} shadow-md`} style={{ background: c.hex }}>
                {colour?.hex === c.hex && <span className="text-2xl" style={{ color: c.hex === "#F4F1EA" ? "#1d1814" : "#fff" }}>✓</span>}
              </span>
              <span className="text-sm font-bold text-cocoa">{c.name[l]}</span>
            </button>
          ))}
        </div>
      )}

      {step === 3 && <NumberPad value={price} onChange={setPrice} onDone={() => { say(`${Number(price).toLocaleString("en-US")} RWF`); setStep(4); }} l={l} />}

      {step === 4 && cat && colour && (
        <div className="space-y-4">
          <div className="st-card flex items-center gap-4 rounded-[28px] p-4">
            {preview && <img src={preview} alt="" className="size-28 shrink-0 rounded-2xl object-cover" />}
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-2 text-xl font-black text-cocoa"><svg viewBox="0 0 64 64" className="size-9" fill={cat.tone} aria-hidden>{cat.path}</svg>{cat.label[l]}</p>
              <p className="flex items-center gap-2 text-lg font-bold text-cocoa"><span className="size-7 rounded-full ring-2 ring-hairline" style={{ background: colour.hex }} />{colour.name[l]}</p>
              <p className="font-display text-2xl font-black text-cocoa">{rwf(Number(price))}</p>
            </div>
          </div>
          {err && (isExpectedText(err) ? <LimitState error={err} tone="light" /> : <p className="rounded-2xl bg-red-50 p-3 font-bold text-red-800">{err}</p>)}
          <button type="button" onClick={send} disabled={state === "sending"} className="st-press st-cta flex min-h-20 w-full items-center justify-center gap-3 rounded-[28px] font-display text-2xl font-black text-white disabled:opacity-60">
            <span aria-hidden>📤</span> {state === "sending" ? S.sending[l] : S.send[l]}
          </button>
        </div>
      )}

      {step > 0 && step < 4 && (
        <button type="button" onClick={() => setStep(step - 1)} className="mx-auto block min-h-12 px-4 text-base font-bold text-cocoa-2 underline">⬅️ {S.back[l]}</button>
      )}
    </section>
  );
}

/** Camera-first capture with a guided framing overlay; falls back to the phone's camera app / file picker. */
function Capture({ preview, onShot, onNext, l }: { preview: string | null; onShot: (b: Blob) => void; onNext: () => void; l: L }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!preview && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          if (video.current) video.current.srcObject = s;
          setLive(true);
        })
        .catch(() => setLive(false));
    }
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [preview]);

  function snap() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(b), "image/jpeg", 0.9);
    navigator.vibrate?.(20);
  }

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[4/5] h-[44dvh] max-w-full overflow-hidden rounded-[32px] bg-cocoa">
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <video ref={video} autoPlay playsInline muted className={`size-full object-cover ${live ? "" : "hidden"}`} />}
        {!preview && (
          // Framing guide: garment outline + corner brackets.
          <svg viewBox="0 0 100 125" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            <path d="M38 14h24l5 14-8 4 13 78H28l13-78-8-4z" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="1.2" strokeDasharray="3 2.5" />
            {[["M8 18V8h10"], ["M82 8h10v10"], ["M8 107v10h10"], ["M82 117h10v-10"]].map(([d]) => <path key={d} d={d} fill="none" stroke="#F2B84B" strokeWidth="2.5" strokeLinecap="round" />)}
          </svg>
        )}
        {!preview && !live && <p className="absolute inset-x-0 bottom-6 text-center text-5xl" aria-hidden>👗☀️</p>}
      </div>
      {preview ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="st-press flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-xl font-black text-cocoa ring-2 ring-inset ring-hairline">
            🔄 {S.retake[l]}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && onShot(e.target.files[0])} />
          </label>
          <button type="button" onClick={onNext} className="st-press min-h-16 rounded-2xl bg-emerald-600 text-xl font-black text-white">✓ {S.good[l]}</button>
        </div>
      ) : live ? (
        <button type="button" onClick={snap} aria-label={S.takePhoto[l]} className="st-press mx-auto grid size-24 place-items-center rounded-full bg-white text-4xl shadow-xl ring-8 ring-terra-ink/40">📷</button>
      ) : (
        <label className="st-press st-cta flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-[28px] font-display text-2xl font-black text-white">
          📷 {S.takePhoto[l]}
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={S.takePhoto[l]} onChange={(e) => e.target.files?.[0] && onShot(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

function NumberPad({ value, onChange, onDone, l }: { value: string; onChange: (v: string) => void; onDone: () => void; l: L }) {
  const press = (k: string) => {
    navigator.vibrate?.(5);
    if (k === "⌫") onChange(value.slice(0, -1));
    else if ((value + k).length <= 7) onChange((value + k).replace(/^0+/, ""));
  };
  return (
    <div className="space-y-4">
      <p className="rounded-[24px] bg-white py-5 text-center font-display text-4xl font-black tabular-nums text-cocoa ring-2 ring-inset ring-hairline" aria-live="polite">{value ? Number(value).toLocaleString("en-US") : "0"} <span className="text-2xl text-cocoa-2">RWF</span></p>
      <div className="flex flex-wrap justify-center gap-2">
        {[10000, 15000, 20000, 30000].map((v) => <button key={v} type="button" onClick={() => onChange(String(v))} className="st-press rounded-full bg-amber-100 px-4 py-2 text-base font-black text-gold-ink">{v / 1000}k</button>)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"].map((k) => (
          <button key={k} type="button" onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k} className="st-press min-h-[68px] rounded-[22px] bg-white font-display text-3xl font-black text-cocoa shadow-[0_2px_0_rgba(29,24,20,.12)] ring-1 ring-inset ring-hairline active:translate-y-0.5">
            {k}
          </button>
        ))}
      </div>
      <button type="button" disabled={!value || Number(value) < 500} onClick={onDone} className="st-press flex min-h-16 w-full items-center justify-center gap-2 rounded-[24px] bg-emerald-600 text-2xl font-black text-white disabled:opacity-40">✓ {S.good[l]}</button>
    </div>
  );
}

// ---------------- Money + orders ----------------

function Money({ pageId, makerId, data, l, say }: { pageId: string; makerId: string; data: Summary; l: L; say: (t: string) => void }) {
  const [st, setSt] = useState<Statement | null>(null);
  useEffect(() => {
    void api<Statement>(`/pages/${pageId}/makers/${makerId}/statement?locale=${l}`).then(setSt).catch(() => undefined);
  }, [pageId, makerId, l]);
  const next = new Date(data.payout.nextDate).toLocaleDateString(l === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long" });
  return (
    <section className="space-y-4">
      <div className="rounded-[32px] bg-gradient-to-br from-emerald-100 to-white p-6 text-center ring-1 ring-inset ring-emerald-200">
        <p className="text-lg font-bold text-mint-ink">{S.month[l]}</p>
        <p className="font-display text-5xl font-black tabular-nums text-cocoa">{data.sales.monthRwf.toLocaleString("en-US")}</p>
        <p className="text-lg font-bold text-cocoa-2">RWF · {data.sales.monthCount} {S.pieces[l]}</p>
        <div className="mt-4"><SpeakButton big onClick={() => st && say(st.spoken)} label={S.listen[l]} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="st-card rounded-[26px] p-4 text-center">
          <p className="text-4xl" aria-hidden>📅</p>
          <p className="mt-1 text-sm font-bold text-cocoa-2">{S.coopPays[l]}</p>
          <p className="font-display text-2xl font-black text-cocoa">{data.payout.nextRwf.toLocaleString("en-US")}</p>
          <p className="text-sm font-bold text-violet-ink">{next}</p>
        </div>
        <div className="st-card rounded-[26px] p-4 text-center">
          <p className="text-4xl" aria-hidden>📱</p>
          <p className="mt-1 text-sm font-bold text-cocoa-2">{S.direct[l]}</p>
          <p className="font-display text-2xl font-black text-cocoa">{data.payout.directRwf.toLocaleString("en-US")}</p>
          <p className="text-sm font-bold text-mint-ink">MoMo</p>
        </div>
      </div>
      {st && st.lines.length > 0 && (
        <ul className="space-y-2">
          {st.lines.slice(-6).reverse().map((x) => (
            <li key={x.code + x.title} className="st-card flex items-center gap-3 rounded-2xl p-3">
              <span className="text-2xl" aria-hidden>{x.route === "DIRECT" ? "📱" : "🏠"}</span>
              <span className="min-w-0 flex-1 truncate font-bold text-cocoa">{x.title}</span>
              <span className="font-black tabular-nums text-cocoa">{x.amountRwf.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Orders({ pageId, data, assist, l, say, onDone }: { pageId: string; data: Summary; assist: string | null; l: L; say: (t: string) => void; onDone: () => Promise<void> }) {
  const [done, setDone] = useState<string | null>(null);
  async function accept(id: string) {
    await api(assist ? `/pages/${pageId}/assist/${assist}/orders/${id}/accept` : `/coop/me/${pageId}/orders/${id}/accept`, { method: "POST" });
    setDone(id);
    say(S.accepted[l]);
    await onDone();
  }
  if (!data.orders.length)
    return (
      <section className="rounded-[32px] bg-paper-2 p-8 text-center">
        <p className="text-6xl" aria-hidden>📭</p>
        <p className="mt-3 text-xl font-black text-cocoa">{done ? S.accepted[l] : S.noOrders[l]}</p>
      </section>
    );
  return (
    <ul className="space-y-4">
      {data.orders.map((o) => (
        <li key={o.id} className="st-card space-y-3 rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <span className="text-4xl" aria-hidden>📦</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-black text-cocoa">{o.title}</p>
              <p className="text-base font-bold text-cocoa-2">{o.colour} · {o.size} · {o.code}</p>
            </div>
            <SpeakButton onClick={() => say(`${o.title}, ${o.size}, ${o.totalRwf} RWF`)} label={S.listen[l]} />
          </div>
          <p className="font-display text-3xl font-black text-cocoa">{rwf(o.totalRwf)}</p>
          <button type="button" onClick={() => accept(o.id)} className="st-press flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-2xl font-black text-white">👍 {S.accept[l]}</button>
        </li>
      ))}
    </ul>
  );
}
