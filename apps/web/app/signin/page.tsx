"use client";

import { LOCALES, type Locale } from "@nyambika/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Chip, ErrorNote, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français" };

function SignIn() {
  const { t, locale, setLocale, reload } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/auth/otp/request", { method: "POST", json: { phone } });
      setDevCode(r.devCode ?? null);
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/otp/verify", { method: "POST", json: { phone, code } });
      await api("/auth/me", { method: "PATCH", json: { locale } }).catch(() => {});
      await reload();
      router.replace(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar back="/" />
      <main className="flex min-h-[80dvh] flex-col justify-center gap-8 px-6">
        <div className="animate-rise">
          <span className="orb mb-6 block size-16 animate-orb rounded-full shadow-[0_0_40px_rgba(242,184,75,.45)]" />
          <h1 className="font-display text-4xl font-black leading-tight text-grad">{t("auth.title")}</h1>
          <p className="mt-2 text-mut">{t("app.tagline")}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-gold">{t("lang.pick")}</p>
          <div className="flex gap-2">
            {LOCALES.map((l) => (
              <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>
            ))}
          </div>
        </div>

        {step === "phone" ? (
          <form onSubmit={send} className="flex flex-col gap-3">
            <label className="text-sm text-mut" htmlFor="phone">{t("auth.phone")}</label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="078 812 3456"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="glass h-14 rounded-2xl px-4 text-lg outline-none placeholder:text-white/30"
            />
            <ErrorNote error={error} />
            <Button disabled={busy || phone.replace(/\D/g, "").length < 9}>{t("auth.sendCode")}</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <label className="text-sm text-mut" htmlFor="code">{t("auth.code")}</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="glass h-14 rounded-2xl px-4 text-center text-2xl tracking-[.5em] outline-none"
            />
            {devCode && (
              <p className="text-center text-xs text-mut">
                {t("auth.devCode")}: <button type="button" className="font-mono text-gold underline" onClick={() => setCode(devCode)}>{devCode}</button>
              </p>
            )}
            <ErrorNote error={error} />
            <Button disabled={busy || code.length !== 6}>{t("auth.verify")}</Button>
          </form>
        )}
      </main>
    </Screen>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
