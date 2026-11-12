"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Product title in the shopper's language (RW/FR copy from the catalogue); English stays as rendered. */
export function LocalTitle({ productId, fallback }: { productId: string; fallback: string }) {
  const { locale } = useSession();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    setTitle(null);
    if (locale === "en") return;
    let live = true;
    api<{ copy: { title: string } | null }>(`/copy/products/${productId}?locale=${locale}`)
      .then((r) => live && setTitle(r.copy?.title ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [productId, locale]);
  return <>{title ?? fallback}</>;
}
