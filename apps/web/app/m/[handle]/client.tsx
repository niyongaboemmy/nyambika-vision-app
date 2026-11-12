"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { waLink, type MakerSpace } from "@/lib/maker";
import type { Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import { track, trackOnce } from "@/lib/track";
import type { ShowCard as ShowCardData } from "@/lib/vr";
import { Icon } from "@/components/icons";

// The pieces grid (and the product sheet behind it) loads on the first tap (JS budget).
const PiecesSheet = dynamic(() => import("./pieces-sheet").then((m) => m.PiecesSheet), { ssr: false });

/**
 * The hero's "N pieces · 3D" chip: the one way to the full list (no second collection section on the page).
 * Opens an image-first grid sheet; a piece opens its product sheet.
 */
export function AllPieces({ maker, commerce, in3d }: { maker: MakerSpace; commerce?: Commerce | null; in3d: string[] }) {
  const { t } = useSession();
  const [open, setOpen] = useState(false);
  const n = maker.products.length;
  // E30: share links carry ?src=… (WhatsApp status, QR card, broadcast…) → traffic sources in Insights.
  useEffect(() => trackOnce(`maker:${maker.id}`, "maker_space_viewed", { pageId: maker.id, source: new URLSearchParams(window.location.search).get("src")?.slice(0, 24) ?? undefined }), [maker.id]);
  if (!n) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hit press inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/15 pl-2.5 pr-2 text-[13px] font-semibold text-white backdrop-blur"
      >
        <Icon name="grid" className="size-3.5" />
        <span className="tabular-nums">{n}</span> {in3d.length ? t("maker.pieces3d") : "pieces"}
        <span className="sr-only"> · see all</span>
        <Icon name="chevron" className="size-3.5 opacity-70" />
      </button>
      {open && <PiecesSheet maker={maker} commerce={commerce} in3d={in3d} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Follow / Chat sit in the identity block. Once the hero scrolls away, a compact floating bar keeps Enter showroom
 * as the main action (with Follow and Chat as icons); the page pads its bottom so the bar never covers content.
 */
export function MakerActions({ maker, showroom }: { maker: MakerSpace; showroom: boolean }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(maker.following);
  const [bar, setBar] = useState(false);
  async function follow() {
    if (!me) return router.push(`/signin?next=/m/${maker.handle}`);
    const r = await api<{ following: boolean }>(`/pages/${maker.id}/follow`, { method: "POST" });
    setFollowing(r.following);
    navigator.vibrate?.(8);
  }
  useEffect(() => {
    const cta = document.getElementById("hero-cta");
    if (!cta) return;
    const io = new IntersectionObserver(([e]) => setBar(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(cta);
    return () => io.disconnect();
  }, []);
  const chat = waLink(maker.whatsapp, `Muraho ${maker.name}!`);
  const onChat = () => track("maker_contacted", { pageId: maker.id, channel: "whatsapp" });
  const followLabel = following ? t("maker.following") : t("maker.follow");

  return (
    <>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void follow()} aria-pressed={following} className={`press inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-4 text-[15px] font-semibold ${following ? "bg-fill text-fg" : "bg-fg text-surface"}`}>
          <Icon name={following ? "check" : "plus"} className="size-4" /> {followLabel}
        </button>
        <a href={chat} target="_blank" rel="noreferrer" onClick={onChat} className="press inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl bg-fill px-4 text-[15px] font-semibold text-fg">
          <Icon name="chat" className="size-4" /> {t("maker.chat")}
        </a>
      </div>

      <div
        data-maker-bar
        inert={!bar}
        aria-hidden={!bar}
        className={`fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] px-4 pb-[max(env(safe-area-inset-bottom),14px)] transition duration-300 lg:max-w-[440px] ${bar ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"}`}
      >
        <div className="material flex items-center gap-2 rounded-[24px] p-2 shadow-e3">
          {showroom ? (
            <Link href={`/m/${maker.handle}/showroom`} className="press grad-cta inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[18px] px-4 font-bold">
              <Icon name="cube" className="size-5" /> {t("maker.enterShowroom")}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate px-2 font-display font-black">{maker.name}</span>
          )}
          <button type="button" onClick={() => void follow()} aria-pressed={following} aria-label={`${followLabel} ${maker.name}`} title={followLabel} className={`press grid size-12 shrink-0 place-items-center rounded-[18px] ${following ? "bg-fill text-fg" : "bg-fg text-surface"}`}>
            <Icon name={following ? "check" : "plus"} className="size-5" />
          </button>
          <a href={chat} target="_blank" rel="noreferrer" onClick={onChat} aria-label={`${t("maker.chat")} with ${maker.name} on WhatsApp`} title={t("maker.chat")} className="press grid size-12 shrink-0 place-items-center rounded-[18px] bg-fill text-fg">
            <Icon name="chat" className="size-5" />
          </a>
        </div>
      </div>
    </>
  );
}

/** Upcoming or live fashion show: countdown, RSVP in place, and a link to the show. */
export function ShowCard({ show, handle }: { show: ShowCardData; handle: string }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [going, setGoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = `/m/${handle}/shows/${show.id}`;
  const isLive = show.phase === "LIVE";
  const start = new Date(show.startsAt).getTime();

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!me || isLive) return;
    let live = true;
    void api<{ going: boolean }>(`/vr/public/shows/${show.id}`).then((s) => live && setGoing(Boolean(s.going))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me, show.id, isLive]);

  async function rsvp() {
    if (!me) return router.push(`/signin?next=${encodeURIComponent(`/m/${handle}`)}`);
    setBusy(true);
    try {
      const r = await api<{ going: boolean }>(`/vr/shows/${show.id}/rsvp`, { method: "POST", json: { going: !going } });
      setGoing(r.going);
      navigator.vibrate?.(12);
    } finally {
      setBusy(false);
    }
  }

  const left = now == null ? null : Math.max(0, start - now);
  const parts = left == null ? null : [Math.floor(left / 86400000), Math.floor((left % 86400000) / 3600000), Math.floor((left % 3600000) / 60000), Math.floor((left % 60000) / 1000)];
  const when = new Date(show.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });

  return (
    <section aria-label={`${t("vr.fashionShow")}: ${show.title}`} className="mt-5 px-4 lg:px-0">
      <div className="theme-media relative flex items-center gap-3 overflow-hidden rounded-[22px] bg-ink-2 p-2.5 text-txt">
        <Link href={href} className="press flex min-w-0 flex-1 items-center gap-3">
          {show.cover ? <img src={show.cover} alt="" loading="lazy" decoding="async" className="size-12 shrink-0 rounded-[14px] object-cover" /> : <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-white/10"><Icon name="play" className="size-6" /></span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em]">
              {isLive ? <span className="inline-flex items-center gap-1 rounded-full bg-terra px-2 py-0.5 text-white"><span className="size-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" />{t("vr.live")}</span> : <span className="text-gold">{t("vr.fashionShow")}</span>}
            </span>
            <span className="mt-0.5 block truncate font-bold">{show.title}</span>
            {isLive ? (
              <span className="block truncate text-xs text-mut">{t("vr.watchNow")}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-mut">
                <span className="truncate">{when}</span>
                {parts && (
                  <span role="timer" className="shrink-0 font-semibold tabular-nums text-txt" aria-label={`Starts in ${parts[0]} days ${parts[1]} hours ${parts[2]} minutes`} suppressHydrationWarning>
                    · {parts[0] > 0 ? `${parts[0]}d ` : ""}{String(parts[1]).padStart(2, "0")}:{String(parts[2]).padStart(2, "0")}:{String(parts[3]).padStart(2, "0")}
                  </span>
                )}
              </span>
            )}
          </span>
        </Link>
        {isLive ? (
          <Link href={href} className="press grad-cta inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl px-4 text-sm font-bold"><Icon name="play" className="size-4" /> Watch</Link>
        ) : (
          <button type="button" onClick={() => void rsvp()} disabled={busy} aria-pressed={going} className={`press inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl px-4 text-sm font-bold disabled:opacity-60 ${going ? "bg-white/12 text-txt" : "bg-white text-[#0b0a0f]"}`}>
            <Icon name={going ? "check" : "bell"} className="size-4" /> {going ? t("maker.going") : t("maker.rsvp")}
          </button>
        )}
      </div>
    </section>
  );
}
