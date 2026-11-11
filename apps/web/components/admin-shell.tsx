"use client";

import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/kit";
import { Icon, type IconName } from "@/components/studio";
import { Brand } from "@/components/studio-shell";

const ICONS: Record<string, IconName> = {
  Overview: "grid",
  Regions: "globe",
  Verify: "shield",
  Moderation: "flag",
  Migration: "swap",
  "Flags & models": "server",
  Outbox: "mail",
  Audit: "list",
  Pilot: "trend",
  "Agents & partners": "globe",
};

/**
 * Host admin shell in the studio language: slim sidebar from 1024px, sticky header with
 * scrollable pill tabs on phones. Tabs stay real <button>s named exactly as the tab.
 */
export function AdminShell<T extends string>({ tabs, tab, onTab, counts = {}, children }: { tabs: readonly T[]; tab: T; onTab: (t: T) => void; counts?: Partial<Record<T, number>>; children: ReactNode }) {
  const pick = (t: T) => {
    onTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="theme-light st-app min-h-dvh overflow-x-clip text-cocoa lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 border-r border-hairline bg-white/55 px-4 py-5 backdrop-blur lg:flex">
        <div className="px-2">
          <Brand label="Host admin" />
          <p className="mt-1 pl-[42px] text-xs font-semibold text-cocoa-2">Nyambika operations</p>
        </div>
        <nav aria-label="Admin sections" className="flex flex-col gap-1">
          {tabs.map((t) => {
            const on = t === tab;
            return (
              <button
                key={t}
                type="button"
                onClick={() => pick(t)}
                aria-current={on ? "page" : undefined}
                className={`st-press flex min-h-11 items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-bold ${on ? "bg-cocoa text-white shadow-[0_8px_20px_-10px_rgba(29,24,20,.6)]" : "text-cocoa-2 hover:bg-white hover:text-cocoa"}`}
              >
                <Icon name={ICONS[t] ?? "grid"} className="size-5" />
                <span className="flex-1">{t}</span>
                {counts[t] ? <span aria-hidden className={`rounded-full px-2 py-0.5 text-[11px] ${on ? "bg-white text-cocoa" : "bg-terra-ink text-white"}`}>{counts[t]}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2">
          <a href="/" className="st-press flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-bold text-cocoa-2 hover:bg-white hover:text-cocoa">
            <Icon name="eye" className="size-5" /> Shopper view
          </a>
          <ThemeToggle compact className="flex w-full [&>button]:flex-1" />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="material sticky top-0 z-30 border-b lg:hidden">
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
            <Brand label="Host admin" />
            <span className="flex items-center gap-2">
              <ThemeToggle compact />
              <a href="/" aria-label="Shopper view" className="st-press grid size-11 place-items-center rounded-2xl bg-white text-cocoa ring-1 ring-inset ring-hairline">
                <Icon name="eye" className="size-5" />
              </a>
            </span>
          </div>
          <nav aria-label="Admin sections" className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2.5">
            {tabs.map((t) => {
              const on = t === tab;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => pick(t)}
                  aria-current={on ? "page" : undefined}
                  className={`st-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold ${on ? "bg-cocoa text-white" : "bg-white text-cocoa-2 ring-1 ring-inset ring-hairline"}`}
                >
                  <Icon name={ICONS[t] ?? "grid"} className="size-4" />
                  {t}
                  {counts[t] ? <span aria-hidden className={`rounded-full px-1.5 text-[11px] ${on ? "bg-white text-cocoa" : "bg-terra-ink text-white"}`}>{counts[t]}</span> : null}
                </button>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl space-y-5 px-4 pb-16 pt-5 lg:px-8 lg:pt-8">
          <h1 className="font-display text-2xl font-black tracking-tight text-cocoa lg:text-3xl">{tab}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
