"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MrMirror, type MirrorPiece } from "@/components/mr-mirror";
import { ErrorNote, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Twin3dState, WardrobeItem } from "@/lib/twin3d";
import { load3d } from "@/lib/xr";

export default function MrMirrorPage() {
  return (
    <Suspense fallback={<Screen><div className="skeleton m-6 h-[60dvh] rounded-[32px]" /></Screen>}>
      <MrPage />
    </Suspense>
  );
}

/** R4 spike: mixed-reality fitting mirror, behind `mr.mirror_spike` (off by default). */
function MrPage() {
  const { me, loading } = useSession();
  const router = useRouter();
  const q = useSearchParams();
  const initial = q.get("variant") ?? q.get("product");
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const [pieces, setPieces] = useState<MirrorPiece[] | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [twin, setTwin] = useState<Twin3dState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !me) router.replace(`/signin?next=${encodeURIComponent(`/mirror/mr${initial ? `?variant=${initial}` : ""}`)}`);
  }, [loading, me, router, initial]);

  useEffect(() => {
    if (!me) return;
    void api<Record<string, boolean>>("/flags").then(setFlags).catch(() => setFlags({}));
    void api<Twin3dState>("/twin3d").then(setTwin).catch(() => setTwin(null));
    void (async () => {
      try {
        const w = await api<WardrobeItem[]>("/twin3d/wardrobe");
        setWardrobe(w.filter((x) => x.cutout));
        // Pieces with approved 3D (E27): the one opened from a showroom first, then the wardrobe's.
        const ids = [...new Set([...(q.get("product") ? [q.get("product")!] : []), ...w.map((x) => x.productId)])].slice(0, 10);
        const all = await Promise.all(ids.map(async (id) => ({ id, p: await load3d(id), w: w.find((x) => x.productId === id) })));
        setPieces(all.filter((x) => x.p?.assets.length).map((x) => ({ productId: x.id, title: x.p!.title ?? x.w?.title ?? "Piece", category: x.w?.category ?? "dress", assets: x.p!.assets })));
      } catch (e) {
        setError((e as Error).message);
        setPieces([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const enabled = flags?.["mr.mirror_spike"];
  return (
    <Screen>
      <TopBar back="/mirror/ar" title="Mixed-reality mirror" />
      <main className="px-4 pb-16">
        <ErrorNote error={error} />
        {flags === null || pieces === null ? (
          <div className="skeleton h-[60dvh] rounded-[32px]" />
        ) : !enabled ? (
          <section className="glass mt-6 space-y-3 rounded-3xl p-5 text-center">
            <p className="text-4xl" aria-hidden>🥽</p>
            <p className="font-display text-xl font-black">Mixed-reality mirror is an experiment</p>
            <p className="text-sm text-mut">We&apos;re testing a fitting mirror you can place in your room with a headset. It isn&apos;t switched on for you yet.</p>
            <Link href="/mirror/ar" className="grad-cta inline-flex min-h-12 items-center justify-center rounded-2xl px-5 font-semibold text-white">🪞 Open the AR mirror</Link>
          </section>
        ) : (
          <>
            {pieces.length === 0 && (
              <p className="glass mb-4 rounded-2xl p-4 text-sm text-mut">None of your recent pieces have a 3D model yet. Open a maker&apos;s 3D showroom and choose &ldquo;Mixed-reality mirror&rdquo; on a piece.</p>
            )}
            <MrMirror pieces={pieces} wardrobe={wardrobe} twin={twin} arPilot={Boolean(flags["ar.mirror_pilot"])} initial={initial} />
          </>
        )}
      </main>
    </Screen>
  );
}
