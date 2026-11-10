"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LookView } from "@/components/look-view";
import { ErrorNote, Screen, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";
import { useLook } from "@/lib/use-look";

function TryOn() {
  const variantId = useSearchParams().get("variant");
  const { me, loading } = useSession();
  const router = useRouter();
  const [initial, setInitial] = useState<Look | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const { look, save, variant } = useLook(initial);

  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace(`/signin?next=${encodeURIComponent(`/looks/try?variant=${variantId}`)}`);
    if (!variantId || started.current) return;
    started.current = true;
    api<Look>("/looks/try", { method: "POST", json: { variantId } }).then(setInitial).catch((e) => setError(e.message));
  }, [loading, me, variantId, router]);

  if (error) return <Screen><div className="p-6 pt-20"><ErrorNote error={error} /></div></Screen>;
  if (!look) return <Screen><div className="grid min-h-dvh place-items-center"><Spinner /></div></Screen>;
  return (
    <div className="mx-auto h-dvh w-full max-w-[480px]">
      <LookView look={look} onSave={save} onVariant={variant} />
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
