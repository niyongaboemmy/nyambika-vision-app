"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/kit";
import { Badge, Icon, isNavActive, Monogram, SButton, StudioSheet, studioNav, type IconName, Skeleton } from "@/components/studio";
import { useSession } from "@/lib/session";

// Lazy (below the fold / on demand): keeps this route's first-load JS small.
const QrCode = dynamic(() => import("@/components/qr").then((m) => m.QrCode), { ssr: false, loading: () => <Skeleton className="aspect-square w-full" /> });

export interface ShellPage {
  id: string;
  name: string;
  handle: string;
  memberType: string;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "Live",
  PENDING_VERIFICATION: "In review",
  PAUSED: "Paused",
  SUSPENDED: "Suspended",
  DRAFT: "Draft",
};

export const pageStatusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();

export function Brand({ label }: { label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="orb size-8 shrink-0 rounded-full shadow-[0_6px_18px_-4px_rgba(224,112,63,.6)]" />
      <span className="truncate font-display text-lg font-black tracking-tight text-cocoa">{label}</span>
    </span>
  );
}

/** Public Maker Space URL as shoppers see it. */
export function makerUrl(handle: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://nyambika.rw";
  return `${origin}/m/${handle}`;
}

/** "Share my page": QR code + copy + native share (Web Share API when the phone has it). */
export function ShareSheet({ open, onClose, page }: { open: boolean; onClose: () => void; page: ShellPage }) {
  const url = makerUrl(page.handle);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <StudioSheet open={open} onClose={onClose} title="Share my page">
      <div className="space-y-4">
        <div className="st-hero rounded-[26px] p-5">
          <div className="keep-white mx-auto w-full max-w-[220px] rounded-3xl bg-white p-3 shadow-[0_20px_40px_-20px_rgba(29,24,20,.45)]">
            <QrCode value={url} label={`QR code for ${url}`} className="block aspect-square w-full" />
          </div>
          <p className="mt-4 text-center font-display text-lg font-black text-cocoa">{page.name}</p>
          <p className="break-all text-center text-sm font-semibold text-cocoa-2">{url.replace(/^https?:\/\//, "")}</p>
        </div>
        <ul aria-label="How shoppers use it" className="flex flex-wrap gap-1.5 text-xs font-bold text-cocoa-2"><li className="rounded-full bg-paper-2 px-2.5 py-1">Print it for your stall</li><li className="rounded-full bg-paper-2 px-2.5 py-1">They try it on their twin</li><li className="rounded-full bg-paper-2 px-2.5 py-1">Paid directly to you</li></ul>
        <div className="grid grid-cols-2 gap-2">
          <SButton
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                navigator.vibrate?.(10);
                setTimeout(() => setCopied(false), 1800);
              } catch {}
            }}
          >
            <Icon name={copied ? "check" : "copy"} className="size-4" />
            <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
          </SButton>
          {canShare ? (
            <SButton onClick={() => navigator.share({ title: page.name, text: `${page.name} on Nyambika`, url }).catch(() => {})}>
              <Icon name="share" className="size-4" /> Share
            </SButton>
          ) : (
            <a href={`https://wa.me/?text=${encodeURIComponent(`${page.name} on Nyambika: ${url}`)}`} target="_blank" rel="noreferrer" className="st-press st-cta inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold text-white">
              <Icon name="share" className="size-4" /> WhatsApp
            </a>
          )}
        </div>
      </div>
    </StudioSheet>
  );
}

function PageSwitcherList({ pages, current, onPick }: { pages: ShellPage[]; current: string; onPick?: () => void }) {
  return (
    <ul className="space-y-2">
      {pages.map((p) => (
        <li key={p.id}>
          <Link
            href={`/studio/${p.id}`}
            onClick={onPick}
            aria-current={p.id === current ? "page" : undefined}
            className={`st-press flex items-center gap-3 rounded-2xl p-3 ring-1 ring-inset ${p.id === current ? "bg-white ring-cocoa" : "bg-white/60 hover:bg-white ring-transparent"}`}
          >
            <Monogram name={p.name} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-cocoa">{p.name}</span>
              <span className="block truncate text-xs text-cocoa-2">/{p.handle} · {p.memberType.toLowerCase()}</span>
            </span>
            {p.id === current && <Icon name="check" className="size-5 text-mint-ink" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SheetLink({ href, icon, label, hint, onClick, external }: { href: string; icon: IconName; label: string; hint?: string; onClick?: () => void; external?: boolean }) {
  const cls = "st-press flex min-h-14 items-center gap-3 rounded-2xl bg-white px-3.5";
  const body = (
    <>
      <span className="grid size-9 place-items-center rounded-xl bg-paper-2 text-cocoa"><Icon name={icon} className="size-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-cocoa">{label}</span>
        {hint && <span className="block truncate text-xs text-cocoa-2">{hint}</span>}
      </span>
      <Icon name="chevron" className="size-4 text-cocoa-3" />
    </>
  );
  return external ? (
    <a href={href} className={cls} onClick={onClick}>{body}</a>
  ) : (
    <Link href={href} className={cls} onClick={onClick}>{body}</Link>
  );
}

/**
 * Member Page Manager shell (FR-PAGE-11): floating bottom dock on phones, slim sidebar from 1024px,
 * sticky contextual header with page status and "View Maker Space".
 */
export function StudioShell({ page, pages, member, badges = {}, children }: { page: ShellPage; pages: ShellPage[]; member: boolean; badges?: Record<string, number>; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { t, signOut } = useSession();
  const [more, setMore] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Compact nav title: the screen's large h1 (SectionTitle as="h1") once it has scrolled under the sticky header.
  const [section, setSection] = useState<string | null>(null);
  useEffect(() => {
    setSection(null);
    let io: IntersectionObserver | null = null;
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>("main h1");
      if (!h || typeof IntersectionObserver === "undefined") return;
      io = new IntersectionObserver(([e]) => setSection(e.isIntersecting || e.boundingClientRect.top > 0 ? null : (h.textContent ?? "").trim() || null), { rootMargin: "-72px 0px 0px 0px" });
      io.observe(h);
    }, 400);
    return () => {
      clearTimeout(t);
      io?.disconnect();
    };
  }, [path]);
  const isCoop = page.memberType === "COOPERATIVE";
  const nav = studioNav(page.id, isCoop, member, page.memberType === "TAILOR");
  const dock = nav.filter((n) => !n.secondary);
  const multi = pages.length > 1;
  const close = () => setMore(false);

  return (
    <div className="lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col gap-5 border-r border-hairline bg-white/55 px-4 py-5 backdrop-blur lg:flex">
        <Link href="/studio" className="rounded-xl px-2" aria-label={`${t("studio.title")}: all my pages`}>
          <Brand label={t("studio.title")} />
        </Link>
        <button
          type="button"
          onClick={() => multi && setSwitching(true)}
          aria-label={multi ? `Switch page (current: ${page.name})` : undefined}
          className={`st-press flex items-center gap-3 rounded-2xl bg-white p-2.5 text-left ${multi ? "" : "cursor-default"}`}
        >
          <Monogram name={page.name} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold text-cocoa">{page.name}</span>
            <span className="block truncate text-xs text-cocoa-2">/{page.handle}</span>
          </span>
          {multi && <Icon name="swap" className="size-4 text-cocoa-2" />}
        </button>
        <nav aria-label="Studio" className="flex flex-col gap-1">
          {nav.map((n) => {
            const active = isNavActive(path, n.href, page.id);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`st-press flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-bold ${active ? "bg-cocoa text-white shadow-[0_8px_20px_-10px_rgba(29,24,20,.6)]" : "text-cocoa-2 hover:bg-white hover:text-cocoa"}`}
              >
                <Icon name={n.icon} className="size-5" />
                <span className="flex-1">{n.label}</span>
                {badges[n.label] ? <span aria-hidden className={`rounded-full px-2 py-0.5 text-[11px] ${active ? "bg-white text-cocoa" : "bg-terra-ink text-white"}`}>{badges[n.label]}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1.5">
          <button type="button" onClick={() => setSharing(true)} className="st-press flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-bold text-cocoa-2 hover:bg-white hover:text-cocoa">
            <Icon name="qr" className="size-5" /> Share my page
          </button>
          <a href="/" className="st-press flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-bold text-cocoa-2 hover:bg-white hover:text-cocoa">
            <Icon name="eye" className="size-5" /> Shopper view
          </a>
          <ThemeToggle compact className="mt-2 flex w-full [&>button]:flex-1" />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Sticky contextual header */}
        <header className="material sticky top-0 z-30 border-b">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-2.5 pt-[max(env(safe-area-inset-top),10px)] lg:px-8 lg:py-3.5">
            <span className="shrink-0 lg:hidden">
              <Monogram name={page.name} size={38} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate font-display text-[19px] font-black tracking-tight text-cocoa lg:text-2xl">{page.name}</h1>
                {multi && (
                  <button type="button" onClick={() => setSwitching(true)} aria-label="Switch page" className="hit st-press -ml-1 grid size-7 shrink-0 place-items-center rounded-full text-cocoa-2 hover:bg-paper-2 lg:hidden">
                    <Icon name="chevron" className="size-4 rotate-90" />
                  </button>
                )}
              </div>
              {/* iOS large title → compact: once the screen's own h1 scrolls under the bar, it replaces the URL line. */}
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <Badge value={page.status} label={pageStatusLabel(page.status)} />
                {section ? (
                  <span key={section} aria-hidden className="animate-fade truncate text-[13px] font-semibold text-cocoa">{section}</span>
                ) : (
                  <span className="truncate text-xs font-semibold text-cocoa-2">nyambika.rw/{page.handle}</span>
                )}
              </div>
            </div>
            <a
              href={`/m/${page.handle}`}
              aria-label="View Maker Space"
              className="st-press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-cocoa"
            >
              <Icon name="store" className="size-5" />
              <span className="hidden sm:inline">View Maker Space</span>
            </a>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+124px)] pt-5 lg:px-8 lg:pb-14 lg:pt-7">{children}</main>
      </div>

      {/* Phone: floating bottom dock */}
      <nav aria-label="Studio" className="st-dock fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-40 mx-auto flex max-w-md items-stretch gap-1 rounded-[28px] p-1.5 lg:hidden">
        {dock.map((n) => {
          const active = isNavActive(path, n.href, page.id);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              aria-label={n.short && n.short !== n.label ? n.label : undefined}
              onClick={() => navigator.vibrate?.(6)}
              className={`st-press relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-extrabold ${active ? "bg-cocoa text-white" : "text-cocoa-2 hover:text-cocoa"}`}
            >
              <Icon name={n.icon} className="size-[22px]" />
              <span className="max-w-full truncate px-1">{n.short ?? n.label}</span>
              {badges[n.label] ? (
                <span aria-hidden className="absolute right-[calc(50%-20px)] top-1.5 grid min-w-[18px] place-items-center rounded-full bg-terra-ink px-1 text-[10px] font-black leading-[18px] text-white ring-2 ring-white">
                  {badges[n.label]}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          className="st-press flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-extrabold text-cocoa-2 hover:text-cocoa"
        >
          <Icon name="more" className="size-[22px]" />
          <span>More</span>
        </button>
      </nav>

      <StudioSheet open={more} onClose={close} title="More">
        <div className="space-y-2">
          {nav.filter((n) => n.secondary).map((n) => (
            <SheetLink key={n.href} href={n.href} icon={n.icon} label={n.label} hint={n.hint} onClick={close} />
          ))}
          <button type="button" onClick={() => { close(); setSharing(true); }} className="st-press flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white px-3.5 text-left">
            <span className="grid size-9 place-items-center rounded-xl bg-paper-2 text-cocoa"><Icon name="qr" className="size-[18px]" /></span>
            <span className="flex-1"><span className="block font-bold text-cocoa">Share my page</span><span className="block text-xs text-cocoa-2">QR code and link</span></span>
          </button>
          {multi && (
            <button type="button" onClick={() => { close(); setSwitching(true); }} className="st-press flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white px-3.5 text-left">
              <span className="grid size-9 place-items-center rounded-xl bg-paper-2 text-cocoa"><Icon name="swap" className="size-[18px]" /></span>
              <span className="flex-1"><span className="block font-bold text-cocoa">Switch page</span><span className="block text-xs text-cocoa-2">{pages.length} pages</span></span>
            </button>
          )}
          <SheetLink href={`/m/${page.handle}`} icon="store" label="Open my Maker Space" hint="What shoppers see" external onClick={close} />
          <SheetLink href="/studio" icon="grid" label="All my pages" onClick={close} />
          <SheetLink href="/" icon="eye" label="Shopper view" external onClick={close} />
          <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white px-3.5">
            <span className="font-bold text-cocoa">Display</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={async () => {
              close();
              await signOut();
              router.replace("/");
            }}
            className="st-press flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-red-800 hover:bg-red-50"
          >
            <Icon name="logout" className="size-4" /> Sign out
          </button>
        </div>
      </StudioSheet>

      <StudioSheet open={switching} onClose={() => setSwitching(false)} title="Your pages">
        <PageSwitcherList pages={pages} current={page.id} onPick={() => setSwitching(false)} />
      </StudioSheet>
      <ShareSheet open={sharing} onClose={() => setSharing(false)} page={page} />
    </div>
  );
}
