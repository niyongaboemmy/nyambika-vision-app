"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useEffect, useState } from "react";
import { Twin3dViewer } from "@/components/twin3d-viewer";
import { api } from "@/lib/api";
import { Icon } from "@/components/icons";

/**
 * R4 spike (not committed): physics drape + fit heatmap + tailor pattern-to-3D.
 * Everything here renders only while the `fit.heatmap_spike` flag is on, carries an "Experimental" label and the
 * "visual guidance only" disclaimer. Results are not stored anywhere (GLBs live in memory as blob URLs).
 */

export const GARMENTS = [
  { key: "a_line_dress", label: "A-line dress" },
  { key: "wrap_skirt", label: "Wrap skirt" },
  { key: "shirt", label: "Shirt" },
] as const;
export const FABRICS = [
  { key: "cotton", label: "Cotton" },
  { key: "kitenge", label: "Kitenge" },
  { key: "jersey", label: "Jersey knit" },
] as const;
export const SLEEVES = [
  { key: "none", label: "Sleeveless" },
  { key: "short", label: "Short" },
  { key: "long", label: "Long" },
] as const;
export const SIZES = ["S", "M", "L", "XL", "XXL", "3XL"] as const;
export type Garment = (typeof GARMENTS)[number]["key"];
export type Fabric = (typeof FABRICS)[number]["key"];
export type Sleeve = (typeof SLEEVES)[number]["key"];

const CATEGORY: Record<string, Garment> = { skirt: "wrap_skirt", wrap: "wrap_skirt", shirt: "shirt", top: "shirt", blouse: "shirt", jacket: "shirt", suit: "shirt" };
export const garmentForCategory = (c: string | null | undefined): Garment => CATEGORY[(c ?? "").toLowerCase()] ?? "a_line_dress";

export const BAND_LABEL: Record<string, string> = { tight: "Tight", ok: "Comfortable", loose: "Loose", drape: "Free drape" };
const BAND_HINT: Record<string, string> = {
  tight: "fabric pulled open on the body",
  ok: "close, with ease",
  loose: "excess fabric",
  drape: "hangs freely (not assessed)",
};

export interface DrapeResultView {
  glb: string;
  heatmapGlb: string;
  poster: string | null;
  heatmapPoster: string | null;
  fit: {
    share: Record<string, number>;
    regions: Record<string, { reading: string; share: Record<string, number>; measured_ease_cm: number | null }>;
    size_chart: Record<string, { ease_cm: number; expected: string[]; reading: string | null; agree: boolean }>;
  };
  metrics: { runtime_s: number; vertices: number; exploded: boolean; max_penetration_m: number };
  legend: { band: string; rgb: number[] }[];
  latencyS: number;
  modelId: string;
  disclaimer: string;
  garment: Garment;
  size?: string;
  params?: { length_cm: number; ease_cm: number; sleeve: Sleeve };
  defaults?: { length_cm: number; ease_cm: number; sleeve: Sleeve };
}

/** Feature flag for the spike (public status endpoint; the API refuses every spike call while it's off). */
export function useDrapeSpike() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean }>("/drape-spike/status")
      .then((s) => live && setEnabled(s.enabled))
      .catch(() => live && setEnabled(false));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

/** data: URL → object URL so <model-viewer> doesn't carry megabytes in a DOM property. Revoked on change. */
function useBlobUrl(dataUrl: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!dataUrl) return setUrl(null);
    let made: string | null = null;
    let live = true;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((b) => {
        made = URL.createObjectURL(new Blob([b], { type: "model/gltf-binary" }));
        if (live) setUrl(made);
      })
      .catch(() => live && setUrl(dataUrl));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [dataUrl]);
  return url;
}

const rgbCss = (rgb: number[]) => `rgb(${rgb.map((c) => Math.round(c * 255)).join(",")})`;

export function ExperimentalBadge({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone === "dark" ? "bg-violet-400/20 text-violet-100 ring-1 ring-violet-300/40" : "bg-violet-100 text-violet-900 ring-1 ring-violet-300"}`}>
      <Icon name="wand" className="size-3.5" /> Experimental
    </span>
  );
}

export function FitLegend({ legend, share, tone = "dark" }: { legend: DrapeResultView["legend"]; share?: Record<string, number>; tone?: "dark" | "light" }) {
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="Fit heatmap legend">
      {legend.map((l) => (
        <li key={l.band} className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs ${tone === "dark" ? "bg-white/5 ring-1 ring-white/10" : "bg-stone-50 ring-1 ring-stone-200"}`}>
          <span aria-hidden className="size-4 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: rgbCss(l.rgb) }} />
          <span className="min-w-0">
            <b className="block text-sm">
              {BAND_LABEL[l.band] ?? l.band}
              {share?.[l.band] !== undefined && <span className="ml-1 font-semibold opacity-70">{Math.round(share[l.band] * 100)}%</span>}
            </b>
            <span className={tone === "dark" ? "text-mut" : "text-stone-600"}>{BAND_HINT[l.band]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FitReadings({ r, tone = "dark" }: { r: DrapeResultView; tone?: "dark" | "light" }) {
  const lines = Object.entries(r.fit.regions);
  if (!lines.length) return null;
  const chip = (reading: string) =>
    reading === "tight" ? "bg-rose-500/20 text-rose-100 ring-rose-300/40" : reading === "loose" ? "bg-amber-400/20 text-amber-100 ring-amber-300/40" : "bg-teal-400/20 text-teal-100 ring-teal-300/40";
  const chipLight = (reading: string) => (reading === "tight" ? "bg-rose-100 text-rose-900 ring-rose-300" : reading === "loose" ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-teal-100 text-teal-900 ring-teal-300");
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {lines.map(([line, v]) => (
        <div key={line} className={`rounded-2xl p-2 ${tone === "dark" ? "bg-white/5" : "bg-stone-50 ring-1 ring-stone-200"}`}>
          <dt className={`text-[11px] font-semibold uppercase ${tone === "dark" ? "text-mut" : "text-stone-500"}`}>{line}</dt>
          <dd className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${tone === "dark" ? chip(v.reading) : chipLight(v.reading)}`}>{BAND_LABEL[v.reading] ?? v.reading}</dd>
          {v.measured_ease_cm !== null && <dd className={`mt-0.5 text-[11px] ${tone === "dark" ? "text-mut" : "text-stone-500"}`}>{v.measured_ease_cm > 0 ? "+" : ""}{v.measured_ease_cm} cm ease</dd>}
        </div>
      ))}
    </dl>
  );
}

/** 3D stage with a Print / Fit heatmap switch, on the existing twin viewer. */
export function DrapeStage({ r, alt, defaultMode = "heatmap", badge, tone = "dark" }: { r: DrapeResultView; alt: string; defaultMode?: "print" | "heatmap"; badge?: string; tone?: "dark" | "light" }) {
  const [mode, setMode] = useState<"print" | "heatmap">(defaultMode);
  const glb = useBlobUrl(r.glb);
  const heat = useBlobUrl(r.heatmapGlb);
  const src = mode === "heatmap" ? heat : glb;
  return (
    <div className="space-y-2" data-testid="drape-stage" data-mode={mode}>
      <div className="relative">
        {src ? (
          <Twin3dViewer src={src} poster={mode === "heatmap" ? r.heatmapPoster : r.poster} alt={`${alt}. ${r.disclaimer}`} pose="Idle" spin={false} label={mode === "heatmap" ? "Fit heatmap · experimental" : "Physics drape · experimental"} badge={badge} />
        ) : (
          <div className="skeleton h-[min(64dvh,580px)] w-full rounded-[32px]" />
        )}
      </div>
      <div className="flex justify-center">
        <div className={`flex rounded-full p-1 ${tone === "dark" ? "glass" : "bg-stone-100 ring-1 ring-stone-300"}`} role="radiogroup" aria-label="Show">
          {(["heatmap", "print"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${tone === "dark" ? (mode === m ? "bg-white/20 text-white" : "text-white/70") : mode === m ? "bg-stone-900 text-white" : "text-stone-700"}`}
            >
              <span className="inline-flex items-center gap-1.5"><Icon name={m === "heatmap" ? "layers" : "palette"} className="size-4" />{m === "heatmap" ? "Fit heatmap" : "Print"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pills<T extends string>({ label, options, value, onChange, tone }: { label: string; options: readonly { key: T; label: string }[]; value: T; onChange: (v: T) => void; tone: "dark" | "light" }) {
  return (
    <fieldset>
      <legend className={`mb-1.5 text-sm font-semibold ${tone === "light" ? "text-stone-800" : ""}`}>{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            className={
              tone === "dark"
                ? `min-h-11 rounded-2xl border px-3.5 text-sm font-bold transition active:scale-95 ${value === o.key ? "border-gold/70 bg-gold/20" : "border-white/20 bg-white/10"}`
                : `min-h-12 rounded-2xl px-4 text-sm font-bold transition active:scale-95 ${value === o.key ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-300"}`
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Shopper: "Physics fit preview" on their own 3D twin (own view only, nothing stored). */
export function TwinDrapePanel({ bodySize }: { bodySize: string | null }) {
  const enabled = useDrapeSpike();
  const [garment, setGarment] = useState<Garment>("a_line_dress");
  const [size, setSize] = useState<string>(bodySize && (SIZES as readonly string[]).includes(bodySize) ? bodySize : "M");
  const [fabric, setFabric] = useState<Fabric>("cotton");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<DrapeResultView | null>(null);
  if (!enabled) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setR(await api<DrapeResultView>("/drape-spike/twin", { method: "POST", json: { garment, size, fabric } }));
      navigator.vibrate?.(12);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="drape-spike-title" className="glass space-y-4 rounded-3xl p-4" data-testid="drape-spike-twin">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="drape-spike-title" className="font-display text-lg font-black">Physics fit preview</h2>
          <p className="text-xs text-mut">Real pattern · cloth simulation</p>
        </div>
        <ExperimentalBadge />
      </div>
      <Pills label="Garment" options={GARMENTS} value={garment} onChange={setGarment} tone="dark" />
      <Pills label="Size" options={SIZES.map((s) => ({ key: s, label: s }))} value={size} onChange={setSize} tone="dark" />
      <Pills label="Fabric" options={FABRICS} value={fabric} onChange={setFabric} tone="dark" />
      <button onClick={run} disabled={busy} className="grad-cta min-h-12 w-full rounded-2xl font-bold transition active:scale-[.98] disabled:opacity-60">
        {busy ? "Sewing and draping…" : r ? "Drape again" : <><Icon name="needle" className="size-5" /> Drape it on my twin</>}
      </button>
      {error && (isExpectedText(error) ? <LimitState error={error} /> : <p role="alert" className="text-sm text-rose-300">{error}</p>)}
      {busy && !r && <div className="skeleton h-[min(64dvh,580px)] w-full rounded-[32px]" role="status" aria-label="Simulating drape" />}
      {r && (
        <div className="space-y-3">
          <DrapeStage r={r} badge="Your 3D twin" alt={`Your 3D twin in a ${GARMENTS.find((g) => g.key === r.garment)?.label}, size ${r.size}, ${fabric}`} />
          <FitReadings r={r} />
          <FitLegend legend={r.legend} share={r.fit.share} />
          <p className="rounded-2xl bg-white/5 p-3 text-xs text-mut" role="note">{r.disclaimer} Size {r.size} on your twin · draped in {r.metrics.runtime_s.toFixed(1)} s · not saved.</p>
        </div>
      )}
    </section>
  );
}

/** Tailor (studio, light): adjust a few pattern params and see the drape on a synthetic body sized from the share. */
export function PatternPreview3D({ orderId, shareActive, defaultGarment }: { orderId: string; shareActive: boolean; defaultGarment?: Garment }) {
  const enabled = useDrapeSpike();
  const [garment, setGarment] = useState<Garment | null>(defaultGarment ?? null);
  const [length, setLength] = useState<number | null>(null);
  const [ease, setEase] = useState(0);
  const [sleeve, setSleeve] = useState<Sleeve | null>(null);
  const [fabric, setFabric] = useState<Fabric>("cotton");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<DrapeResultView | null>(null);
  useEffect(() => {
    if (!shareActive) setR(null);
  }, [shareActive]);
  if (!enabled) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { ease_cm: ease };
      if (length !== null) params.length_cm = length;
      if (sleeve) params.sleeve = sleeve;
      const out = await api<DrapeResultView>(`/drape-spike/custom-orders/${orderId}/preview`, { method: "POST", json: { garment: garment ?? undefined, fabric, params } });
      setR(out);
      setGarment(out.garment);
      if (out.params) {
        setLength(out.params.length_cm);
        setSleeve(out.params.sleeve);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const g = garment ?? "a_line_dress";
  const lenRange = g === "wrap_skirt" ? [35, 100] : g === "shirt" ? [50, 85] : [70, 140];
  return (
    <section aria-labelledby="pattern-3d-title" className="space-y-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200" data-testid="pattern-preview-3d">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="pattern-3d-title" className="flex items-center gap-2 text-lg font-black"><Icon name="scissors" className="size-5" /> Preview pattern in 3D</h3>
          <p className="text-sm text-stone-600">Sewn and draped on the shared measurements</p>
        </div>
        <ExperimentalBadge tone="light" />
      </div>
      {!shareActive ? (
        <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-700 ring-1 ring-stone-200">Needs an active measurement share</p>
      ) : (
        <>
          <Pills label="Pattern" options={GARMENTS} value={g} onChange={(v) => { setGarment(v); setLength(null); setSleeve(null); }} tone="light" />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 flex justify-between text-sm font-semibold text-stone-800">
                Length <b aria-live="polite">{length === null ? "from order" : `${length} cm`}</b>
              </span>
              <input type="range" min={lenRange[0]} max={lenRange[1]} step={1} value={length ?? Math.round((lenRange[0] + lenRange[1]) / 2)} onChange={(e) => setLength(Number(e.target.value))} className="h-12 w-full accent-stone-900" />
            </label>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-stone-800">Ease (added to the standard ease)</legend>
              <div className="flex items-center gap-3">
                <button type="button" aria-label="Less ease" onClick={() => setEase((e) => Math.max(-6, e - 1))} className="size-12 rounded-xl bg-white text-xl font-bold ring-1 ring-stone-300">−</button>
                <span className="min-w-20 text-center text-xl font-black" aria-live="polite">{ease > 0 ? "+" : ""}{ease} cm</span>
                <button type="button" aria-label="More ease" onClick={() => setEase((e) => Math.min(20, e + 1))} className="size-12 rounded-xl bg-white text-xl font-bold ring-1 ring-stone-300">+</button>
              </div>
            </fieldset>
          </div>
          {g !== "wrap_skirt" && <Pills label="Sleeve" options={SLEEVES} value={sleeve ?? (g === "shirt" ? "short" : "none")} onChange={setSleeve} tone="light" />}
          <Pills label="Fabric" options={FABRICS} value={fabric} onChange={setFabric} tone="light" />
          <button type="button" onClick={run} disabled={busy} className="min-h-14 w-full rounded-2xl bg-stone-900 text-base font-bold text-white transition active:scale-[.98] disabled:opacity-60">
            {busy ? "Sewing and draping…" : r ? "Update 3D preview" : <><Icon name="needle" className="size-5" /> Preview in 3D</>}
          </button>
          {error && (isExpectedText(error) ? <LimitState error={error} /> : <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>)}
          {busy && !r && <div className="h-80 animate-pulse rounded-[32px] bg-stone-200" role="status" aria-label="Simulating drape" />}
          {r && (
            <div className="space-y-3">
              <DrapeStage r={r} tone="light" badge="Synthetic body" alt={`Pattern preview: ${GARMENTS.find((x) => x.key === r.garment)?.label} on a synthetic body sized from the shared measurements`} />
              <FitReadings r={r} tone="light" />
              <FitLegend legend={r.legend} share={r.fit.share} tone="light" />
              <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-950 ring-1 ring-amber-200" role="note">
                {r.disclaimer} Synthetic body from the shared measurements only, never the customer&apos;s photos or 3D twin. Nothing is saved; each preview is logged like a measurement view.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
