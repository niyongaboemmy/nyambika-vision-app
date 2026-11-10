"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

/** Member Page Manager shell: light theme, phone-first (FR-PAGE-11). */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, t } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=${encodeURIComponent(path)}`);
  }, [loading, me, router, path]);
  return (
    <div className="theme-light min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#faf7f3]/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/studio" className="flex items-center gap-2">
            <span className="orb size-7 rounded-full" />
            <span className="font-display text-lg font-black">{t("studio.title")}</span>
          </Link>
          <Link href="/" className="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold">Shopper view</Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-5">{loading || !me ? <p className="text-stone-500">Loading…</p> : children}</div>
    </div>
  );
}
