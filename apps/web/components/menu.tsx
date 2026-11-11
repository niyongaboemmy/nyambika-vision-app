"use client";

import { LOCALES, type Locale } from "@nyambika/i18n";
import Link from "next/link";
import { ThemeToggle } from "@/components/kit";
import { Icon, type IconName } from "@/components/studio";
import { Chip, Sheet } from "@/components/ui";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français", sw: "Kiswahili (beta)" };

/** Edge menu replacing the tab bar (CR-01): everything else is one tap away from the Muse. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, locale, setLocale, signOut, t } = useSession();
  const manages = me?.roles.some((r) => r.page);
  const items: { href: string; icon: IconName; label: string }[] = [
    { href: "/mirror", icon: "mirror", label: "My twin" },
    { href: "/mirror/3d", icon: "cube", label: t("twin3d.title") },
    { href: "/saved", icon: "heart", label: "Saved looks" },
    { href: "/wardrobe", icon: "hanger", label: "Wardrobe" },
    { href: "/bag", icon: "bag", label: t("bag.title") },
    { href: "/orders", icon: "box", label: t("orders.title") },
    { href: "/custom", icon: "scissors", label: t("tailor.myOrders") },
    { href: "/measurements", icon: "ruler", label: t("tailor.measurements") },
    { href: "/makers", icon: "store", label: "Browse makers" },
    { href: "/trust", icon: "lock", label: t("trust.title") },
    ...(manages ? [{ href: "/studio", icon: "needle" as IconName, label: t("studio.title") }] : [{ href: "/studio", icon: "needle" as IconName, label: "Sell on Nyambika" }]),
    ...(me?.isHost ? [{ href: "/admin", icon: "settings" as IconName, label: "Host admin" }] : []),
  ];
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="mb-3 truncate text-sm font-semibold text-mut">{me?.name ?? me?.phone}</p>
      <nav aria-label="Menu" className="grid grid-cols-2 gap-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} onClick={onClose} className="glass press flex min-h-12 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[14px] font-semibold leading-tight">
            <Icon name={i.icon} className="size-[18px] shrink-0 text-gold" />
            <span className="min-w-0">{i.label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-[.14em] text-mut">Display</span>
        <ThemeToggle />
      </div>
      <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5" role="group" aria-label="Language">
        {LOCALES.map((l) => <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>)}
      </div>
      <button onClick={() => { void signOut(); onClose(); }} className="press mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-mut hover:text-txt">
        <Icon name="logout" className="size-4" /> Sign out
      </button>
    </Sheet>
  );
}
