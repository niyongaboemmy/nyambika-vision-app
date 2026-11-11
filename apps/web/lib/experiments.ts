"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";

/** One request per key per page load; the server logs the exposure and keeps the arm sticky. */
const cache = new Map<string, Promise<string | null>>();

/**
 * The signed-in shopper's arm for a pilot experiment. `undefined` while loading,
 * `null` when the experiment isn't running (render the default experience).
 */
export function useExperiment(key: string): string | null | undefined {
  const { me } = useSession();
  const [arm, setArm] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!me) {
      setArm(null);
      return;
    }
    const k = `${me.id}:${key}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        api<Record<string, string | null>>(`/experiments/mine?keys=${encodeURIComponent(key)}`)
          .then((r) => r[key] ?? null)
          .catch(() => null),
      );
    }
    let live = true;
    void cache.get(k)!.then((v) => live && setArm(v));
    return () => {
      live = false;
    };
  }, [me, key]);
  return arm;
}
