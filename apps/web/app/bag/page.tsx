"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyBag } from "@/components/bag";
import { Button, Chip, ErrorNote, Fact, InfoTip, Screen, Sheet, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { BAG_DELIVERY_FEE, type Bag, type BagGroup, type CheckoutResult, type SavedAddress } from "@/lib/bag";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

type Mode = "DELIVERY" | "PICKUP";

/**
 * Optional classic bag + checkout (E29) alongside hold-to-buy. A bag is grouped per maker: each maker
 * gets its own order and its own Mobile Money request, paid straight to them (OP-3, CON-08).
 */
export default function BagPage() {
  const { me, loading, t } = useSession();
  const router = useRouter();
  const [bag, setBag] = useState<Bag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Record<string, Mode>>({});
  const [checkout, setCheckout] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace("/signin?next=/bag");
    api<Bag>("/bag").then(setBag).catch((e) => setError((e as Error).message));
  }, [me, loading, router]);

  async function setQty(id: string, qty: number) {
    setError(null);
    try {
      setBag(await api<Bag>(`/bag/items/${id}`, { method: "PATCH", json: { qty } }));
      navigator.vibrate?.(6);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const groups = bag?.groups ?? [];
  const mode = (g: BagGroup): Mode => delivery[g.key] ?? "DELIVERY";
  const fee = (g: BagGroup) => (mode(g) === "DELIVERY" ? BAG_DELIVERY_FEE : 0);
  const total = groups.reduce((n, g) => n + g.subtotalRwf + fee(g), 0);
  const blocked = groups.some((g) => !g.payable);

  return (
    <Screen>
      <TopBar back="/" title={t("bag.title")} />
      <main className="space-y-4 px-4 pb-40">
        <ErrorNote error={error} />
        {bag === null ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-white/10" />)}
          </div>
        ) : groups.length === 0 ? (
          <EmptyBag />
        ) : (
          <>
            {groups.length > 1 && (
              <section className="animate-rise rounded-3xl border border-gold/40 bg-gold/10 p-4" aria-label="Payment split">
                <p className="font-display text-lg font-black">
                  {groups.length} {t("bag.makers")} · {groups.length} {t("bag.payments")}
                </p>
                <p className="mt-2 flex items-center gap-1">
                  <Fact icon="wallet">Paid directly to each maker</Fact>
                  <InfoTip label="About split payments">{t("bag.splitNote")}</InfoTip>
                </p>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.key} className="glass animate-rise space-y-3 rounded-3xl p-4" aria-labelledby={`g-${g.key}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`g-${g.key}`} className="truncate font-display text-lg font-black">{g.pageName}</h2>
                    <p className="truncate text-xs text-mut">🔐 {t("buy.paidTo")} {g.payoutLabel}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{rwf(g.subtotalRwf + fee(g))}</span>
                </div>
                <ul className="space-y-2">
                  {g.lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-3">
                      {l.image ? <img loading="lazy" decoding="async" src={l.image} alt="" className="h-20 w-16 shrink-0 rounded-2xl bg-white/5 object-cover" /> : <span className="h-20 w-16 shrink-0 rounded-2xl bg-white/10" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{l.title}</p>
                        <p className="truncate text-xs text-mut">{l.colourName} · size {l.size}{l.madeToOrder ? " · tailor-made" : ""}</p>
                        <p className="text-sm">{rwf(l.unitPriceRwf)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 rounded-2xl bg-white/10 p-1" role="group" aria-label={`Quantity of ${l.title}`}>
                        <button className="hit grid size-9 place-items-center rounded-xl text-lg" aria-label={l.qty === 1 ? `${t("bag.remove")} ${l.title}` : `One fewer ${l.title}`} onClick={() => setQty(l.id, l.qty - 1)}>
                          {l.qty === 1 ? "🗑" : "−"}
                        </button>
                        <span className="w-5 text-center font-semibold" aria-live="polite">{l.qty}</span>
                        <button className="hit grid size-9 place-items-center rounded-xl text-lg disabled:opacity-40" aria-label={`One more ${l.title}`} disabled={l.qty >= 5 || (!l.madeToOrder && l.qty >= l.stock)} onClick={() => setQty(l.id, l.qty + 1)}>＋</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">Delivery or pickup from {g.pageName}</legend>
                  <Chip active={mode(g) === "DELIVERY"} onClick={() => setDelivery({ ...delivery, [g.key]: "DELIVERY" })}>🛵 {t("bag.delivery")} +{rwf(BAG_DELIVERY_FEE)}</Chip>
                  <Chip active={mode(g) === "PICKUP"} onClick={() => setDelivery({ ...delivery, [g.key]: "PICKUP" })}>🏪 {t("bag.pickup")}{g.sector ? ` · ${g.sector}` : ""}</Chip>
                </fieldset>
                {g.problems.map((p) => <p key={p} className="text-sm text-terra">⚠ {p}</p>)}
              </section>
            ))}
          </>
        )}
      </main>

      {groups.length > 0 && (
        <footer className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          <div className="flex items-center gap-3 rounded-3xl border border-white/15 bg-ink-2/95 p-3 shadow-[0_-10px_40px_rgba(0,0,0,.55)] backdrop-blur-xl">
            <div className="min-w-0 flex-1 pl-1">
              <p className="text-xs text-mut">{t("bag.total")} · {bag?.count} items</p>
              <p className="font-display text-xl font-black">{rwf(total)}</p>
            </div>
            <Button disabled={blocked} onClick={() => { setCheckout(true); track("buy_sheet_opened", { source: "bag", count: bag?.count ?? 0 }); }}>{t("bag.checkout")} →</Button>
          </div>
        </footer>
      )}

      {bag && (
        <CheckoutSheet
          open={checkout}
          onClose={() => setCheckout(false)}
          groups={groups}
          delivery={delivery}
          total={total}
          onDone={async (r) => {
            setCheckout(false);
            setResult(r);
            setBag(await api<Bag>("/bag"));
          }}
        />
      )}

      <Sheet open={result !== null} onClose={() => setResult(null)}>
        {result && <CheckoutDone result={result} />}
      </Sheet>
    </Screen>
  );
}

function CheckoutSheet({ open, onClose, groups, delivery, total, onDone }: {
  open: boolean;
  onClose: () => void;
  groups: BagGroup[];
  delivery: Record<string, Mode>;
  total: number;
  onDone: (r: CheckoutResult) => void;
}) {
  const { me, t } = useSession();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addressId, setAddressId] = useState<string | "new">("new");
  const [address, setAddress] = useState("");
  const [save, setSave] = useState(true);
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  const needsAddress = groups.some((g) => (delivery[g.key] ?? "DELIVERY") === "DELIVERY");

  useEffect(() => {
    if (!open || addresses) return;
    api<SavedAddress[]>("/addresses")
      .then((a) => {
        setAddresses(a);
        if (a[0]) setAddressId(a[0].id);
      })
      .catch(() => setAddresses([]));
  }, [open, addresses]);

  const ready = !needsAddress || addressId !== "new" || address.trim().length >= 4;

  async function pay() {
    setBusy(true);
    setError(null);
    key.current ||= crypto.randomUUID();
    navigator.vibrate?.([20, 40, 20]);
    try {
      const r = await api<CheckoutResult>("/checkout", {
        method: "POST",
        headers: { "idempotency-key": key.current },
        json: {
          wallet,
          payerPhone: me!.phone,
          delivery,
          ...(needsAddress ? (addressId === "new" ? { address, saveAddress: save, addressLabel: "Home" } : { addressId }) : {}),
        },
      });
      key.current = "";
      onDone(r);
    } catch (e) {
      // Same key on retry: the server returns the orders it already made, never a second push.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()}>
      <h2 className="font-display text-2xl font-black">{t("bag.checkout")}</h2>
      <div className="mt-4 max-h-[60dvh] space-y-4 overflow-y-auto pb-1">
        {needsAddress && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">{t("bag.address")}</legend>
            <div className="flex flex-wrap gap-2">
              {addresses?.map((a) => <Chip key={a.id} active={addressId === a.id} onClick={() => setAddressId(a.id)}>📍 {a.label} · {a.address.slice(0, 22)}</Chip>)}
              {addresses && addresses.length > 0 && <Chip active={addressId === "new"} onClick={() => setAddressId("new")}>＋ {t("bag.newAddress")}</Chip>}
            </div>
            {addressId === "new" && (
              <>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. KG 7 Ave, Kacyiru" aria-label={t("bag.address")} className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
                <label className="flex min-h-11 items-center gap-2 text-sm text-mut">
                  <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-4 accent-[#f2b84b]" />
                  {t("bag.saveAddress")}
                </label>
              </>
            )}
          </fieldset>
        )}
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">{t("bag.wallet")}</legend>
          <div className="flex flex-wrap gap-2">
            <Chip active={wallet === "MTN_MOMO"} onClick={() => setWallet("MTN_MOMO")}>🟡 MTN MoMo · {me?.phone.slice(-4).padStart(8, "•")}</Chip>
            <Chip active={wallet === "AIRTEL_MONEY"} onClick={() => setWallet("AIRTEL_MONEY")}>🔴 Airtel Money</Chip>
          </div>
        </fieldset>
        <section aria-label="Payments">
          <ol className="space-y-2">
            {groups.map((g, i) => {
              const fee = (delivery[g.key] ?? "DELIVERY") === "DELIVERY" ? BAG_DELIVERY_FEE : 0;
              return (
                <li key={g.key} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-violet/30 text-sm font-bold" aria-hidden>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">🔐 {g.payoutLabel}</span>
                    <span className="block text-xs text-mut">{g.lines.reduce((n, l) => n + l.qty, 0)} items · {fee ? `${t("bag.delivery")} +${rwf(fee)}` : t("bag.pickup")}</span>
                  </span>
                  <span className="font-semibold">{rwf(g.subtotalRwf + fee)}</span>
                </li>
              );
            })}
          </ol>
          {groups.length > 1 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-gold">
              {groups.length} {t("bag.payments")}
              <InfoTip label="About split payments">{t("bag.splitNote")}</InfoTip>
            </p>
          )}
        </section>
      </div>
      <ErrorNote error={error} />
      <Button className="mt-4 w-full" disabled={busy || !ready} onClick={pay}>
        {busy ? "…" : `${t("bag.pay")} ${rwf(total)}${groups.length > 1 ? ` · ${groups.length} ${t("bag.payments")}` : ""}`}
      </Button>
      {needsAddress && !ready && <p className="mt-2 text-center text-xs text-gold">Add a delivery address to continue</p>}
      <p className="mt-2 text-center text-xs text-mut">🔐 Approve each with your PIN · nothing taken before</p>
    </Sheet>
  );
}

function CheckoutDone({ result }: { result: CheckoutResult }) {
  const { t } = useSession();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid size-14 place-items-center rounded-full bg-mint text-3xl text-ink" aria-hidden>📲</span>
        <div>
          <p className="font-display text-xl font-black">{t("bag.sent")}</p>
          <p className="text-sm text-mut">{t("bag.sentBody")}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {result.orders.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}?fresh=1`} className="glass flex items-center gap-3 rounded-2xl px-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{o.payoutLabel}</span>
                <span className="block text-xs text-mut">{o.code} · {o.items} items</span>
              </span>
              <span className="font-semibold">{rwf(o.totalRwf)}</span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
      {result.failed.map((f) => <p key={f.pageName} className="text-sm text-terra">⚠ {f.pageName}: {f.reason}</p>)}
      {process.env.NODE_ENV !== "production" && <Link href="/dev/handset" className="block text-center text-sm text-gold underline">Open the simulated handset (dev)</Link>}
    </div>
  );
}
