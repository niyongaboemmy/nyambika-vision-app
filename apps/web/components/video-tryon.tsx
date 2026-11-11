"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";
import { prefersReducedMotion } from "@/lib/xr";

interface VideoJob {
  id: string;
  source: "CLIP" | "TURNAROUND";
  status: string;
  rendering: boolean;
  progress: number;
  webp: string | null;
  mp4: string | null;
  poster: string | null;
  durationMs: number | null;
  clipDeleted: boolean | null;
  guard: { identityStability: number | null; sampledFrames: number } | null;
  c2pa: { signed: boolean; sha256: string; model: string } | null;
  error: string | null;
}
interface VideoState {
  available: boolean;
  model: { id: string; name: string } | null;
  eligible: boolean;
  reason: string | null;
  quote: { source: string; credits: number; costRwf: number; label: string };
  clipConsent: boolean;
  onTwin: boolean;
  job: VideoJob | null;
}

// One availability check per page view: the rail button exists only while a provider passed the NLB gate.
let availability: Promise<boolean> | null = null;
function videoAvailable() {
  availability ??= api<{ available: boolean }>("/video/available").then((r) => r.available).catch(() => false);
  return availability;
}

const MAX_SECONDS = 4;
const FRAMES = 16;

function once(el: HTMLMediaElement, ev: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => {
      el.removeEventListener("error", bad);
      resolve();
    };
    const bad = () => {
      el.removeEventListener(ev, ok);
      reject(new Error("We couldn't read that video. Try a short clip from your camera."));
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

/** Frames are taken on the device (≤ 4 s, 16 frames, 512 px tall JPEG); the video file itself never leaves it. */
export async function extractFrames(file: File, n = FRAMES): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await once(v, "loadeddata");
    if (!Number.isFinite(v.duration)) {
      // MediaRecorder WebM has no duration until the end is seeked once.
      v.currentTime = 1e6;
      await once(v, "seeked");
    }
    const dur = Math.min(Number.isFinite(v.duration) ? v.duration : MAX_SECONDS, MAX_SECONDS);
    const h = 512;
    const w = Math.max(2, Math.round((v.videoWidth * h) / Math.max(1, v.videoHeight)) & ~1);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const frames: string[] = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = (dur * (i + 0.5)) / n;
      await once(v, "seeked");
      ctx.drawImage(v, 0, 0, w, h);
      frames.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src");
  }
}

/** Right-rail "Video" (E39): see the look on a short video of you, only when a provider passed the NLB. */
export function VideoRail({ look }: { look: Look }) {
  const { t, locale } = useSession();
  const [on, setOn] = useState(false);
  const [state, setState] = useState<VideoState | null>(null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [sheet, setSheet] = useState(false);
  const [source, setSource] = useState<"TURNAROUND" | "CLIP">("TURNAROUND");
  const [frames, setFrames] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void videoAvailable().then((a) => live && setOn(a));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    setJob(null);
    setState(null);
    setPlaying(false);
  }, [look.id, look.variant.id]);

  useEffect(() => {
    if (!job?.rendering) return;
    const h = setTimeout(async () => {
      const next = await api<VideoJob>(`/video/jobs/${job.id}`).catch(() => null);
      if (!next) return;
      setJob(next);
      if (next.status === "DELIVERED") {
        setPlaying(true);
        setSheet(false);
        navigator.vibrate?.([8, 40, 8]);
      }
    }, 1000);
    return () => clearTimeout(h);
  }, [job]);

  const open = useCallback(async () => {
    setError(null);
    if (job?.status === "DELIVERED") return setPlaying((x) => !x);
    const s = await api<VideoState>(`/video/looks/${look.id}`).catch((e: Error) => {
      setError(e.message);
      return null;
    });
    if (s) {
      setState(s);
      setConsent(s.clipConsent);
      if (s.job?.status === "DELIVERED" && !job) {
        setJob(s.job);
        return setPlaying(true);
      }
      if (s.job?.rendering) setJob(s.job);
    }
    setSheet(true);
  }, [job, look.id]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("frames");
    try {
      const f = await extractFrames(file);
      setFrames(f);
      setPreview(`data:image/jpeg;base64,${f[Math.floor(f.length / 2)]}`);
    } catch (e) {
      setError((e as Error).message);
      setFrames(null);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    setError(null);
    try {
      const body = source === "CLIP" ? { source, frames, consent, locale } : { source, locale };
      setJob(await api<VideoJob>(`/video/looks/${look.id}`, { method: "POST", json: body }));
      setFrames(null);
      setPreview(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the video");
    } finally {
      setBusy(null);
    }
  }

  if (!on || look.status !== "DELIVERED") return null;
  const rendering = Boolean(job?.rendering);
  const pct = job?.progress ?? 0;
  const ready = source === "TURNAROUND" || (Boolean(frames) && consent);
  return (
    <div ref={anchor} className="contents">
      <button onClick={open} aria-label={rendering ? `Video ${pct}% ready` : t("video.title")} className="hit flex flex-col items-center gap-1 text-xs font-semibold">
        <span className={`glass relative grid size-12 place-items-center rounded-full ${playing ? "bg-terra/70 text-white" : ""}`}>
          {rendering && (
            <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
              <circle cx="24" cy="24" r="22" fill="none" stroke="#e0703f" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 138} 138`} className="transition-[stroke-dasharray] duration-500" />
            </svg>
          )}
          <FilmIcon />
        </span>
        {rendering ? `${pct}%` : t("video.rail")}
      </button>

      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <div className="flex items-start gap-3">
          <span className="orb grid size-12 shrink-0 place-items-center rounded-2xl text-ink">
            <FilmIcon />
          </span>
          <div>
            <h3 className="font-display text-xl font-black">{t("video.title")}</h3>
            <p className="text-sm text-mut">This look, moving · every frame labelled + signed</p>
          </div>
        </div>

        {rendering ? (
          <div className="mt-5 space-y-3" role="status">
            <div className="relative mx-auto aspect-[9/14] w-40 overflow-hidden rounded-3xl skeleton">
              <div className="absolute inset-x-0 h-1 animate-[scan_1.6s_ease-in-out_infinite] bg-terra shadow-[0_0_18px_#e0703f]" style={{ top: "40%" }} />
            </div>
            <p className="text-center text-sm text-mut">Making your video · {pct}%{job?.source === "CLIP" ? " · your clip is deleted as soon as we've used it" : ""}</p>
          </div>
        ) : (
          <>
            <fieldset className="mt-4 grid grid-cols-2 gap-2">
              <legend className="sr-only">What to use</legend>
              {(
                [
                  ["TURNAROUND", "🔄", state?.onTwin ? "My twin" : "AI model", "A gentle turn"],
                  ["CLIP", "🎥", "My short clip", "Up to 4 s, deleted after"],
                ] as const
              ).map(([v, icon, title, sub]) => (
                <label key={v} className={`cursor-pointer rounded-2xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white ${source === v ? "border-terra bg-terra/15" : "border-white/10 bg-white/5"}`}>
                  <input type="radio" name="video-source" value={v} checked={source === v} onChange={() => setSource(v)} className="sr-only" />
                  <span className="block text-xl" aria-hidden>{icon}</span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-xs text-mut">{sub}</span>
                </label>
              ))}
            </fieldset>

            {source === "CLIP" && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3">
                  {preview ? <img src={preview} alt="A frame from your clip" className="h-20 w-auto rounded-xl border border-white/15" /> : null}
                  <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-semibold">
                    <input type="file" accept="video/*" capture="user" className="sr-only" aria-label="Choose or record a short clip" onChange={(e) => void pick(e.target.files?.[0])} />
                    {busy === "frames" ? "Reading clip…" : frames ? "Choose another clip" : "Record or choose a clip"}
                  </label>
                </div>
                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[#e0703f]" />
                  <span>{t("video.consent")}</span>
                </label>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="text-sm">Premium video</span>
              <span className="text-right">
                <span className="block font-display font-black text-gold">{state?.quote.label ?? "5 credits"}</span>
                {state && state.quote.source !== "CREDITS" && <span className="block text-[11px] text-mut">usually {state.quote.credits} credits</span>}
              </span>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-mut">
              <li>✨ {t("video.label")}, labelled and signed with Content Credentials (C2PA).</li>
              <li>🛡️ Sampled frames are checked: your face and skin tone stay yours, steady across the clip.</li>
              <li>🔒 Private to you. Makers never receive it. Not charged if it doesn't pass.</li>
            </ul>
            {state && !state.eligible && state.reason && <p className="mt-3 text-sm text-gold">{state.reason}</p>}
            {job?.status === "WITHHELD" && <p className="mt-3 text-sm text-gold">Didn't pass our checks · not charged · try again</p>}
            {job?.error && <p className="mt-3 text-sm text-gold">{job.error}</p>}
            {error && (isExpectedText(error) ? <LimitState error={error} /> : <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>)}
            <Button className="mt-4 w-full" onClick={start} disabled={Boolean(busy) || !ready || (state ? !state.eligible : false)}>
              {busy === "start" ? "Starting…" : `🎬 ${t("video.title")}`}
            </Button>
          </>
        )}
      </Sheet>

      {playing && job?.status === "DELIVERED" && <VideoLayer job={job} anchor={anchor} alt={`${look.product.title} in ${look.variant.colourName}, ${t("video.label")}`} label={t("video.label")} onClose={() => setPlaying(false)} />}
    </div>
  );
}

function VideoLayer({ job, anchor, alt, label, onClose }: { job: VideoJob; anchor: React.RefObject<HTMLDivElement | null>; alt: string; label: string; onClose: () => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [useImg, setUseImg] = useState(!job.mp4);
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    setTarget((anchor.current?.closest(".overflow-hidden") as HTMLElement | null) ?? document.body);
    if (prefersReducedMotion()) setPaused(true);
  }, [anchor]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => setPaused(true));
  }, [paused, target, useImg]);
  if (!target) return null;
  const fixed = target === document.body;
  return createPortal(
    <div className={`${fixed ? "fixed" : "absolute"} inset-x-0 top-[96px] bottom-[150px] z-[5] flex animate-rise items-center justify-center`}>
      <div className="relative h-full">
        {useImg ? (
          <img src={(paused && job.poster) || job.webp!} alt={alt} className="h-full w-auto object-contain" />
        ) : (
          <video ref={video} src={job.mp4!} poster={job.poster ?? undefined} loop muted playsInline autoPlay={!paused} aria-label={alt} onError={() => setUseImg(true)} className="h-full w-auto object-contain" />
        )}
        <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur">🎬 {label}</span>
          <CtlButton label={paused ? "Play video" : "Pause video"} onClick={() => setPaused((x) => !x)}>{paused ? "▶" : "❚❚"}</CtlButton>
          <CtlButton label="About this video" onClick={() => setInfo((x) => !x)}>i</CtlButton>
          <CtlButton label="Close video" onClick={onClose}>✕</CtlButton>
        </div>
        {info && (
          <div className="glass absolute inset-x-2 top-14 rounded-2xl p-3 text-xs leading-relaxed">
            <p>✨ AI video try-on · fit can differ</p>
            {job.guard && <p>🛡️ {job.guard.sampledFrames} frames checked · identity steady {Math.round((job.guard.identityStability ?? 0) * 100)}%</p>}
            {job.c2pa && <p>🔏 Content Credentials (C2PA) · {job.c2pa.model} · #{job.c2pa.sha256}</p>}
            {job.source === "CLIP" && <p>🗑️ Your clip {job.clipDeleted ? "has been deleted" : "is being deleted"}.</p>}
          </div>
        )}
      </div>
    </div>,
    target,
  );
}

function CtlButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="glass grid size-9 place-items-center rounded-full text-sm">
      {children}
    </button>
  );
}

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 drop-shadow-[0_0_8px_rgba(224,112,63,.6)]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="13" height="14" rx="2.5" fill="rgba(224,112,63,.18)" />
      <path d="m16 10 5-3v10l-5-3z" />
    </svg>
  );
}
