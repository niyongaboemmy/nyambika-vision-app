"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

let cached: Promise<Record<string, boolean>> | null = null;

/** One `/flags` fetch per page load, shared by every caller (R4 spike entry points). */
export function useFlag(key: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    cached ??= api<Record<string, boolean>>("/flags").catch(() => ({}));
    let live = true;
    void cached.then((f) => live && setOn(Boolean(f[key])));
    return () => {
      live = false;
    };
  }, [key]);
  return on;
}
