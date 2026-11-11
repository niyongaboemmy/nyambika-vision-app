"use client";

import { useDrag } from "@/lib/drag";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAsk } from "@/components/circle-ask";
import { animate, MAT_BASE, MATERIAL, RailButton, SPRING } from "@/components/look-rail";
import { MorphRail } from "@/components/morph-sheet";
import { XrRail } from "@/components/xr-rail";
import { VideoRail } from "@/components/video-tryon";
import { LookPrice } from "@/components/region";
import { Icon, type IconName } from "@/components/studio";
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
        el.style.left = `${e.clientX - box.left}px`;
        el.style.top = `${e.clientY - box.top}px`;
        el.style.opacity = "1";
        const a = animate(el, [
          { transform: "translate(-50%,-50%) scale(.3) rotate(-12deg)", opacity: 0 },
          { transform: "translate(-50%,-50%) scale(1.15) rotate(0deg)", opacity: 1, offset: 0.35 },
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.6 },
          { transform: "translate(-50%,-120%) scale(.9)", opacity: 0 },
        ], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" });
        if (a) a.onfinish = () => (el.style.opacity = "0");
        else setTimeout(() => (el.style.opacity = "0"), 600);
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
      {...bind()}
      className="theme-media relative h-full w-full touch-pan-y overflow-hidden bg-black text-txt"
      style={{ transform: dx ? `translateX(${dx * 0.35}px)` : undefined, transition: dx ? "none" : `transform 420ms ${SPRING}` }}
    >
      {/* Media: full bleed, under the status bar and the home indicator. Parallax comes from --p on the section. */}
      <div className="absolute inset-0" onClick={tap}>
        {look.status === "DELIVERED" && look.image ? (
          <img
            src={look.image}
            alt={`${look.product.title} in ${look.variant.colourName}, AI preview on ${look.onTwin ? "your twin" : "an AI model"}`}
            className="absolute inset-0 size-full object-cover object-center will-change-transform"
            style={{ transform: "translate3d(0, calc(var(--p, 0) * -22%), 0) scale(1.04)" }}
            draggable={false}
          />
        ) : isRendering(look.status) && paused ? (
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_40%,rgba(224,112,63,.18),transparent_70%)]" />
        ) : isRendering(look.status) ? (
          <div className="absolute inset-0" role="status" aria-label={t("looks.generating")}>
            <div className="skeleton absolute inset-0 rounded-none" />
            <div className="absolute inset-x-0 h-0.5 animate-[scan_1.8s_ease-in-out_infinite] bg-sky/80 shadow-[0_0_24px_#38bdf8]" style={{ top: "40%" }} />
            <span className={`absolute left-1/2 top-[42%] inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold text-white ${MATERIAL}`}>
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

      {/* Top: back · page dots · chips (one line) */}
      <div className="absolute inset-x-0 top-0 z-10 px-3 pt-[max(env(safe-area-inset-top),12px)]">
        <div inert={!chrome} className={`grid grid-cols-[44px_1fr_44px] items-center ${chromeCls}`}>
          <Link href="/" aria-label="Back to Muse" className={`hit grid size-10 place-items-center rounded-full text-white transition-transform active:scale-90 ${MATERIAL}`}>
            <Icon name="back" className="size-5" />
          </Link>
          {total && total > 1 ? <PageDots index={index ?? 0} total={total} /> : <span />}
          <span />
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          {intentLabel && (
            <span className={`inline-flex min-w-0 max-w-[55%] items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white ${MATERIAL} ${chromeCls}`}>
              <Icon name={intentIcon(intentLabel)} className="size-3.5 shrink-0 text-gold" />
              <span className="truncate">{intentLabel.replace(/^For:\s*/, "")}</span>
            </span>
          )}
          {/* In-app AI label: stays visible even when the chrome is hidden; opens content credentials. */}
          <button
            type="button"
            onClick={() => setAbout(true)}
            aria-label={`AI preview · C2PA — ${look.onTwin ? t("looks.onTwin") : t("looks.onModel")}`}
            className={`hit inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white transition-transform active:scale-95 ${MATERIAL}`}
          >
            <Icon name="sparkle" className="size-3.5 text-gold" />
            AI preview{" "}
            <span className="text-white/70">· C2PA</span>
          </button>
        </div>
      </div>

      {/* Right edge hint: the Maker Space is one swipe left (grows into a peek while dragging). */}
      <div aria-hidden className={`pointer-events-none absolute right-0 top-[calc(max(env(safe-area-inset-top),12px)+118px)] z-10 flex items-center ${chromeCls}`}>
        <span
          className={`flex items-center gap-1.5 rounded-l-full py-2 pl-2.5 text-xs font-semibold text-white ${MAT_BASE} bg-black/45`}
          style={{ paddingRight: 6 + pull * 10, opacity: coach || pull > 0 ? 1 : 0.85, transition: dx ? "none" : `padding 300ms ${SPRING}` }}
        >
          <Icon name="back" className="size-3.5" />
          {(coach || pull > 0.15) && <span className="whitespace-nowrap pr-1">Maker Space</span>}
        </span>
      </div>

      {/* Right rail: glass circles, SF-like glyphs; names on the buttons, captions tiny or on long-press. */}
      <div
        inert={!chrome}
        className={`absolute right-3 z-10 flex flex-col items-center gap-3 bottom-[calc(max(env(safe-area-inset-bottom),12px)+150px)] [@media(min-height:860px)]:gap-3.5 ${chromeCls}`}
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

      {/* Coach mark (first view only): next look is a scroll away. */}
      {coach && total && total > 1 ? (
        <CoachChevron />
      ) : null}

      {/* Maker card + Buy: a glass sheet along the bottom. It always covers the bottom 12 %+ of the render
          (the gateway's baked AI tag sits there) — the in-app AI chip above stays the visible label. */}
      <div
        inert={!chrome}
        className={`absolute inset-x-0 bottom-0 z-10 ${chromeCls}`}
        style={enter}
      >
        <div className={`rounded-t-[28px] px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3.5 ${MAT_BASE} border-x-0 border-b-0 bg-black/55`} style={{ minHeight: "max(13dvh, 128px)" }}>
          <Link href={makerHref} className="flex min-h-11 min-w-0 items-center gap-3 rounded-2xl outline-offset-4">
            <Avatar name={look.maker.name} size={40} ring />
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
                className={`absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 transition-transform duration-300 active:scale-90 ${on ? "scale-110 border-gold" : "border-white/30"}`}
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

/** iOS page control: dots (≤ 9 looks) or a progress capsule; the active dot stretches with a spring. */
function PageDots({ index, total }: { index: number; total: number }) {
  const label = `Look ${index + 1} of ${total}`;
  if (total > 9) {
    return (
      <span role="img" aria-label={label} className={`mx-auto flex h-7 w-28 items-center rounded-full px-2.5 ${MATERIAL}`}>
        <span className="h-1 w-full overflow-hidden rounded-full bg-white/25">
          <span className="block h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${((index + 1) / total) * 100}%`, transitionTimingFunction: SPRING }} />
        </span>
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className={`mx-auto flex h-7 items-center gap-1.5 rounded-full px-2.5 ${MATERIAL}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-[width,background-color] duration-500 ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/40"}`}
          style={{ transitionTimingFunction: SPRING }}
        />
      ))}
    </span>
  );
}

/** First-view hint: a softly bouncing chevron above the card (static with reduced motion). */
function CoachChevron() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const a = animate(ref.current, [{ transform: "translateY(4px)", opacity: 0.55 }, { transform: "translateY(-6px)", opacity: 1 }, { transform: "translateY(4px)", opacity: 0.55 }], { duration: 1400, iterations: Infinity, easing: "ease-in-out" });
    return () => a?.cancel();
  }, []);
  return (
    <span aria-hidden className="pointer-events-none absolute bottom-[calc(max(13dvh,128px)+18px)] left-1/2 z-10 -translate-x-1/2">
      <span ref={ref} className={`grid size-9 place-items-center rounded-full text-white ${MATERIAL}`}>
        <Icon name="chevron" className="size-4 -rotate-90" />
      </span>
    </span>
  );
}
