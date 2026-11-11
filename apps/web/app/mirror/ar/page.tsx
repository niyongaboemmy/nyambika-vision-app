"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArMirror } from "@/components/ar-mirror";
import { ErrorNote, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { WardrobeItem } from "@/lib/twin3d";
import { useFlag } from "@/lib/flags";

export default function ArMirrorPage() {
  return (
    <Suspense fallback={<Screen><div className="skeleton m-6 h-[60dvh] rounded-[32px]" /></Screen>}>
      <ArPage />
    </Suspense>
  );
}

/** AR mirror pilot (E34), behind the `ar.mirror_pilot` flag (off by default). */
function ArPage() {
  const { me, loading, t } = useSession();
  const router = useRouter();
  const variant = useSearchParams().get("variant");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<WardrobeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mrMirror = useFlag("mr.mirror_spike"); // R4 spike entry

  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=${encodeURIComponent(`/mirror/ar${variant ? `?variant=${variant}` : ""}`)}`);
  }, [loading, me, router, variant]);

  useEffect(() => {
    if (!me) return;
    void api<Record<string, boolean>>("/flags").then((f) => setEnabled(Boolean(f["ar.mirror_pilot"]))).catch(() => setEnabled(false));
    void api<WardrobeItem[]>("/twin3d/wardrobe")
      .then(async (w) => {
        // A piece opened from a look comes first even if it is not in the recent list.
        if (variant && !w.some((x) => x.variantId === variant)) {
          const g = await api<{ title: string; category: string; productId: string; colours: { variantId: string; colourName: string; colourHex: string; cutout: string | null }[] }>(`/twin3d/garment/${variant}`).catch(() => null);
          const c = g?.colours.find((x) => x.variantId === variant);
          if (g && c) w = [{ variantId: c.variantId, productId: g.productId, title: g.title, category: g.category, colourName: c.colourName, colourHex: c.colourHex, cutout: c.cutout, fromLook: true }, ...w];
        }
        setItems(w.filter((x) => x.cutout));
      })
      .catch((e: Error) => setError(e.message));
  }, [me, variant]);

  return (
    <Screen>
      <TopBar back="/mirror/3d" title={t("twin3d.ar")} />
      <main className="px-4 pb-32">
        <ErrorNote error={error} />
        {mrMirror && (
          <Link href={`/mirror/mr${variant ? `?variant=${variant}` : ""}`} className="glass mb-3 flex min-h-12 items-center gap-2 rounded-2xl px-4 text-sm font-bold">
            🥽 Try the mixed-reality mirror <span className="rounded-full bg-violet/35 px-2 py-0.5 text-[10px] uppercase tracking-wide">experimental</span>
          </Link>
        )}
        {enabled === null || items === null ? (
          <div className="skeleton h-[60dvh] rounded-[32px]" />
        ) : !enabled ? (
          <section className="glass mt-6 space-y-3 rounded-3xl p-5 text-center">
            <p className="text-4xl" aria-hidden>🪞</p>
            <p className="font-display text-xl font-black">AR mirror is a pilot</p>
            <p className="text-sm text-mut">The live mirror is being tested with a small group and isn&apos;t switched on for you yet. Your 3D twin shows the same pieces in 3D.</p>
            <Link href={`/mirror/3d${variant ? `?variant=${variant}` : ""}`} className="grad-cta inline-flex min-h-12 items-center justify-center rounded-2xl px-5 font-semibold text-white">🧊 Open my 3D twin</Link>
          </section>
        ) : (
          <ArMirror items={items} initial={variant} />
        )}
      </main>
      <nav aria-label="Mirror mode" className="fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),14px)] z-30 flex justify-center">
        <div className="glass flex rounded-full p-1.5 shadow-[0_12px_40px_rgba(0,0,0,.45)]">
          <Link href={`/mirror/3d${variant ? `?variant=${variant}` : ""}`} className="rounded-full px-5 py-2.5 text-sm font-bold text-white/80">🧊 {t("twin3d.title")}</Link>
          <span aria-current="page" className="rounded-full bg-[#c81e4a] px-5 py-2.5 text-sm font-bold text-[#fff]">🪞 {t("twin3d.ar")}</span>
        </div>
      </nav>
    </Screen>
  );
}
