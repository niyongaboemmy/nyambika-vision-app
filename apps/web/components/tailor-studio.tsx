"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/studio";

/**
 * Tailor desk sub-navigation: one pill row at every width. The studio shell already owns the
 * floating dock on phones, so this section must not add a second one.
 */
export function DeskNav({ pageId }: { pageId: string }) {
  const path = usePathname();
  const base = `/studio/${pageId}/tailor`;
  const items: { href: string; label: string; icon: IconName }[] = [
    { href: base, label: "Orders", icon: "scissors" },
    { href: `${base}/slots`, label: "Fittings", icon: "clock" },
    { href: `${base}/services`, label: "Services", icon: "list" },
  ];
  const active = (h: string) => (h === base ? path === base || /\/tailor\/(?!slots|services)[^/]+$/.test(path) : path.startsWith(h));
  return (
    <nav aria-label="Tailor desk" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(i.href) ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${active(i.href) ? "bg-stone-900 text-white" : "border border-stone-300 bg-white text-stone-700"}`}
        >
          <Icon name={i.icon} className="size-4" />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

const TONE: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-900 ring-amber-300",
  QUOTED: "bg-sky-100 text-sky-900 ring-sky-300",
  DEPOSIT_PENDING: "bg-sky-100 text-sky-900 ring-sky-300",
  DEPOSIT_PAID: "bg-violet-100 text-violet-900 ring-violet-300",
  CUTTING: "bg-violet-100 text-violet-900 ring-violet-300",
  SEWING: "bg-violet-100 text-violet-900 ring-violet-300",
  FITTING: "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300",
  FINISHING: "bg-violet-100 text-violet-900 ring-violet-300",
  READY: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  BALANCE_PENDING: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  BALANCE_PAID: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  DELIVERED: "bg-stone-200 text-stone-800 ring-stone-300",
  DECLINED: "bg-red-100 text-red-900 ring-red-300",
  CANCELLED: "bg-red-100 text-red-900 ring-red-300",
};

export function StatusChip({ status, label }: { status: string; label: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${TONE[status] ?? "bg-stone-100 text-stone-800 ring-stone-300"}`}>{label}</span>;
}

export function Bento({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-3xl p-4 ${accent ?? "bg-white ring-1 ring-stone-200"}`}>
      <p className="truncate text-xs font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="break-words text-3xl font-black leading-none tabular-nums">{value}</p>
      {hint && <p className="mt-auto truncate text-xs opacity-70">{hint}</p>}
    </div>
  );
}
