"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { isRendering, type Look } from "./looks";

/** Poll a look until rendering finishes. */
export function useLook(initial: Look | null) {
  const [look, setLook] = useState<Look | null>(initial);
  useEffect(() => setLook(initial), [initial]);
  useEffect(() => {
    if (!look || !isRendering(look.status)) return;
    const t = setTimeout(async () => setLook(await api<Look>(`/looks/${look.id}`)), 900);
    return () => clearTimeout(t);
  }, [look]);
  const save = useCallback(async () => look && setLook(await api<Look>(`/looks/${look.id}/save`, { method: "POST" })), [look]);
  const variant = useCallback(
    async (variantId: string) => look && setLook(await api<Look>(`/looks/${look.id}/variant`, { method: "POST", json: { variantId } })),
    [look],
  );
  return { look, setLook, save, variant };
}
