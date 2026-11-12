"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { Turnaround } from "@/lib/twin3d";

const TARGET = 24;
const STEP_DEG = 360 / TARGET;

type Live = { light: "ok" | "dark" | "bright" | null; framing: "ok" | "far" | "near" | null; turning: boolean };

/**
 * 360° turn capture (E33, FR-AVA-01). Camera mode samples ~24 frames while the shopper turns slowly; live on-device
 * checks gate each sample (light, framing, movement) and fill the coverage ring. Each accepted sample advances the
 * turn by 15°, so the angle is estimated from a steady turn, not measured; the server re-checks rotation from the
 * silhouette widths. Persona mode plays a synthetic turnaround (no real person) through the same ring.
 */
export function TurnCapture({
  persona,
  onFrames,
  onPersonaDone,
  onCancel,
}: {
  persona?: Turnaround | null;
  onFrames?: (frames: Blob[], yaws: number[]) => void;
  onPersonaDone?: () => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(0);
  const [live, setLive] = useState<Live>({ light: null, framing: null, turning: false });
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const frames = useRef<Blob[]>([]);
  const yaws = useRef<number[]>([]);
  const done = useRef(false);

  const pct = Math.round((Math.min(count, TARGET) / TARGET) * 100);

  // ── persona playback: same ring, synthetic frames ──
  useEffect(() => {
    if (!persona) return;
    // Preload so the turn plays smoothly.
    persona.frames.forEach((src) => {
      const i = new Image();
      i.src = src;
    });
    let k = 0;
    setLive({ light: "ok", framing: "ok", turning: true });
    const id = setInterval(() => {
      k += 1;
      setFrame(k % persona.frames.length);
      setCount(Math.min(TARGET, Math.round((k / persona.frames.length) * TARGET)));
      if (k % 6 === 0) navigator.vibrate?.(6);
      if (k >= persona.frames.length && !done.current) {
        done.current = true;
        clearInterval(id);
        setTimeout(() => onPersonaDone?.(), 450);
      }
    }, 140);
    return () => clearInterval(id);
  }, [persona, onPersonaDone]);

  // ── camera ──
  useEffect(() => {
    if (persona) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera unavailable. Use a synthetic persona or your measurements instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [persona]);

  const grab = useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 854;
    const ctx = c.getContext("2d")!;
    // Cover-fit the portrait frame, mirrored like the preview.
    const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const w = v.videoWidth * s;
    const h = v.videoHeight * s;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    const yaw = yaws.current.length * STEP_DEG;
    c.toBlob((b) => {
      if (!b || done.current) return;
      frames.current.push(b);
      yaws.current.push(yaw);
      const n = frames.current.length;
      setCount(n);
      if (n % 6 === 0) navigator.vibrate?.(8);
      if (n >= TARGET) {
        done.current = true;
        navigator.vibrate?.([10, 40, 10]);
        onFrames?.(frames.current, yaws.current);
      }
    }, "image/jpeg", 0.8);
  }, [onFrames]);

  useEffect(() => {
    if (persona) return;
    const small = document.createElement("canvas");
    small.width = 36;
    small.height = 64;
    let prev: Float32Array | null = null;
    const id = setInterval(() => {
      const v = video.current;
      const ctx = small.getContext("2d", { willReadFrequently: true });
      if (!v || !ctx || v.readyState < 2 || done.current) return;
      ctx.drawImage(v, 0, 0, small.width, small.height);
      const d = ctx.getImageData(0, 0, small.width, small.height).data;
      const lum = new Float32Array(small.width * small.height);
      let sum = 0;
      for (let i = 0; i < lum.length; i++) {
        lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        sum += lum[i];
      }
      const mean = sum / lum.length;
      // Border median ≈ background; pixels far from it ≈ the person (framing).
      const border: number[] = [];
      for (let x = 0; x < small.width; x++) border.push(lum[x], lum[(small.height - 1) * small.width + x]);
      border.sort((a, b) => a - b);
      const bg = border[border.length >> 1];
      let fg = 0;
      for (let i = 0; i < lum.length; i++) if (Math.abs(lum[i] - bg) > 28) fg++;
      const occ = fg / lum.length;
      let motion = 0;
      if (prev) for (let i = 0; i < lum.length; i++) motion += Math.abs(lum[i] - prev[i]);
      motion /= lum.length;
      prev = lum;
      const light = mean < 45 ? "dark" : mean > 215 ? "bright" : "ok";
      const framing = occ < 0.08 ? "far" : occ > 0.8 ? "near" : "ok";
      const turning = motion > 2.2;
      setLive({ light, framing, turning });
      if (light === "ok" && framing === "ok" && turning) grab();
    }, 380);
    return () => clearInterval(id);
  }, [persona, grab]);

  const hint = error
    ? error
    : live.light === "dark"
      ? "Find more light"
      : live.light === "bright"
        ? "Too bright · out of direct sun"
        : live.framing === "far"
          ? "Step into the frame, head to feet"
          : live.framing === "near"
            ? "Step back a little"
            : !live.turning && count > 0 && count < TARGET
              ? "Keep turning slowly ↻"
              : count >= TARGET
                ? "Got every side ✓"
                : "Turn slowly once ↻";

  const R = 44;
  const C = 2 * Math.PI * R;
  return (
    <main className="relative mx-4 overflow-hidden rounded-[32px] bg-black" style={{ height: "calc(100dvh - 120px)" }}>
      {persona ? (
        <img src={persona.frames[frame]} alt={`Synthetic persona ${persona.persona} turning, ${Math.round(persona.yaws[frame] ?? 0)}°`} className="h-full w-full object-cover" />
      ) : (
        <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      )}
      {/* Scan ring + outline, like the prototype's mirror scan */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-[80%] w-[46%] rounded-[45%_45%_20%_20%] border-2 border-dashed border-sky/60" />
        <div className="absolute inset-x-[18%] h-10 animate-[scan_2.4s_ease-in-out_infinite] rounded-[50%] border-2 border-sky/80 shadow-[0_0_24px_#38bdf8] motion-reduce:animate-none" />
      </div>
      <div className="absolute inset-x-0 top-3 flex flex-col items-center gap-2 px-3">
        <p className="font-display text-2xl font-black drop-shadow">{persona ? "Synthetic turnaround" : "Mirror moment"}</p>
        <span className="glass rounded-full px-3 py-1 text-sm" role="status" aria-live="polite">{hint}</span>
        <ul className="flex gap-1.5 text-[11px]" aria-label="Live checks">
          <CheckChip ok={live.light === "ok"} label="Light" />
          <CheckChip ok={live.framing === "ok"} label="Framing" />
          <CheckChip ok={live.turning || count >= TARGET} label="Turning" />
        </ul>
        {persona && <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] text-mut">Synthetic person · no real image used</span>}
      </div>
      <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-6">
        <Button variant="glass" onClick={onCancel}>Cancel</Button>
        <div className="relative grid size-28 place-items-center" role="progressbar" aria-label="Turn coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
            <circle cx="50" cy="50" r={R} fill="rgba(11,10,15,.75)" stroke="rgba(255,255,255,.15)" strokeWidth="8" />
            <circle cx="50" cy="50" r={R} fill="none" stroke="#5eead4" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none" style={{ filter: "drop-shadow(0 0 6px #5eead4)" }} />
          </svg>
          <span className="relative font-display text-2xl font-black">{pct}%</span>
        </div>
        <span className="w-[88px]" />
      </div>
    </main>
  );
}

function CheckChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`rounded-full border px-2 py-0.5 font-semibold backdrop-blur ${ok ? "border-mint/50 bg-mint/20 text-mint" : "bg-black/50 text-white/70 border-transparent"}`}>
      {ok ? "✓" : "·"} {label}
    </li>
  );
}
