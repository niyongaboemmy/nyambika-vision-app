"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import { deviceName, dismissOffer, passkeysSupported, registerPasskey, signInWithPasskey, type PasskeyView } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/icons";

/** Passkeys (E29): offer after OTP, sign-in button, and trust-centre management. */

export function PasskeyOffer({ onDone }: { onDone: () => void }) {
  const { t } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      setSaved(true);
      navigator.vibrate?.([12, 30, 12]);
      setTimeout(onDone, 1100);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex animate-rise flex-col items-center gap-5 text-center">
      <span className={`grid size-24 place-items-center rounded-full text-5xl ${saved ? "bg-mint text-ink" : "glass"} shadow-[0_0_60px_rgba(139,92,246,.45)] transition`} aria-hidden>
        {saved ? <Icon name="check" className="size-10" /> : <Icon name="key" className="size-10" />}
      </span>
      <div>
        <h2 className="font-display text-3xl font-black leading-tight text-grad">{saved ? t("passkey.created") : t("passkey.offerTitle")}</h2>
        {!saved && <p className="mx-auto mt-2 max-w-xs text-mut">{t("passkey.offerBody")}</p>}
      </div>
      <ErrorNote error={error} />
      {!saved && (
        <div className="flex w-full flex-col gap-2">
          <Button onClick={create} disabled={busy}><Icon name="key" className="size-5" /> {t("passkey.create")}</Button>
          <Button variant="ghost" onClick={() => { dismissOffer(); onDone(); }} disabled={busy}>{t("passkey.notNow")}</Button>
        </div>
      )}
      <p className="text-xs text-mut">{t("passkey.otpFallback")}</p>
    </div>
  );
}

export function PasskeySignInButton({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useSession();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSupported(passkeysSupported()), []);
  if (!supported) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="glass"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signInWithPasskey();
            onSignedIn();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <Icon name="key" className="size-5" /> {t("passkey.signIn")}
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}

const ago = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function PasskeysCard() {
  const { t } = useSession();
  const [keys, setKeys] = useState<PasskeyView[] | null>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PasskeyView | null>(null);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<PasskeyView | null>(null);

  useEffect(() => {
    setSupported(passkeysSupported());
    api<PasskeyView[]>("/auth/passkeys").then(setKeys).catch((e) => setError((e as Error).message));
  }, []);

  async function run(fn: () => Promise<PasskeyView[]>) {
    setBusy(true);
    setError(null);
    try {
      setKeys(await fn());
      setEditing(null);
      setRemoving(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass space-y-3 rounded-3xl p-4" aria-labelledby="passkeys-h">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet/25" aria-hidden><Icon name="key" className="size-5" /></span>
        <div className="min-w-0">
          <p id="passkeys-h" className="font-semibold leading-tight">{t("passkey.title")}</p>
          <p className="mt-0.5 text-xs text-mut">{t("passkey.otpFallback")}</p>
        </div>
      </div>
      {keys === null ? (
        <div className="h-14 animate-pulse rounded-2xl bg-white/10" />
      ) : keys.length === 0 ? (
        <p className="text-sm text-mut">{t("passkey.none")}</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet/25" aria-hidden><Icon name="key" className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{k.name}</span>
                <span className="block text-xs text-mut">
                  {k.lastUsedAt ? `${t("passkey.lastUsed")} ${ago(k.lastUsedAt)}` : `Added ${ago(k.createdAt)}`}{k.backedUp ? " · synced" : ""}
                </span>
              </span>
              <button className="press min-h-11 rounded-xl px-2 text-xs font-semibold text-gold" onClick={() => { setEditing(k); setName(k.name); }} aria-label={`${t("passkey.rename")} ${k.name}`}>{t("passkey.rename")}</button>
              <button className="press min-h-11 rounded-xl px-2 text-xs font-semibold text-terra" onClick={() => setRemoving(k)} aria-label={`${t("passkey.remove")} ${k.name}`}>{t("passkey.remove")}</button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
      {supported && (
        <Button variant="glass" className="w-full" disabled={busy} onClick={() => run(() => registerPasskey(deviceName()))}><Icon name="plus" className="size-5" /> {t("passkey.add")}</Button>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (editing) void run(() => api<PasskeyView[]>(`/auth/passkeys/${editing.id}`, { method: "PATCH", json: { name } })); }}>
          <label htmlFor="pk-name" className="font-display text-lg font-black">{t("passkey.name")}</label>
          <input id="pk-name" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="glass h-14 w-full rounded-2xl px-4 text-lg outline-none" />
          <Button className="w-full" disabled={busy || !name.trim()}>{t("passkey.rename")}</Button>
        </form>
      </Sheet>
      <Sheet open={removing !== null} onClose={() => setRemoving(null)}>
        <p className="font-display text-xl font-black">{t("passkey.remove")} “{removing?.name}”?</p>
        <p className="mt-2 text-sm text-mut">{t("passkey.removeConfirm")}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="glass" onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => removing && run(() => api<PasskeyView[]>(`/auth/passkeys/${removing.id}`, { method: "DELETE" }))}>{t("passkey.remove")}</Button>
        </div>
      </Sheet>
    </section>
  );
}
