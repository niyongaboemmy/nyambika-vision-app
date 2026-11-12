"use client";

import { LOCALES, type Locale } from "@nyambika/i18n";
import { ThemeToggle } from "@/components/kit";
import { Icon, type IconName } from "@/components/icons";
import { Group, GroupRow } from "@/components/ios";
import { Chip, Sheet } from "@/components/ui";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français", sw: "Kiswahili (beta)" };

/** Edge menu replacing the tab bar (CR-01): everything else is one tap away from the Muse. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, locale, setLocale, signOut, t } = useSession();
  const manages = me?.roles.some((r) => r.page);
  type Item = { href: string; icon: IconName; label: string; tone: "terra" | "violet" | "mint" | "sky" | "gold" | "red" | "stone" };
  // iOS grouped lists: you · shopping · more. Rows are links; the sheet unmounts with the page on navigation.
  const groups: { header: string; items: Item[] }[] = [
    {
      header: "You",
      items: [
        { href: "/mirror", icon: "mirror", label: "My twin", tone: "violet" },
        { href: "/mirror/3d", icon: "cube", label: t("twin3d.title"), tone: "violet" },
        { href: "/measurements", icon: "ruler", label: t("tailor.measurements"), tone: "sky" },
        { href: "/wardrobe", icon: "hanger", label: "Wardrobe", tone: "gold" },
        { href: "/saved", icon: "heart", label: "Saved looks", tone: "red" },
      ],
    },
    {
      header: "Shopping",
      items: [
        { href: "/bag", icon: "bag", label: t("bag.title"), tone: "terra" },
        { href: "/orders", icon: "box", label: t("orders.title"), tone: "terra" },
        { href: "/custom", icon: "scissors", label: t("tailor.myOrders"), tone: "terra" },
        { href: "/makers", icon: "store", label: "Browse makers", tone: "mint" },
      ],
    },
    {
      header: "More",
      items: [
        { href: "/trust", icon: "lock", label: t("trust.title"), tone: "stone" },
        { href: "/studio", icon: "needle", label: manages ? t("studio.title") : "Sell on Nyambika", tone: "gold" },
        ...(me?.isHost ? [{ href: "/admin", icon: "settings" as IconName, label: "Host admin", tone: "stone" as const }] : []),
      ],
    },
  ];
  return (
    <Sheet open={open} onClose={onClose} detent="large">
      <p className="mb-3 truncate px-4 text-sm font-semibold text-mut">{me?.name ?? me?.phone}</p>
      <nav aria-label="Menu" className="space-y-5">
        {groups.map((g) => (
          <Group key={g.header} header={g.header}>
            {g.items.map((i) => <GroupRow key={i.href} href={i.href} icon={i.icon} tone={i.tone} title={i.label} />)}
          </Group>
        ))}
      </nav>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 px-4">
        <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-mut">Display</span>
        <ThemeToggle />
      </div>
      <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 py-0.5" role="group" aria-label="Language">
        {LOCALES.map((l) => <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>)}
      </div>
      <button onClick={() => { void signOut(); onClose(); }} className="press mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-mut hover:text-txt">
        <Icon name="logout" className="size-4" /> Sign out
      </button>
    </Sheet>
  );
}
