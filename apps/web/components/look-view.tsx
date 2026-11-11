"use client";

import { useDrag } from "@use-gesture/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { CircleAsk } from "@/components/circle-ask";
import { MorphRail } from "@/components/morph-sheet";
import { XrRail } from "@/components/xr-rail";
import { Avatar, Sheet } from "@/components/ui";
import { rwf } from "@/lib/api";
import { isRendering, TYPE_ICON, type Look } from "@/lib/looks";
import { useSession } from "@/lib/session";

interface Props {
  look: Look;
  index?: number;
  total?: number;
  intentLabel?: string | null;
  onSave: () => void;
  onVariant: (variantId: string) => void;
  onHold?: () => void;
  children?: ReactNode;
}

/** One full-screen look rendered on the shopper's twin (prototype v2 · 06-looks-on-you). */
export function LookView({ look, index, total, intentLabel, onSave, onVariant, onHold, children }: Props) {
  const { t } = useSession();
  const router = useRouter();
  const [ring, setRing] = useState(false);
  const [about, setAbout] = useState(false);
  const [heart, setHeart] = useState(false);
  const [ask, setAsk] = useState(false);
  const lastTap = useRef(0);

  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!look.saved) onSave();
      setHeart(true);
      setTimeout(() => setHeart(false), 700);
    }
    lastTap.current = now;
  }

  // Swipe left on the maker card → Maker Space.
  const bindCard = useDrag(({ last, movement: [mx], tap: isTap }) => {
    if (isTap) return;
    if (last && mx < -60) router.push(`/m/${look.maker.handle}`);
  }, { axis: "x", filterTaps: true });

  const share = async () => {
    const url = `${window.location.origin}/m/${look.maker.handle}`;
    const text = `Which one? "${look.product.title}" by ${look.maker.name} · ${rwf(look.product.priceRwf)} (AI preview) ${url}`;
    if (navigator.share) await navigator.share({ title: look.product.title, text, url }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,rgba(224,112,63,.28),transparent_70%),radial-gradient(50%_40%_at_90%_90%,rgba(139,92,246,.3),transparent_70%)]" />

      {/* Look image */}
      <div className="absolute inset-x-0 top-[96px] bottom-[150px] flex items-center justify-center" onClick={tap}>
        {look.status === "DELIVERED" && look.image ? (
          <img src={look.image} alt={`${look.product.title} in ${look.variant.colourName}, AI preview on ${look.onTwin ? "your twin" : "an AI model"}`} className="h-full w-full animate-rise object-contain" draggable={false} />
        ) : isRendering(look.status) ? (
          <div className="flex flex-col items-center gap-4" role="status">
            <div className="relative h-[60vh] max-h-[460px] w-[54vw] max-w-[250px] overflow-hidden rounded-[40px] skeleton">
              <div className="absolute inset-x-0 h-1 animate-[scan_1.6s_ease-in-out_infinite] bg-sky shadow-[0_0_18px_#38bdf8]" style={{ top: "40%" }} />
            </div>
            <p className="text-sm text-mut">{t("looks.generating")}</p>
          </div>
        ) : (
          <p className="max-w-[260px] text-center text-sm text-mut">{t("looks.withheld")}</p>
        )}
        {heart && <span className="pointer-events-none absolute text-7xl text-white drop-shadow-[0_0_20px_rgba(224,112,63,.9)] animate-rise">♥</span>}
      </div>

      {/* Top chips */}
      <div className="absolute inset-x-4 top-[max(env(safe-area-inset-top),14px)] z-10 flex items-start justify-between gap-2">
        <div className="flex flex-col items-start gap-1.5">
          <Link href="/" aria-label="Back to Muse" className="glass grid size-10 place-items-center rounded-full">←</Link>
          {intentLabel && <span className="glass rounded-2xl px-3 py-1.5 text-sm font-semibold">💍 {intentLabel}</span>}
          <button onClick={() => setAbout(true)} className="rounded-xl border border-white/20 bg-black/50 px-2.5 py-1 text-xs font-semibold">
            ✨ {look.onTwin ? t("looks.onTwin") : t("looks.onModel")}
          </button>
        </div>
        {total ? <span className="glass rounded-2xl px-3 py-1.5 text-sm font-semibold">Look {(index ?? 0) + 1} / {total}</span> : null}
      </div>

      {/* Right rail */}
      <div className="absolute right-3 bottom-[170px] z-10 flex flex-col items-center gap-4">
        <RailButton label={look.saved ? t("looks.saved") : t("looks.save")} onClick={onSave} active={look.saved}>♥</RailButton>
        {look.variants.length > 1 && <RailButton label={t("looks.colours")} onClick={() => setRing(true)}>🎨</RailButton>}
        <MorphRail look={look} />
        <XrRail look={look} />
        <RailButton label="Ask" onClick={() => setAsk(true)}>👥</RailButton>
        <RailButton label={t("looks.share")} onClick={share}>↗</RailButton>
      </div>

      {/* Maker card */}
      <div {...bindCard()} className="absolute inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-10 touch-pan-y">
        <div className="glass rounded-3xl p-4">
          <Link href={`/m/${look.maker.handle}`} className="flex items-center gap-3">
            <Avatar name={look.maker.name} size={48} ring />
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-black">{look.maker.name} {look.maker.verified && <span className="text-mint">✓</span>}</p>
              <p className="truncate text-sm text-txt/80">{TYPE_ICON[look.maker.memberType]} · {look.maker.sector}{look.maker.madeBy.length ? ` · by ${look.maker.madeBy.join(", ")}` : ""}</p>
            </div>
          </Link>
          <p className="mt-2 font-display text-lg font-black">{rwf(look.product.priceRwf)} · <span className="font-sans text-base font-semibold">{look.product.madeToOrder ? "made to measure" : look.product.title}</span></p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-mut">← swipe for Maker Space · ✋ hold to buy</p>
            {children}
          </div>
        </div>
      </div>

      {/* Colour ring: snaps to the maker's real variants (R1) */}
      <Sheet open={ring} onClose={() => setRing(false)}>
        <p className="mb-4 text-center font-display text-lg font-black">{t("looks.colours")}</p>
        <div className="relative mx-auto size-64">
          <div className="orb absolute inset-8 rounded-full opacity-30 blur-xl" />
          {look.variants.map((v, i) => {
            const a = (i / look.variants.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <button
                key={v.id}
                aria-label={v.colourName}
                aria-pressed={v.id === look.variant.id}
                onClick={() => {
                  onVariant(v.id);
                  setRing(false);
                }}
                className={`absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 transition ${v.id === look.variant.id ? "scale-110 border-gold" : "border-white/30"}`}
                style={{ left: `${50 + Math.cos(a) * 38}%`, top: `${50 + Math.sin(a) * 38}%`, background: v.colourHex }}
              />
            );
          })}
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-center text-sm font-semibold">{look.variant.colourName}</p>
        </div>
        <p className="mt-3 text-center text-xs text-mut">Colours this maker actually sews. Free recolour arrives with tailor custom orders.</p>
      </Sheet>

      <CircleAsk look={look} open={ask} onClose={() => setAsk(false)} intentLabel={intentLabel} />

      {/* Content credentials */}
      <Sheet open={about} onClose={() => setAbout(false)}>
        <h3 className="font-display text-xl font-black">About this image</h3>
        <ul className="mt-3 space-y-2 text-sm text-txt/90">
          <li>✨ AI-generated preview on {look.onTwin ? "your private twin" : "an AI model (create your twin to see it on you)"}. Real fit and drape can differ.</li>
          <li>🛡️ Passed our quality and fairness check (face and skin tone unchanged, garment faithful).</li>
          {look.c2pa && <li>🔏 Content Credentials (C2PA) signed · {look.c2pa.model} · #{look.c2pa.sha256}</li>}
          <li>🔒 Only you can see this image. Makers never receive your twin or your looks.</li>
        </ul>
      </Sheet>
    </div>
  );
}

function RailButton({ children, label, onClick, active }: { children: ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 text-xs font-semibold">
      <span className={`glass grid size-12 place-items-center rounded-full text-xl ${active ? "bg-terra/70 text-white" : ""}`}>{children}</span>
      {label}
    </button>
  );
}
