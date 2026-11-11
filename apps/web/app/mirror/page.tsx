"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Twin3dCard } from "@/components/twin3d-card";
import { Button, ErrorNote, Screen, Spinner, TopBar } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

type Step = "intro" | "camera" | "review" | "saving" | "ready";
type Checks = Record<string, { pass: boolean; note: string }>;

const CHECK_LABEL: Record<string, string> = {
  resolution: "Sharp enough",
  lighting: "Good light",
  portrait: "Phone upright",
  single_subject: "Only you in frame",
  full_body: "Head to feet visible",
};

/** Mirror moment (US-06.1): a private photo twin, created only after explicit consent. */
export default function Mirror() {
  const { me, loading, t, locale, reload } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [consent, setConsent] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twin, setTwin] = useState<{ preview: string; size: string | null } | null>(null);

  useEffect(() => {
    if (!loading && !me) router.replace("/signin?next=/mirror");
  }, [loading, me, router]);

  useEffect(() => {
    if (me?.hasTwin && step === "intro") {
      api<{ twin: { preview: string; size: string | null } | null }>("/twin").then((r) => {
        if (r.twin) {
          setTwin(r.twin);
          setStep("ready");
        }
      });
    }
  }, [me, step]);

  async function review(b: Blob) {
    setBlob(b);
    setPreview(URL.createObjectURL(b));
    setStep("review");
    setChecks(null);
    setError(null);
    const fd = new FormData();
    fd.append("file", b, "twin.png");
    try {
      const r = await api<{ ok: boolean; checks: Checks }>("/twin/check", { method: "POST", body: fd });
      setChecks(r.checks);
      setOk(r.ok);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!blob) return;
    setStep("saving");
    const fd = new FormData();
    fd.append("file", blob, "twin.png");
    fd.append("consent", "true");
    fd.append("locale", locale);
    try {
      await api("/twin", { method: "POST", body: fd });
      await finish();
    } catch (e) {
      const body = (e as ApiError).body as { checks?: Checks } | undefined;
      if (body?.checks) setChecks(body.checks);
      setError((e as Error).message);
      setStep("review");
    }
  }

  async function persona(n: number) {
    setStep("saving");
    try {
      await api("/twin/persona", { method: "POST", json: { persona: n, consent: true, locale } });
      await finish();
    } catch (e) {
      setError((e as Error).message);
      setStep("intro");
    }
  }

  async function finish() {
    const r = await api<{ twin: { preview: string; size: string | null } }>("/twin");
    setTwin(r.twin);
    await reload();
    setStep("ready");
  }

  return (
    <Screen>
      <TopBar back="/" title={t("mirror.title")} />
      {step === "intro" && (
        <main className="flex min-h-[85dvh] flex-col justify-between gap-6 px-5 pb-8">
          <div className="pt-6 text-center">
            <Silhouette scanning />
            <h1 className="mt-4 font-display text-3xl font-black text-grad">{t("mirror.title")}</h1>
            <p className="mt-2 text-mut">Create a private twin once, and every look appears on you.</p>
          </div>
          <div className="space-y-3">
            <ConsentCard consent={consent} setConsent={setConsent} />
            <ErrorNote error={error} />
            <Button className="w-full" disabled={!consent} onClick={() => setStep("camera")}>📷 Open camera</Button>
            <label className={`glass flex min-h-12 w-full items-center justify-center rounded-2xl font-semibold ${!consent ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
              {t("mirror.upload")}
              <input type="file" accept="image/*" className="sr-only" disabled={!consent} onChange={(e) => e.target.files?.[0] && review(e.target.files[0])} />
            </label>
            <details className="text-center text-sm text-mut">
              <summary className="cursor-pointer">{t("mirror.useDemo")}</summary>
              <p className="mt-2 text-xs">Synthetic people for testing; no real person's image is used.</p>
              <div className="mt-2 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} disabled={!consent} onClick={() => persona(n)} className="glass size-11 rounded-full font-semibold disabled:opacity-40" aria-label={`Persona ${n}`}>
                    {n}
                  </button>
                ))}
              </div>
            </details>
            <Link href="/mirror/3d" className="block text-center text-sm text-gold">🧊 Prefer 3D? Make a 3D twin →</Link>
          </div>
        </main>
      )}

      {step === "camera" && <Camera onCapture={review} onCancel={() => setStep("intro")} />}

      {(step === "review" || step === "saving") && (
        <main className="space-y-4 px-5 pb-8">
          {preview && <img src={preview} alt="Your capture" className="mx-auto max-h-[52dvh] rounded-3xl object-contain" />}
          {!checks && !error && <p className="flex items-center justify-center gap-2 text-mut"><Spinner /> Checking…</p>}
          {checks && (
            <ul className="glass space-y-1.5 rounded-2xl p-4 text-sm">
              {Object.entries(checks).map(([k, c]) => (
                <li key={k} className="flex items-start gap-2">
                  <span className={c.pass ? "text-mint" : "text-terra"}>{c.pass ? "✓" : "✕"}</span>
                  <span><b>{CHECK_LABEL[k] ?? k}</b>{!c.pass && <span className="text-mut"> · {c.note}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          <ErrorNote error={error} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="glass" onClick={() => setStep("camera")}>Retake</Button>
            <Button disabled={!ok || step === "saving"} onClick={save}>{step === "saving" ? <Spinner /> : "Save my twin"}</Button>
          </div>
        </main>
      )}

      {step === "ready" && twin && (
        <main className="flex min-h-[85dvh] flex-col items-center justify-between gap-6 px-5 pb-8 pt-4 text-center">
          <div>
            <img src={twin.preview} alt="Your twin" className="mx-auto max-h-[50dvh] rounded-3xl object-contain shadow-[0_0_60px_rgba(56,189,248,.25)]" />
            <h1 className="mt-4 font-display text-3xl font-black text-grad">{t("mirror.ready")} ✓</h1>
            <p className="mt-1 text-mut">Size estimate {twin.size ?? "—"} · encrypted · only you see it</p>
          </div>
          <div className="w-full space-y-2">
            <Twin3dCard />
            <Link href="/" className="block"><Button className="w-full">✨ Ask the Muse</Button></Link>
            <Link href="/trust" className="block text-sm text-mut underline">Manage or delete my twin</Link>
            <button onClick={() => setStep("intro")} className="text-sm text-mut underline">Retake twin</button>
          </div>
        </main>
      )}
    </Screen>
  );
}

function ConsentCard({ consent, setConsent }: { consent: boolean; setConsent: (v: boolean) => void }) {
  const { t } = useSession();
  return (
    <label className="glass flex cursor-pointer items-center gap-3 rounded-3xl p-4">
      <span className="text-2xl">🔒</span>
      <span className="flex-1 text-sm">
        <b>{t("mirror.consentTitle")}</b> · {t("mirror.consentBody")}
      </span>
      <input type="checkbox" role="switch" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="peer sr-only" aria-label="I consent to creating my private twin" />
      <span className={`relative h-7 w-12 rounded-full transition ${consent ? "bg-mint" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white transition-all ${consent ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

function Silhouette({ scanning }: { scanning?: boolean }) {
  return (
    <div className="relative mx-auto h-56 w-28">
      <svg viewBox="0 0 100 200" className="h-full w-full text-white/15" aria-hidden>
        <circle cx="50" cy="22" r="16" fill="currentColor" />
        <path d="M28 44h44l8 70h-10l-4 82H54l-4-60-4 60H34l-4-82H20z" fill="currentColor" />
      </svg>
      {scanning && <div className="absolute inset-x-[-20px] h-0.5 animate-[scan_2.4s_ease-in-out_infinite] bg-sky shadow-[0_0_16px_#38bdf8]" />}
    </div>
  );
}

/** Camera capture with live on-device light check; nothing leaves the phone until the shopper captures. */
function Camera({ onCapture, onCancel }: { onCapture: (b: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [light, setLight] = useState<"ok" | "dark" | "bright" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let s: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false })
      .then((m) => {
        s = m;
        setStream(m);
        if (video.current) video.current.srcObject = m;
      })
      .catch(() => setError("Camera unavailable. You can upload a full-body photo instead."));
    return () => s?.getTracks().forEach((tr) => tr.stop());
  }, []);

  useEffect(() => {
    if (!stream) return;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 56;
    const id = setInterval(() => {
      const v = video.current;
      const ctx = c.getContext("2d");
      if (!v || !ctx || v.readyState < 2) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const mean = sum / (d.length / 4);
      setLight(mean < 45 ? "dark" : mean > 215 ? "bright" : "ok");
    }, 500);
    return () => clearInterval(id);
  }, [stream]);

  const grab = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b), "image/jpeg", 0.92);
  }, [onCapture]);

  function startTimer() {
    setCount(3);
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(id);
        setCount(null);
        grab();
      } else setCount(n);
    }, 1000);
  }

  return (
    <main className="relative mx-4 overflow-hidden rounded-[32px] bg-black" style={{ height: "calc(100dvh - 140px)" }}>
      <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-[82%] w-[46%] rounded-[45%_45%_20%_20%] border-2 border-dashed border-sky/70" />
        <div className="absolute inset-x-0 h-0.5 animate-[scan_2.4s_ease-in-out_infinite] bg-sky/80 shadow-[0_0_16px_#38bdf8]" />
      </div>
      {count && <div className="absolute inset-0 grid place-items-center font-display text-8xl font-black">{count}</div>}
      <div className="absolute inset-x-0 top-3 text-center">
        <span className="glass rounded-full px-3 py-1 text-sm">
          {error ? "📷 " + error : light === "dark" ? "💡 Find more light" : light === "bright" ? "☀️ Too bright, step out of direct sun" : "Stand back · whole body in the outline"}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-6">
        <Button variant="glass" onClick={onCancel}>Cancel</Button>
        <button aria-label="Capture in 3 seconds" disabled={!stream} onClick={startTimer} className="size-20 rounded-full border-4 border-white bg-white/20 disabled:opacity-40" />
        <span className="w-[88px]" />
      </div>
    </main>
  );
}
