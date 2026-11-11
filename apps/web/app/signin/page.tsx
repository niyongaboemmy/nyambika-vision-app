"use client";

import { REGION_CODES, REGIONS, signInPhone, type RegionCode } from "@nyambika/contracts/region-data";
import { LOCALES, type Locale } from "@nyambika/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PasskeyOffer, PasskeySignInButton } from "@/components/passkeys";
import { Button, Chip, ErrorNote, Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { offerDismissed, passkeysSupported } from "@/lib/passkeys";
import { savedCountry } from "@/lib/region";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français", sw: "Kiswahili (beta)" };

function SignIn() {
  const { t, locale, setLocale, reload } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") ?? "/";
  const [invite, setInvite] = useState(search.get("invite") ?? "");
  const [showInvite, setShowInvite] = useState(Boolean(search.get("invite")));
  const [phone, setPhone] = useState("");
  // Hardening pass 1 (E41): national numbers are read for this country (region cookie, else Rwanda).
  const [country, setCountry] = useState<RegionCode>("RW");
  useEffect(() => setCountry((c) => savedCountry() ?? c), []);
  const phoneCheck = phone.replace(/\D/g, "").length >= 6 ? signInPhone(phone, country) : null;
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "passkey">("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/auth/otp/request", { method: "POST", json: { phone, country } });
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
      await api("/auth/otp/verify", { method: "POST", json: { phone, country, code } });
      await api("/auth/me", { method: "PATCH", json: { locale } }).catch(() => {});
      await reload();
      // E29: offer a passkey once OTP has proven the phone ("Sign in faster next time").
      if (passkeysSupported() && !offerDismissed()) {
        const keys = await api<unknown[]>("/auth/passkeys").catch(() => [1]);
        if (keys.length === 0) {
          setStep("passkey");
          return;
        }
      }
      proceed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function proceed() {
    // Pilot invite entered at sign-in: redeem it on the join screen (which explains any problem).
    const pilotCode = invite.trim().toUpperCase();
    router.replace(pilotCode && !next.startsWith("/join") ? `/join/${encodeURIComponent(pilotCode)}` : next);
  }

  if (step === "passkey") {
    return (
      <Screen>
        <main className="flex min-h-dvh flex-col justify-center px-6">
          <PasskeyOffer onDone={proceed} />
        </main>
      </Screen>
    );
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
          <div className="flex flex-wrap gap-2">
            {LOCALES.map((l) => (
              <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>
            ))}
          </div>
        </div>

        {step === "phone" ? (
          <form onSubmit={send} className="flex flex-col gap-3">
            <label className="text-sm text-mut" htmlFor="phone">{t("auth.phone")}</label>
            <div className="flex gap-2">
              <select
                aria-label={t("region.country")}
                value={country}
                onChange={(e) => setCountry(e.target.value as RegionCode)}
                className="glass h-14 shrink-0 rounded-2xl bg-transparent pl-3 pr-2 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {REGION_CODES.map((c) => (
                  <option key={c} value={c} className="bg-ink-2">{REGIONS[c].flag} +{REGIONS[c].dialCode}</option>
                ))}
              </select>
              <input
                id="phone"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={country === "RW" ? "078 812 3456" : REGIONS[country].phoneExample}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={phoneCheck ? !phoneCheck.ok : undefined}
                aria-describedby={phoneCheck && !phoneCheck.ok ? "phone-hint" : undefined}
                className="glass h-14 min-w-0 flex-1 rounded-2xl px-4 text-lg outline-none placeholder:text-white/30"
              />
            </div>
            {phoneCheck && !phoneCheck.ok && <p id="phone-hint" className="text-xs text-gold">{phoneCheck.message}</p>}
            {showInvite ? (
              <label className="flex flex-col gap-2 text-sm text-mut">
                {t("pilot.code")}
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="NYA-1A2B3C"
                  className="glass h-12 rounded-2xl px-4 font-mono tracking-[.15em] text-white outline-none placeholder:text-white/30"
                />
              </label>
            ) : (
              <button type="button" onClick={() => setShowInvite(true)} className="self-start text-sm text-mut underline underline-offset-4">{t("pilot.haveCode")}</button>
            )}
            <ErrorNote error={error} />
            <Button disabled={busy || phone.replace(/\D/g, "").length < 9 || (phoneCheck ? !phoneCheck.ok : false)}>{t("auth.sendCode")}</Button>
            <PasskeySignInButton onSignedIn={async () => { await reload(); proceed(); }} />
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
