"use client";

import { useDrag } from "@/lib/drag";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAsk } from "@/components/circle-ask";
import { MAT_BASE, MATERIAL, preloadLookExtras, RailButton, SPRING } from "@/components/look-rail";
import { MorphRail } from "@/components/morph-sheet";
import { XrRail } from "@/components/xr-rail";
import { VideoRail } from "@/components/video-tryon";
import { LookPrice } from "@/components/region";
import { Icon, type IconName } from "@/components/icons";
import { Avatar, Sheet } from "@/components/ui";
import { rwf } from "@/lib/api";
import { isRendering, type Look } from "@/lib/looks";
import { haptic } from "@/lib/native";
import { useSession } from "@/lib/session";

interface Props {
  look: Look;
  index?: number;
  total?: number;
  intentLabel?: string | null;
  onSave: () => void;
  onVariant: (variantId: string) => void;
  onHold?: () => void;
  /** A limit card (daily cap, kill switch…) is showing: don't animate a render that isn't coming. */
  paused?: boolean;
  /** This look is the one on screen (entrance spring, coach mark). Defaults to true (single try-on). */
  active?: boolean;
  children?: ReactNode;
}

// Coach mark / swipe peek and the heart burst never paint on first load: a post-load chunk (JS budget pass 2).
const CoachHint = dynamic(() => preloadLookExtras().then((m) => m.CoachHint), { ssr: false });

const COACH_KEY = "nv-looks-coach-v1";
const MEMBER: Record<string, [IconName, string]> = { TAILOR: ["scissors", "Tailor"], COOPERATIVE: ["users", "Cooperative"], SELLER: ["bag", "Seller"] };

/** Occasion → glyph for the intent chip (no emoji). */
function intentIcon(label: string): IconName {
  const l = label.toLowerCase();
  if (l.startsWith("snapped")) return "camera";
  if (/wedding|ubukwe|mariage|dowry|gusaba/.test(l)) return "ring";
  if (/party|birthday|ibirori|fête/.test(l)) return "gift";
  if (/graduat/.test(l)) return "crown";
  if (/office|work|interview|meeting/.test(l)) return "store";
  if (/church|mass|service|traditional|ceremony/.test(l)) return "bell";
  return "sparkle";
}

/**
 * One full-bleed look on the shopper's twin (iOS-style): the render fills the screen edge to edge and every
 * control floats over it on dark materials. Double-tap saves (animated heart), single tap hides/shows the chrome,
 * swipe left opens the Maker Space, the stream pages vertically (snap + parallax in the page).
 */
export function LookView({ look, index, total, intentLabel, onSave, onVariant, paused, active = true, children }: Props) {
  const { t } = useSession();
  const router = useRouter();
  const [ring, setRing] = useState(false);
  const [about, setAbout] = useState(false);
  const [ask, setAsk] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [dx, setDx] = useState(0);
  const [coach, setCoach] = useState(false);
  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heart = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const makerHref = `/m/${look.maker.handle}`;

  // Chrome comes back whenever the look changes or leaves the screen.
  useEffect(() => { if (!active) setChrome(true); }, [active]);
  useEffect(() => () => { if (single.current) clearTimeout(single.current); }, []);
  // Gesture extras are fetched once the card is up and the main thread is idle, before the first long-press/drag.
  useEffect(() => {
    const go = () => void preloadLookExtras();
    if ("requestIdleCallback" in window) {
      const h = window.requestIdleCallback(go, { timeout: 2000 });
      return () => window.cancelIdleCallback(h);
    }
    const h = setTimeout(go, 600);
    return () => clearTimeout(h);
  }, []);

  // One-time coach mark (swipe to the maker, scroll for the next look), then nothing.
  useEffect(() => {
    if (!active || (index ?? 0) !== 0) return;
    let seen = true;
    try {
      seen = localStorage.getItem(COACH_KEY) === "1";
      if (!seen) localStorage.setItem(COACH_KEY, "1");
    } catch {
      seen = true;
    }
    if (seen) return;
    setCoach(true);
    const h = setTimeout(() => setCoach(false), 4200);
    return () => clearTimeout(h);
  }, [active, index]);

  function tap(e: React.MouseEvent) {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // Double tap: save + heart burst where the finger is.
      if (single.current) clearTimeout(single.current);
      lastTap.current = 0;
      if (!look.saved) onSave();
      haptic("success");
      const el = heart.current;
      const box = root.current?.getBoundingClientRect();
      if (el && box) {
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        void preloadLookExtras().then((m) => m.burstHeart(el, x, y));
      }
      return;
    }
    lastTap.current = now;
    setCoach(false);
    // Single tap (after the double-tap window): hide/show the floating chrome, like a photo viewer.
    if (single.current) clearTimeout(single.current);
    single.current = setTimeout(() => setChrome((c) => !c), 300);
  }

  // Swipe left anywhere on the look → Maker Space (rubber-band follow + edge peek; vertical scroll stays native).
  // lib/drag.ts (JS budget pass) reports first/last/movement only; a flick = short, fast leftward swipe.
  const dragT0 = useRef(0);
  const bind = useDrag(
    ({ first, last, movement: [mx], tap: isTap }) => {
      if (isTap) return;
      if (first) dragT0.current = performance.now();
      setCoach(false);
      if (!last) {
        setDx(Math.min(0, mx));
        return;
      }
      const ms = Math.max(1, performance.now() - dragT0.current);
      if (mx < -70 || (mx < -24 && -mx / ms > 0.6)) {
        haptic("medium");
        router.push(makerHref);
      }
      setDx(0);
    },
    { axis: "x", filterTaps: true },
  );

  const share = async () => {
    const url = `${window.location.origin}${makerHref}`;
    const text = `Which one? "${look.product.title}" by ${look.maker.name} · ${rwf(look.product.priceRwf)} (AI preview) ${url}`;
    if (navigator.share) await navigator.share({ title: look.product.title, text, url }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const pull = Math.min(1, -dx / 70);
  const [mIcon, mLabel] = MEMBER[look.maker.memberType] ?? ["store", "Maker"];
  const chromeCls = `transition-[opacity,transform] duration-300 ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`;
  const enter = { transitionTimingFunction: SPRING, transform: active ? "none" : "translateY(14px)" } as const;

  return (
    <div
      ref={root}
      // Portalled sheets (morph ring, buy) bubble React events through this tree: only swipe on real DOM descendants.
      onPointerDown={(e) => e.currentTarget.contains(e.target as Node) && bind().onPointerDown(e)}
      className="theme-media relative h-full w-full touch-pan-y overflow-hidden bg-black text-txt"
      style={{ transform: dx ? `translateX(${dx * 0.35}px)` : undefined, transition: dx ? "none" : `transform 420ms ${SPRING}` }}
    >
      {/* Media: full bleed, under the status bar and the home indicator. Parallax comes from --p on the section. */}
      <div className="absolute inset-0" onClick={tap}>
        {look.status === "DELIVERED" && look.image ? (
          <img
            src={look.image}
            alt={`${look.product.title} in ${look.variant.colourName}, AI preview on ${look.onTwin ? "your twin" : "an AI model"}`}
            className="absolute inset-0 size-full object-cover object-[50%_35%] will-change-transform"
            style={{ transform: "translate3d(0, calc(var(--p, 0) * -22% + max(env(safe-area-inset-top), 12px) + 4dvh), 0) scale(1.04)", transformOrigin: "50% 0" }}
            draggable={false}
          />
        ) : isRendering(look.status) && paused ? (
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_40%,rgba(224,112,63,.18),transparent_70%)]" />
        ) : isRendering(look.status) ? (
          <div className="absolute inset-0" role="status" aria-label={t("looks.generating")}>
            <div className="skeleton absolute inset-0 rounded-none" />
            <div className="absolute inset-x-0 h-0.5 animate-[scan_1.8s_ease-in-out_infinite] bg-sky/80 shadow-[0_0_24px_#38bdf8]" style={{ top: "40%" }} />
            <span className={`absolute left-1/2 top-[42%] inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold text-white ${MATERIAL}`}>
              <Icon name="sparkle" className="size-4 text-gold" />
              {t("looks.generating")}
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-8">
            <p className={`inline-flex max-w-[280px] items-center gap-2 rounded-2xl px-4 py-3 text-center text-sm text-white ${MATERIAL}`}>
              <Icon name="eyeOff" className="size-4 shrink-0" />
              {t("looks.withheld")}
            </p>
          </div>
        )}
        <span ref={heart} aria-hidden className="pointer-events-none absolute z-20 opacity-0 drop-shadow-[0_6px_24px_rgba(224,112,63,.85)]">
          <Icon name="heart" filled className="size-24 text-white" />
        </span>
      </div>

      {/* Legibility scrims (the stream is a dark stage in both themes). */}
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 via-black/25 to-transparent ${chromeCls}`} />
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-black/80 via-black/35 to-transparent ${chromeCls}`} />

      {/* Top bar: ONE compact line — back · intent + page position · AI chip (the AI chip never hides). */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)]">
        <Link inert={!chrome} href="/" aria-label="Back to Muse" className={`hit grid size-10 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90 ${MATERIAL} ${chromeCls}`}>
          <Icon name="back" className="size-5" />
        </Link>
        <div inert={!chrome} className={`flex min-w-0 flex-1 justify-center ${chromeCls}`}>
          {intentLabel || (total && total > 1) ? <PageCapsule label={intentLabel?.replace(/^For:\s*/, "") ?? null} icon={intentLabel ? intentIcon(intentLabel) : null} index={index ?? 0} total={total ?? 0} /> : null}
        </div>
        <button
          type="button"
          onClick={() => setAbout(true)}
          aria-label={`AI · C2PA — ${look.onTwin ? t("looks.onTwin") : t("looks.onModel")}`}
          className={`hit inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-white transition-transform active:scale-95 ${MATERIAL}`}
        >
          <Icon name="sparkle" className="size-3.5 text-gold" />
          AI{" "}
          <span className="text-white/70">· C2PA</span>
        </button>
      </div>

      {/* Right rail: glass circles, SF-like glyphs; names on the buttons, captions tiny or on long-press. */}
      <div
        inert={!chrome}
        className={`absolute right-4 z-10 flex flex-col items-center justify-center gap-3 top-[calc(max(env(safe-area-inset-top),12px)+56px)] bottom-[calc(max(13dvh,128px)+max(env(safe-area-inset-bottom),14px)-6px)] ${chromeCls}`}
        style={enter}
      >
        <RailButton label={look.saved ? t("looks.saved") : t("looks.save")} onClick={onSave} active={look.saved}>
          <Icon name="heart" filled={look.saved} className="size-[22px]" />
        </RailButton>
        {look.variants.length > 1 && (
          <RailButton label={t("looks.colours")} onClick={() => setRing(true)}>
            <Icon name="palette" className="size-[22px]" />
          </RailButton>
        )}
        <MorphRail look={look} />
        <XrRail look={look} />
        <VideoRail look={look} />
        <RailButton label="Ask" onClick={() => setAsk(true)}>
          <Icon name="users" className="size-[22px]" />
        </RailButton>
        <RailButton label={t("looks.share")} onClick={share}>
          <Icon name="share" className="size-[22px]" />
        </RailButton>
      </div>

      {/* One-time coach mark (fades), and the live peek while dragging left: bottom-left, clear of the rail. */}
      {(coach || pull > 0.1) && <CoachHint next={coach && Boolean(total && total > 1)} pull={pull} dragging={dx !== 0} />}

      {/* Maker card + Buy: a glass sheet along the bottom. It always covers the bottom 12 %+ of the render
          (the gateway's baked AI tag sits there) — the in-app AI chip above stays the visible label. */}
      <div
        inert={!chrome}
        className={`absolute inset-x-0 bottom-0 z-10 ${chromeCls}`}
        style={enter}
      >
        <div className={`rounded-t-[28px] px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3.5 ${MAT_BASE} border-x-0 border-b-0 bg-black/55`} style={{ minHeight: "max(13dvh, 128px)" }}>
          <Link href={makerHref} className="flex min-h-11 min-w-0 items-center gap-3 rounded-2xl outline-offset-4">
            <Avatar name={look.maker.name} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5 font-display text-[17px] font-black leading-tight text-white">
                <span className="truncate">{look.maker.name}</span>
                {look.maker.verified && (
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-mint text-black">
                    <Icon name="check" className="size-3" />
                    <span className="sr-only">verified</span>
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-white/75">
                <Icon name={mIcon} className="size-3.5 shrink-0" />
                <span className="truncate">{mLabel} · {look.maker.sector}{look.maker.madeBy.length ? ` · by ${look.maker.madeBy.join(", ")}` : ""}</span>
              </span>
            </span>
            <Icon name="chevron" className="size-4 shrink-0 text-white/60" />
          </Link>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 text-white">
              <span className="block font-display text-xl font-black leading-tight tabular-nums">
                <LookPrice handle={look.maker.handle} productId={look.product.id} priceRwf={look.product.priceRwf} />
              </span>
              <span className="block truncate text-[13px] text-white/75">{look.product.madeToOrder ? "Made to measure" : look.product.title}</span>
            </p>
            {children}
          </div>
        </div>
      </div>

      {/* Colour ring: snaps to the maker's real variants (R1) */}
      <Sheet open={ring} onClose={() => setRing(false)} title={t("looks.colours")}>
        <div className="relative mx-auto size-64">
          <div className="orb absolute inset-8 rounded-full opacity-30 blur-xl" />
          {look.variants.map((v, i) => {
            const a = (i / look.variants.length) * Math.PI * 2 - Math.PI / 2;
            const on = v.id === look.variant.id;
            return (
              <button
                key={v.id}
                aria-label={v.colourName}
                aria-pressed={on}
                onClick={() => {
                  haptic("light");
                  onVariant(v.id);
                  setRing(false);
                }}
                className={`absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 transition-transform duration-300 active:scale-90 ${on ? "scale-110 border-gold" : ""}`}
                style={{ left: `${50 + Math.cos(a) * 38}%`, top: `${50 + Math.sin(a) * 38}%`, background: v.colourHex, transitionTimingFunction: SPRING }}
              />
            );
          })}
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-center text-sm font-semibold">{look.variant.colourName}</p>
        </div>
        <p className="mt-3 text-center text-xs text-mut">Maker&apos;s real colours</p>
      </Sheet>

      <CircleAsk look={look} open={ask} onClose={() => setAsk(false)} intentLabel={intentLabel} />

      {/* Content credentials */}
      <Sheet open={about} onClose={() => setAbout(false)} title="Content credentials">
        <ul className="space-y-2.5 text-sm text-txt/90">
          <li className="flex items-center gap-2.5"><Icon name="sparkle" className="size-4 shrink-0 text-gold" />AI preview on {look.onTwin ? "your twin" : "an AI model"} · fit can differ</li>
          <li className="flex items-center gap-2.5"><Icon name="shield" className="size-4 shrink-0 text-gold" />Quality and fairness checked</li>
          {look.c2pa && <li className="flex items-start gap-2.5 break-all"><Icon name="lock" className="mt-0.5 size-4 shrink-0 text-gold" />C2PA signed · {look.c2pa.model} · #{look.c2pa.sha256}</li>}
          <li className="flex items-center gap-2.5"><Icon name="eyeOff" className="size-4 shrink-0 text-gold" />Only you see it · never shared with makers</li>
        </ul>
      </Sheet>
    </div>
  );
}

/** Intent + position in one capsule ("Wedding · Sat · 1/9"): the page indicator folded into the top bar. */
function PageCapsule({ label, icon, index, total }: { label: string | null; icon: IconName | null; index: number; total: number }) {
  const pos = total > 1 ? `${index + 1}/${total}` : null;
  return (
    <span className={`inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white ${MATERIAL}`}>
      {icon && <Icon name={icon} className="size-3.5 shrink-0 text-gold" />}
      {label && <span className="truncate">{label}</span>}
      {label && pos && <span aria-hidden className="text-white/50">·</span>}
      {pos && (
        <span role="img" aria-label={`Look ${index + 1} of ${total}`} className="shrink-0 tabular-nums text-white/85">
          <span aria-hidden>{pos}</span>
        </span>
      )}
    </span>
  );
}
