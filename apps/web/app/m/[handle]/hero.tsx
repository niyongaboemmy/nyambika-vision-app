"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { useSession } from "@/lib/session";

export interface HeroPiece {
  id: string;
  title: string;
  priceRwf: number;
  glb: string | null;
  poster: string | null;
  heightM: number;
}

type Palette = { primary: string; secondary: string; deep: string };

// three.js and the showroom engine arrive only when the hero is on screen, after the page has loaded (JS budget).
const ShowroomPreview = dynamic(() => import("./showroom-preview").then((m) => m.ShowroomPreview), { ssr: false });

/**
 * Showroom-first hero: a composed poster of the top pieces on a lit stage (server-rendered, instant), replaced by a
 * live, non-interactive look around the maker's real 3D showroom once seen. One primary action, Enter showroom,
 * and View in VR when the device offers immersive-vr. No live preview on data saver, very low memory or without
 * WebGL2; reduced motion keeps it still.
 */
export function ShowroomHero({ handle, name, palette, banner, pieces, showroom, label, chip }: { handle: string; name: string; palette: Palette; banner: string; pieces: HeroPiece[]; showroom: boolean; label: string | null; chip?: ReactNode }) {
  const { t } = useSession();
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [xr, setXr] = useState(false);
  const href = `/m/${handle}/showroom`;
  const n3d = pieces.filter((p) => p.glb).length;

  useEffect(() => {
    if (!showroom) return;
    let gone = false;
    void import("@/lib/vr").then(({ xrSupported }) => xrSupported()).then((ok) => !gone && setXr(ok));
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (nav.connection?.saveData || (nav.deviceMemory ?? 8) <= 2) return;
    try {
      if (!document.createElement("canvas").getContext("webgl2")) return;
    } catch {
      return;
    }
    const el = ref.current;
    if (!el) return;
    let idle: number | undefined;
    const boot = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idle = ric ? ric(() => !gone && setLive(true), { timeout: 1500 }) : window.setTimeout(() => !gone && setLive(true), 300);
    };
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (document.readyState === "complete") boot();
      else window.addEventListener("load", boot, { once: true });
    }, { threshold: 0.35 });
    io.observe(el);
    return () => {
      gone = true;
      io.disconnect();
      window.removeEventListener("load", boot);
      if (idle) (window.cancelIdleCallback ?? clearTimeout)(idle);
    };
  }, [showroom]);

  const [a, b, c] = pieces.filter((p) => p.poster);
  return (
    <section
      ref={ref}
      aria-label={`${name} showroom`}
      className="theme-media relative isolate flex h-[clamp(380px,58dvh,500px)] flex-col justify-end overflow-hidden rounded-b-[32px] text-txt lg:h-[520px] lg:rounded-[32px]"
      style={{ background: `radial-gradient(90% 70% at 50% 18%, ${palette.primary}55, transparent 70%), radial-gradient(70% 45% at 50% 100%, ${palette.secondary}2e, transparent 75%), linear-gradient(180deg, ${palette.deep}, #0b0a0f 85%)` }}
    >
      {/* Stage: composed poster first, the live room fades in over it. Decorative; tapping it enters the room. */}
      <div aria-hidden onClick={showroom ? () => router.push(href) : undefined} className={`absolute inset-0 ${showroom ? "cursor-pointer" : ""}`}>
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
          <div className="absolute inset-x-[6%] bottom-[30%] h-12 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,255,255,.16),transparent)]" />
          {b && <PosterImg p={b} className="bottom-[35%] left-[7%] w-[31%] -rotate-[7deg] opacity-85 lg:left-[14%] lg:w-[22%]" />}
          {c && <PosterImg p={c} className="bottom-[35%] right-[7%] w-[31%] rotate-[7deg] opacity-85 lg:right-[14%] lg:w-[22%]" />}
          {a && <PosterImg p={a} className="bottom-[33%] left-1/2 w-[40%] -translate-x-1/2 lg:w-[28%]" />}
        </div>
        {live && <ShowroomPreview name={name} banner={banner} palette={palette} pieces={pieces} visible={ready} onReady={() => setReady(true)} />}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

      <div className="relative z-10 px-4 pb-5 lg:px-6 lg:pb-6">
        <div className="flex items-center gap-1.5">
          {chip}
          {n3d > 0 && label && (
            <span title={label} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2.5 text-[12px] font-medium text-txt/85 backdrop-blur">
              <Icon name="sparkle" className="size-3" /> AI 3D
            </span>
          )}
        </div>
        {showroom && (
          <div id="hero-cta" className="mt-3 flex gap-2">
            <Link href={href} className="press grad-cta inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 text-[17px] font-bold shadow-[0_14px_36px_rgba(139,92,246,.4)]">
              <Icon name="cube" className="size-5" /> {t("maker.enterShowroom")}
            </Link>
            {xr && (
              <Link href={`${href}?vr=1`} className="press inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-white/15 px-4 font-semibold backdrop-blur">
                <Icon name="headset" className="size-5" /> {t("maker.viewVr")}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PosterImg({ p, className }: { p: HeroPiece; className: string }) {
  return (
    <img
      src={p.poster!}
      alt=""
      draggable={false}
      decoding="async"
      className={`absolute aspect-[3/4] rounded-[22px] bg-white/10 object-cover shadow-[0_24px_40px_-12px_rgba(0,0,0,.7)] ${className}`}
    />
  );
}
