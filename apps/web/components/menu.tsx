"use client";

import { LOCALES, type Locale } from "@nyambika/i18n";
import Link from "next/link";
import { Chip, Sheet } from "@/components/ui";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français" };

/** Edge menu replacing the tab bar (CR-01): everything else is one tap away from the Muse. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, locale, setLocale, signOut, t } = useSession();
  const manages = me?.roles.some((r) => r.page);
  const items = [
    { href: "/mirror", icon: "🪞", label: "My twin" },
    { href: "/saved", icon: "♥", label: "Saved looks" },
    { href: "/wardrobe", icon: "👗", label: "Wardrobe" },
    { href: "/orders", icon: "📦", label: t("orders.title") },
    { href: "/makers", icon: "🏪", label: "Browse makers" },
    { href: "/trust", icon: "🔒", label: t("trust.title") },
    ...(manages ? [{ href: "/studio", icon: "🧵", label: t("studio.title") }] : [{ href: "/studio", icon: "🧵", label: "Sell on Nyambika" }]),
    ...(me?.isHost ? [{ href: "/admin", icon: "🛠️", label: "Host admin" }] : []),
  ];
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="mb-3 text-sm text-mut">{me?.name ?? me?.phone}</p>
      <nav className="grid grid-cols-2 gap-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} onClick={onClose} className="glass flex items-center gap-2 rounded-2xl px-3 py-3 font-semibold">
            <span>{i.icon}</span>
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="mt-4 flex flex-wrap gap-2">
        {LOCALES.map((l) => <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>)}
      </div>
      <button onClick={() => { void signOut(); onClose(); }} className="mt-4 w-full text-center text-sm text-mut underline">Sign out</button>
    </Sheet>
  );
}
