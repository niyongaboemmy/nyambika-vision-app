"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

/** Mirror-screen entry card for the 3D twin (E33). */
export function Twin3dCard() {
  const { t } = useSession();
  return (
    <Link href="/mirror/3d" className="glass group relative flex items-center gap-4 overflow-hidden rounded-3xl p-4 text-left transition active:scale-[.98]">
      <span aria-hidden className="absolute -right-6 -top-8 size-28 rounded-full bg-violet/30 blur-2xl" />
      <span aria-hidden className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-[radial-gradient(circle_at_30%_30%,rgba(242,184,75,.55),rgba(139,92,246,.45))] text-2xl shadow-[0_8px_24px_rgba(139,92,246,.35)]">🧊</span>
      <span className="relative min-w-0 flex-1">
        <span className="block font-display text-lg font-black">{t("twin3d.title")}</span>
        <span className="block text-sm text-mut">Spin · pose · dress</span>
      </span>
      <span aria-hidden className="relative text-xl text-gold transition group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

/** "Try on my 3D twin" from the E27 3D garment stage (keeps the look rail at 7 buttons). */
export function TryIn3d({ variantId }: { variantId?: string }) {
  const { t } = useSession();
  if (!variantId) return null;
  return (
    <Link
      href={`/mirror/3d?variant=${variantId}`}
      className="glass mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition active:scale-[.98]"
    >
      <span aria-hidden>🧊</span> {t("twin3d.tryIn3d")}
    </Link>
  );
}
