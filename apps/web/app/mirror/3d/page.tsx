"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Fact, LearnMore, Skel } from "@/components/kit";
import { Button, ErrorNote, Screen, Sheet, TopBar } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

// Heavy canvases (camera capture, WebGL viewer, drape panel) load only when the step needs them.
const TurnCapture = dynamic(() => import("@/components/twin3d-capture").then((m) => m.TurnCapture), { ssr: false, loading: () => <Skel className="h-[60dvh] w-full rounded-[32px]" /> });
const Twin3dViewer = dynamic(() => import("@/components/twin3d-viewer").then((m) => m.Twin3dViewer), { ssr: false, loading: () => <Skel className="aspect-[3/4] w-full rounded-[32px]" /> });
const TwinDrapePanel = dynamic(() => import("@/components/drape-spike").then((m) => m.TwinDrapePanel), { ssr: false, loading: () => <Skel className="h-40 w-full rounded-3xl" /> });
import {
  hexToRgb01,
  POSES,
  SKIN_SWATCHES,
  type Avatar3dView,
  type FitView,
  type GarmentInfo,
  type Pose,
  type Turnaround,
  type Twin3dState,
  type WardrobeItem,
} from "@/lib/twin3d";

type Step = "home" | "capture" | "persona";

const CHECK_LABEL: Record<string, string> = {
  frames: "Enough frames",
  coverage: "Every side seen",
  lighting: "Even light",
  framing: "Head to feet",
  single_subject: "Only you in frame",
  rotation: "Turn detected",
  skin: "Face visible",
};

export default function Twin3dPage() {
  return (
    <Suspense fallback={<Screen><div className="skeleton m-6 h-[60dvh] rounded-[32px]" /></Screen>}>
      <Twin3d />
    </Suspense>
  );
}

/** 3D twin (E33) + 3D try-on (E34): consent → turn capture / persona / measurements → avatar → dress, spin, pose. */
function Twin3d() {
  const { me, loading, t, locale } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const wanted = search.get("variant");
  const [state, setState] = useState<Twin3dState | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [turnaround, setTurnaround] = useState<Turnaround | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skinOpen, setSkinOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=${encodeURIComponent(`/mirror/3d${wanted ? `?variant=${wanted}` : ""}`)}`);
  }, [loading, me, router, wanted]);

  const reload = useCallback(async () => setState(await api<Twin3dState>("/twin3d")), []);
  useEffect(() => {
    if (me) void reload().catch((e: Error) => setError(e.message));
  }, [me, reload]);

  // Poll while the avatar builds.
  const avatar = state?.avatar ?? null;
  useEffect(() => {
    if (!avatar?.building) return;
    const h = setTimeout(async () => {
      const next = await api<Avatar3dView>(`/twin3d/avatar/${avatar.id}`).catch(() => null);
      if (!next) return;
      if (next.building) setState((s) => (s ? { ...s, avatar: next } : s));
      else {
        if (next.status === "READY") navigator.vibrate?.([10, 50, 10]);
        await reload();
      }
    }, 700);
    return () => clearTimeout(h);
  }, [avatar, reload]);

  const fail = (e: unknown) => {
    setError((e as Error).message);
    setBusy(false);
  };

  async function consent(granted: boolean) {
    setError(null);
    try {
      setState(await api<Twin3dState>("/twin3d/consent", { method: "POST", json: { granted, locale } }));
    } catch (e) {
      fail(e);
    }
  }

  async function startPersona(n: number) {
    setError(null);
    setBusy(true);
    try {
      setTurnaround(await api<Turnaround>(`/twin3d/personas/${n}/turnaround`));
      setStep("persona");
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  }

  const personaDone = useCallback(async () => {
    if (!turnaround) return;
    try {
      const a = await api<Avatar3dView>("/twin3d/persona", { method: "POST", json: { persona: turnaround.persona, consent: true } });
      setState((s) => (s ? { ...s, avatar: a } : s));
    } catch (e) {
      setError((e as Error).message);
    }
    setStep("home");
  }, [turnaround]);

  const framesDone = useCallback(async (frames: Blob[], yaws: number[]) => {
    const fd = new FormData();
    frames.forEach((b, i) => fd.append("frames", b, `f${i}.jpg`));
    fd.append("yaws", JSON.stringify(yaws));
    fd.append("consent", "true");
    setStep("home");
    try {
      const a = await api<Avatar3dView>("/twin3d/capture", { method: "POST", body: fd });
      setState((s) => (s ? { ...s, avatar: a } : s));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  async function fromMeasurements(hex: string) {
    setSkinOpen(false);
    try {
      const a = await api<Avatar3dView>("/twin3d/measurements", { method: "POST", json: { skin: hexToRgb01(hex), consent: true } });
      setState((s) => (s ? { ...s, avatar: a } : s));
    } catch (e) {
      fail(e);
    }
  }

  if (step === "capture" || step === "persona") {
    return (
      <Screen>
        <TopBar back="/mirror/3d" title={t("twin3d.title")} />
        <TurnCapture persona={step === "persona" ? turnaround : null} onFrames={framesDone} onPersonaDone={personaDone} onCancel={() => setStep("home")} />
      </Screen>
    );
  }

  const ready = avatar?.status === "READY" ? avatar : state?.ready ?? null;
  return (
    <Screen>
      <TopBar back="/mirror" title={t("twin3d.title")} />
      {!state ? (
        <main className="px-4"><div className="skeleton h-[60dvh] rounded-[32px]" /></main>
      ) : !state.consent ? (
        <ConsentIntro onConsent={() => consent(true)} error={error} />
      ) : avatar?.building ? (
        <Building avatar={avatar} />
      ) : ready ? (
        <Viewer
          state={state}
          avatar={ready}
          wanted={wanted}
          rejected={avatar && avatar.id !== ready.id ? avatar : null}
          onAdjust={() => setAdjustOpen(true)}
          onRebuild={async () => {
            await api("/twin3d", { method: "DELETE" });
            await reload();
          }}
        />
      ) : (
        <Start
          state={state}
          last={avatar}
          busy={busy}
          error={error}
          onCamera={() => setStep("capture")}
          onPersona={startPersona}
          onMeasurements={() => setSkinOpen(true)}
          onWithdraw={() => consent(false)}
        />
      )}

      <Sheet open={skinOpen} onClose={() => setSkinOpen(false)}>
        <fieldset>
          <legend className="font-display text-xl font-black">Pick your skin tone</legend>
          <p className="mt-2 flex flex-wrap gap-2">
            <Fact icon="ruler">{state?.hasProfile ? "From your measurements" : state?.twinSize ? `Size ${state.twinSize} estimate` : "Size M · adjustable"}</Fact>
            <Fact icon="lock">No photo used</Fact>
          </p>
          <div className="mt-4 grid grid-cols-5 gap-3">
            {SKIN_SWATCHES.map((h, i) => (
              <button key={h} onClick={() => fromMeasurements(h)} aria-label={`Skin tone ${i + 1} of 10`} className="aspect-square rounded-full border-2 border-white/25 transition hover:scale-105 focus-visible:scale-105" style={{ background: h }} />
            ))}
          </div>
        </fieldset>
      </Sheet>
      {ready && <AdjustSheet open={adjustOpen} onClose={() => setAdjustOpen(false)} avatar={ready} onBuilt={(a) => setState((s) => (s ? { ...s, avatar: a } : s))} />}
    </Screen>
  );
}

function ConsentIntro({ onConsent, error }: { onConsent: () => void; error: string | null }) {
  const { t } = useSession();
  const [on, setOn] = useState(false);
  return (
    <main className="flex min-h-[85dvh] flex-col justify-between gap-6 px-5 pb-8">
      <div className="pt-4 text-center">
        <Hero />
        <h1 className="mt-4 font-display text-3xl font-black text-grad">{t("twin3d.title")}</h1>
        <p className="mt-2 text-mut">Turn once. Spin, pose and dress it.</p>
      </div>
      <div className="space-y-3">
        <div className="glass rounded-3xl p-4">
          <ul aria-label="How your 3D twin is handled" className="flex flex-wrap gap-2">
            <li><Fact icon="lock">Encrypted · only you</Fact></li>
            <li><Fact icon="shield">Never shared with makers</Fact></li>
            <li><Fact icon="cube">Stylised, not photo-real</Fact></li>
            <li><Fact icon="refresh">Frames deleted after build</Fact></li>
          </ul>
          <LearnMore className="mt-2">
            Separate from your photo twin, so it needs its own yes. The body is stylised from your measurements and skin tone; it is not a
            photo-real likeness. It is encrypted, only you see it, and it is never shared with makers. Capture frames are deleted as soon as
            your twin is built, and you can delete everything any time.
            <span className="mt-2 block">{t("twin3d.consentBody")}</span>
          </LearnMore>
        </div>
        <label className="glass flex cursor-pointer items-center gap-3 rounded-3xl p-4">
          <span className="flex-1 text-sm font-bold">{t("twin3d.consentTitle")}</span>
          <input type="checkbox" role="switch" checked={on} onChange={(e) => setOn(e.target.checked)} className="sr-only" aria-label="I consent to creating my private 3D twin" />
          <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-mint" : "bg-white/20"}`}>
            <span className={`absolute top-0.5 size-6 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
          </span>
        </label>
        <ErrorNote error={error} />
        <Button className="w-full" disabled={!on} onClick={onConsent}>Continue</Button>
      </div>
    </main>
  );
}

function Start({
  state,
  last,
  busy,
  error,
  onCamera,
  onPersona,
  onMeasurements,
  onWithdraw,
}: {
  state: Twin3dState;
  last: Avatar3dView | null;
  busy: boolean;
  error: string | null;
  onCamera: () => void;
  onPersona: (n: number) => void;
  onMeasurements: () => void;
  onWithdraw: () => void;
}) {
  const failed = last && (last.status === "REJECTED" || last.status === "WITHHELD" || last.status === "FAILED");
  return (
    <main className="space-y-4 px-4 pb-10">
      <div className="pt-2 text-center">
        <Hero small />
        <h1 className="mt-3 font-display text-2xl font-black">Make your 3D twin</h1>
      </div>
      {failed && (
        <section className="glass rounded-3xl border-terra/40 p-4" role="alert">
          <p className="font-semibold">{last.status === "REJECTED" ? "Let's try that turn again" : last.status === "WITHHELD" ? "That twin didn't pass our quality check" : "Something went wrong"}</p>
          {last.checks && (
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(last.checks.checks).map(([k, c]) => (
                <li key={k} className="flex gap-2">
                  <span className={c.pass ? "text-mint" : "text-terra"}>{c.pass ? "✓" : "✕"}</span>
                  <span><b>{CHECK_LABEL[k] ?? k}</b>{!c.pass && <span className="text-mut"> · {c.note}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {last.error && <p className="mt-1 text-sm text-mut">{last.error}</p>}
        </section>
      )}
      <ErrorNote error={error} />
      <button onClick={onCamera} className="glass flex w-full items-center gap-4 rounded-3xl p-4 text-left transition active:scale-[.98]">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-sky/20 text-2xl">↻</span>
        <span>
          <span className="block font-display text-lg font-black">Turn once in front of the camera</span>
          <span className="block text-sm text-mut">~10 s · step back, turn slowly</span>
        </span>
      </button>
      <button onClick={onMeasurements} className="glass flex w-full items-center gap-4 rounded-3xl p-4 text-left transition active:scale-[.98]">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gold/20 text-2xl">📏</span>
        <span>
          <span className="block font-display text-lg font-black">From my measurements</span>
          <span className="block text-sm text-mut">No photos · {state.hasProfile ? "your measurements" : "your size"} + skin tone</span>
        </span>
      </button>
      {state.personas > 0 && (
        <section className="glass rounded-3xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Try with a synthetic person</p>
            <Fact icon="shield">No real person</Fact>
          </div>
          <div className="mt-3 flex justify-between gap-2">
            {Array.from({ length: state.personas }, (_, i) => i + 1).map((n) => (
              <button key={n} disabled={busy} onClick={() => onPersona(n)} aria-label={`Persona ${n}`} className="grid size-12 place-items-center rounded-full border-2 border-white/20 font-display font-black transition active:scale-90 disabled:opacity-40" style={{ background: SKIN_SWATCHES[4 + n] }}>
                {n}
              </button>
            ))}
          </div>
        </section>
      )}
      <button onClick={onWithdraw} className="min-h-11 w-full text-center text-sm text-mut underline">Withdraw 3D twin consent</button>
    </main>
  );
}

function Building({ avatar }: { avatar: Avatar3dView }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  return (
    <main className="flex min-h-[80dvh] flex-col items-center justify-center gap-6 px-6 text-center" role="status" aria-live="polite">
      <div className="relative">
        <Hero />
        <div className="absolute -bottom-6 left-1/2 grid size-24 -translate-x-1/2 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
            <circle cx="50" cy="50" r={R} fill="rgba(11,10,15,.85)" stroke="rgba(255,255,255,.12)" strokeWidth="7" />
            <circle cx="50" cy="50" r={R} fill="none" stroke="url(#g3d)" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - avatar.progress / 100)} className="transition-[stroke-dashoffset] duration-500" />
            <defs>
              <linearGradient id="g3d" x1="0" x2="1">
                <stop offset="0" stopColor="#e0703f" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
          <span className="relative font-display text-xl font-black">{avatar.progress}%</span>
        </div>
      </div>
      <div className="mt-6">
        <p className="font-display text-2xl font-black text-grad">Building your 3D twin</p>
        <p className="mt-1 text-sm text-mut">Proportions · skin tone · skeleton</p>
      </div>
    </main>
  );
}

function Viewer({
  state,
  avatar,
  wanted,
  rejected,
  onAdjust,
  onRebuild,
}: {
  state: Twin3dState;
  avatar: Avatar3dView;
  wanted: string | null;
  rejected: Avatar3dView | null;
  onAdjust: () => void;
  onRebuild: () => Promise<void>;
}) {
  const { t } = useSession();
  const [pose, setPose] = useState<Pose>("Idle");
  const [spin, setSpin] = useState(true);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[] | null>(null);
  const [garment, setGarment] = useState<GarmentInfo | null>(null);
  const [fit, setFit] = useState<FitView | null>(null);
  const [dressing, setDressing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    void api<WardrobeItem[]>("/twin3d/wardrobe").then(setWardrobe).catch(() => setWardrobe([]));
  }, []);

  const dress = useCallback(async (variantId: string, size?: string) => {
    setError(null);
    setDressing("Dressing your twin…");
    try {
      const g = await api<GarmentInfo>(`/twin3d/garment/${variantId}`);
      setGarment(g);
      if (!g.supported) throw new Error("3D try-on isn't available for this piece yet.");
      let f = await api<FitView>("/twin3d/fit", { method: "POST", json: { variantId, size } });
      for (let i = 0; f.status === "QUEUED" && i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        f = await api<FitView>(`/twin3d/fit/${f.id}`);
      }
      if (f.status !== "READY") throw new Error(f.error ?? "We couldn't dress your twin in this piece.");
      setFit(f);
      navigator.vibrate?.(8);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setDressing(null);
    }
  }, []);

  useEffect(() => {
    if (wanted && !started.current) {
      started.current = true;
      void dress(wanted);
    }
  }, [wanted, dress]);

  const src = fit?.glb ?? avatar.glb!;
  const poster = fit?.poster ?? avatar.poster;
  const alt = garment && fit ? `Your 3D twin wearing ${garment.title}, size ${fit.size}. ${t("twin3d.disclaimer")}` : "Your 3D twin, stylised from your measurements and skin tone";
  return (
    <main className="space-y-3 px-4 pb-28">
      {rejected && rejected.status !== "READY" && (
        <p className="glass rounded-2xl px-3 py-2 text-xs text-mut" role="status">Last rebuild {rejected.status.toLowerCase()} · showing current twin</p>
      )}
      <Twin3dViewer src={src} poster={poster} alt={alt} pose={pose} spin={spin} label={state.label} busy={dressing} onLoaded={() => setDressing(null)} />
      <p className="text-center text-xs text-mut">🤏 pinch to zoom · drag to spin · {t("twin3d.disclaimer")}</p>

      <div className="flex items-center justify-between gap-2">
        <div className="glass flex rounded-full p-1" role="radiogroup" aria-label="Pose">
          {POSES.map((p) => (
            <button key={p.id} role="radio" aria-checked={pose === p.id} onClick={() => setPose(p.id)} className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${pose === p.id ? "bg-white/20 text-white" : "text-white/70"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <button role="switch" aria-checked={spin} onClick={() => setSpin((s) => !s)} className={`glass min-h-10 rounded-full px-4 text-sm font-semibold ${spin ? "text-gold" : "text-white/70"}`}>
          {spin ? "⟳ Spin on" : "⟳ Spin off"}
        </button>
      </div>

      <ErrorNote error={error} />

      {garment && fit && (
        <section className="glass space-y-3 rounded-3xl p-4" aria-label="Dressed in">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{garment.title}</p>
              <p className="text-xs text-mut">
                Size {fit.size} · fit {fit.fit?.fit ?? "regular"}
                {fit.fit ? ` · ${Math.max(0, Math.round(fit.fit.ease_m * 100))} cm ease` : ""}
              </p>
            </div>
            <button onClick={() => { setFit(null); setGarment(null); }} className="hit text-sm text-mut underline">Undress</button>
          </div>
          {garment.colours.length > 1 && (
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colour">
              {garment.colours.map((c) => (
                <button key={c.variantId} role="radio" aria-checked={c.variantId === fit.variantId} aria-label={c.colourName} onClick={() => c.variantId !== fit.variantId && dress(c.variantId, fit.size)} className={`size-10 rounded-full border-[3px] transition ${c.variantId === fit.variantId ? "scale-110 border-gold shadow-[0_0_16px_rgba(242,184,75,.5)]" : "border-white/25"}`} style={{ background: c.colourHex }} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
            {garment.sizes.map((s) => (
              <button key={s} role="radio" aria-checked={s === fit.size} onClick={() => s !== fit.size && dress(fit.variantId, s)} className={`min-h-10 min-w-12 rounded-2xl border px-3 text-sm font-bold transition ${s === fit.size ? "border-gold/70 bg-gold/20" : "border-white/20 bg-white/10"}`}>
                {s}
                {s === garment.recommended && <span className="ml-1 text-[10px] font-semibold text-mint">your size</span>}
              </button>
            ))}
          </div>
          <Link href={`/looks/try?variant=${fit.variantId}`} className="flex min-h-11 items-center justify-center text-sm text-gold">See it on my photo twin →</Link>
        </section>
      )}

      <section aria-label="Dress my twin">
        <p className="mb-2 text-sm font-semibold">Dress my twin</p>
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
          {wardrobe === null
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-28 w-20 shrink-0 rounded-2xl" />)
            : wardrobe.map((w) => (
                <button key={w.variantId} onClick={() => dress(w.variantId)} aria-label={`Wear ${w.title} in ${w.colourName}`} aria-pressed={fit?.variantId === w.variantId} className={`glass relative h-28 w-20 shrink-0 snap-start overflow-hidden rounded-2xl p-1.5 transition active:scale-95 ${fit?.variantId === w.variantId ? "ring-2 ring-gold" : ""}`}>
                  {w.cutout && <img src={w.cutout} alt="" className="h-full w-full object-contain" />}
                  {w.fromLook && <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[9px]">look</span>}
                </button>
              ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="glass" onClick={onAdjust}>📏 Adjust body</Button>
        <Button variant="glass" onClick={() => setMenu(true)}>⋯ My 3D twin</Button>
      </div>

      <TwinDrapePanel bodySize={avatar.bodySize ?? null} />

      <nav aria-label="Mirror mode" className="fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),14px)] z-30 flex justify-center">
        <div className="glass flex rounded-full p-1.5 shadow-[0_12px_40px_rgba(0,0,0,.45)]">
          <span aria-current="page" className="flex min-h-11 items-center rounded-full bg-white/20 px-5 text-sm font-bold">🧊 {t("twin3d.title")}</span>
          {state.arMirrorPilot && (
            <Link href={`/mirror/ar${fit ? `?variant=${fit.variantId}` : ""}`} className="flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white/80">🪞 {t("twin3d.ar")}</Link>
          )}
        </div>
      </nav>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <p className="font-display text-xl font-black">My 3D twin</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-mut">Version</dt>
          <dd>{avatar.version}</dd>
          <dt className="text-mut">Made from</dt>
          <dd>{avatar.source === "TURNAROUND" ? "Your turn capture" : avatar.source === "PERSONA" ? `Synthetic persona ${avatar.persona}` : "Your measurements"}</dd>
          <dt className="text-mut">Body size</dt>
          <dd>{avatar.bodySize ?? "—"}</dd>
          <dt className="text-mut">Skin tone</dt>
          <dd className="flex items-center gap-2">{avatar.skinHex && <span className="inline-block size-4 rounded-full border border-white/30" style={{ background: avatar.skinHex }} />}{avatar.skinHex ?? "—"}</dd>
          <dt className="text-mut">Quality check</dt>
          <dd>{avatar.eval?.passed ? `✓ passed (skin Δ ${avatar.eval.skin_tone_delta.toFixed(3)})` : "—"}</dd>
        </dl>
        <ul aria-label="Privacy" className="mt-3 flex flex-wrap gap-2">
          <li><Fact icon="lock">Encrypted · only you</Fact></li>
          <li><Fact icon="shield">Never shared with makers</Fact></li>
          <li><Fact icon="refresh">Frames deleted</Fact></li>
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="glass" onClick={async () => { setMenu(false); await onRebuild(); }}>Delete &amp; rebuild</Button>
          <Link href="/trust" className="glass flex min-h-12 items-center justify-center rounded-2xl font-semibold">Privacy</Link>
        </div>
      </Sheet>
    </main>
  );
}

const FIELDS = [
  { key: "heightCm", label: "Height", min: 140, max: 200 },
  { key: "bustCm", label: "Bust", min: 70, max: 140 },
  { key: "waistCm", label: "Waist", min: 55, max: 130 },
  { key: "hipsCm", label: "Hips", min: 75, max: 150 },
] as const;

/** FR-AVA-03: adjust the twin's body measurements (builds a new version, same skin tone). */
function AdjustSheet({ open, onClose, avatar, onBuilt }: { open: boolean; onClose: () => void; avatar: Avatar3dView; onBuilt: (a: Avatar3dView) => void }) {
  const [vals, setVals] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setVals(Object.fromEntries(FIELDS.map((f) => [f.key, Math.round(avatar.measurements?.[f.key] ?? (f.min + f.max) / 2)])));
  }, [open, avatar]);
  async function save() {
    setError(null);
    const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => Math.round(avatar.measurements?.[k] ?? -1) !== v));
    if (!Object.keys(changed).length) return onClose();
    try {
      onBuilt(await api<Avatar3dView>("/twin3d/adjust", { method: "POST", json: { measurements: changed } }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="font-display text-xl font-black">Adjust my body</p>
      <p className="text-sm text-mut">Skin tone stays the same</p>
      <div className="mt-4 space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`m-${f.key}`} className="flex justify-between text-sm font-semibold">
              <span>{f.label}</span>
              <span className="tabular-nums text-gold">{vals[f.key]} cm</span>
            </label>
            <input id={`m-${f.key}`} type="range" min={f.min} max={f.max} value={vals[f.key] ?? f.min} onChange={(e) => setVals((v) => ({ ...v, [f.key]: Number(e.target.value) }))} className="mt-1 w-full accent-[#f2b84b]" />
          </div>
        ))}
      </div>
      <ErrorNote error={error} />
      <Button className="mt-4 w-full" onClick={save}>Rebuild my twin</Button>
    </Sheet>
  );
}

/** Stylised orbiting figure (no likeness): depth rings + soft glow. */
function Hero({ small }: { small?: boolean }) {
  return (
    <div className={`relative mx-auto ${small ? "h-36 w-28" : "h-56 w-40"}`} aria-hidden>
      <div className="absolute inset-x-0 bottom-1 h-6 rounded-[50%] border-2 border-gold/60 shadow-[0_0_24px_rgba(242,184,75,.45)]" />
      <div className="absolute inset-x-3 bottom-[42%] h-8 animate-[orb-spin_6s_linear_infinite] rounded-[50%] border border-sky/50 motion-reduce:animate-none" style={{ transform: "rotateX(70deg)" }} />
      <svg viewBox="0 0 100 200" className="relative h-full w-full drop-shadow-[0_0_24px_rgba(139,92,246,.45)]">
        <defs>
          <linearGradient id="h3d" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f2b84b" stopOpacity=".9" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity=".85" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="24" r="15" fill="url(#h3d)" />
        <path d="M30 46h40l7 66h-9l-4 80H54l-4-58-4 58H36l-4-80h-9z" fill="url(#h3d)" opacity=".9" />
      </svg>
    </div>
  );
}
