"use client";

import Link from "next/link";
import { Button, Screen, TopBar } from "@/components/ui";
import { useSession } from "@/lib/session";

export default function Home() {
  const { me, loading, t } = useSession();
  return (
    <Screen>
      <TopBar right={!loading && !me ? <Link href="/signin" className="glass rounded-full px-4 py-2 text-sm font-semibold">Sign in</Link> : null} />
      <main className="flex min-h-[80dvh] flex-col items-center justify-center gap-6 px-6 text-center">
        <span className="orb size-40 animate-orb rounded-full shadow-[0_0_80px_rgba(139,92,246,.45)]" />
        <h1 className="font-display text-4xl font-black text-grad">{t("app.tagline")}</h1>
        {me && (
          <div className="flex gap-2"><Link href="/mirror"><Button>🪞 {t("mirror.title")}</Button></Link><Link href="/studio"><Button variant="glass">{t("studio.title")}</Button></Link></div>
        )}
      </main>
    </Screen>
  );
}
