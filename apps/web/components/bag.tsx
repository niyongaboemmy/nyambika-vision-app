"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import type { Bag, SavedAddress } from "@/lib/bag";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";

/** "Add to bag": the secondary action in the hold-to-buy sheet (E29). Hold-to-buy stays primary. */
export function AddToBag({ look, size }: { look: Look; size: string }) {
  const { t } = useSession();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const bag = await api<Bag>("/bag/items", { method: "POST", json: { variantId: look.variant.id, size, lookId: look.id } });
      setCount(bag.count);
      navigator.vibrate?.(14);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!look.variant.inStock) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      {count === null ? (
        <button type="button" onClick={add} disabled={busy} className="glass min-h-11 rounded-2xl px-5 text-sm font-semibold disabled:opacity-50">
          🛍️ {t("bag.add")} · {size}
        </button>
      ) : (
        <p className="flex animate-rise items-center gap-3 text-sm" role="status">
          <span className="font-semibold text-mint">✓ {t("bag.added")}</span>
          <Link href="/bag" className="glass rounded-2xl px-4 py-2 font-semibold">{t("bag.view")} ({count})</Link>
        </p>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** Trust centre: saved delivery addresses (encrypted at rest; in export and deletion). */
export function AddressesCard() {
  const { t } = useSession();
  const [rows, setRows] = useState<SavedAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SavedAddress[]>("/addresses").then(setRows).catch((e) => setError((e as Error).message));
  }, []);
  if (rows !== null && rows.length === 0) return null;
  return (
    <section className="glass space-y-2 rounded-3xl p-4" aria-labelledby="addr-h">
      <p id="addr-h" className="font-semibold">📍 {t("bag.addresses")}</p>
      <p className="text-xs text-mut">Encrypted on our side. Only the maker you order from sees the address, for delivery.</p>
      {rows === null ? (
        <div className="h-12 animate-pulse rounded-2xl bg-white/10" />
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{a.label}{a.isDefault ? " · default" : ""}</span>
                <span className="block truncate text-xs text-mut">{a.address}</span>
              </span>
              <button
                className="rounded-xl px-2 py-2 text-xs font-semibold text-terra"
                aria-label={`${t("bag.remove")} ${a.label}`}
                onClick={async () => setRows(await api<SavedAddress[]>(`/addresses/${a.id}`, { method: "DELETE" }))}
              >
                {t("bag.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

export function EmptyBag() {
  const { t } = useSession();
  return (
    <div className="flex flex-col items-center gap-4 pt-16 text-center">
      <span className="orb size-24 animate-[orb-spin_24s_linear_infinite] rounded-full shadow-[0_0_60px_rgba(139,92,246,.45)]" aria-hidden />
      <h2 className="font-display text-2xl font-black">{t("bag.empty")}</h2>
      <p className="max-w-xs text-mut">{t("bag.emptyBody")}</p>
      <Link href="/" className="grad-cta inline-flex min-h-12 items-center justify-center rounded-2xl px-5 font-semibold text-white">✨ {t("bag.keepLooking")}</Link>
    </div>
  );
}
