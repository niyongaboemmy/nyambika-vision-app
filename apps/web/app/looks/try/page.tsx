"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import { LooksSkeleton } from "@/components/look-rail";
const LimitState = dynamic(() => import("@/components/limit-state").then((m) => m.LimitState), { ssr: false }); // error-only
import { Icon } from "@/components/icons";
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";
import { useLook } from "@/lib/use-look";

// JS budget pass: the look card and hold-to-buy load in parallel with the try-on request (see /looks/[sessionId]).
const loadLookView = () => import("@/components/look-view");
const loadHoldToBuy = () => import("@/components/hold-to-buy");
const LookView = dynamic(() => loadLookView().then((m) => m.LookView), { ssr: false, loading: () => <LooksSkeleton /> });
const HoldToBuy = dynamic(() => loadHoldToBuy().then((m) => m.HoldToBuy), { ssr: false });

function TryOn() {
  const variantId = useSearchParams().get("variant");
  const { me, loading } = useSession();
  const router = useRouter();
  const [initial, setInitial] = useState<Look | null>(null);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => { started.current = false; setError(null); setAttempt((n) => n + 1); };
  const { look, save, variant } = useLook(initial);

  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace(`/signin?next=${encodeURIComponent(`/looks/try?variant=${variantId}`)}`);
    if (!variantId || started.current) return;
    started.current = true;
    void loadLookView();
    void loadHoldToBuy();
    api<Look>("/looks/try", { method: "POST", json: { variantId } }).then(setInitial).catch(setError);
  }, [loading, me, variantId, router, attempt]);

  if (error) return <Screen><div className="p-6 pt-20"><LimitState error={error} onRetry={retry} /></div></Screen>;
  // No (or a stale) ?variant= link used to spin forever: send the shopper somewhere useful instead.
  if (!variantId && !loading && me)
    return <Screen><div className="p-6 pt-24 text-center"><p className="text-mut">Pick a piece in a Maker Space to try it on.</p><Link href="/makers" className="glass mt-4 inline-flex min-h-12 items-center gap-1 rounded-2xl px-5 font-semibold">Browse makers <Icon name="chevron" className="size-4" /></Link></div></Screen>;
  if (!look) return <LooksSkeleton />;
  return (
    <div className="theme-media mx-auto h-dvh w-full max-w-[480px] bg-black">
      <LookView look={look} onSave={save} onVariant={variant}><HoldToBuy look={look} /></LookView>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <TryOn />
    </Suspense>
  );
}
