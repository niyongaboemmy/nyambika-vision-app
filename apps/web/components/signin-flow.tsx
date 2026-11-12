"use client";

import { REGION_CODES, REGIONS, signInPhone, type RegionCode } from "@nyambika/contracts/region-data";
import { useEffect, useState } from "react";
import { PasskeyOffer, PasskeySignInButton } from "@/components/passkeys";
import { Button, ErrorNote } from "@/components/ui";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { haptic } from "@/lib/native";
import { offerDismissed, passkeysSupported } from "@/lib/passkeys";
import { savedCountry } from "@/lib/region";
import { useSession } from "@/lib/session";

/**
 * Phone → code → (passkey offer): the sign-in steps, shared by the /signin page and the in-place sign-in sheet
 * (navigation pass). `onDone` runs once the session is loaded; the caller decides where that leads (the page
 * returns to `next`, the sheet resumes the action that asked). Filled iOS fields on theme tokens, so it reads right
 * on the aurora page and on a cream / charcoal sheet.
 */
export function SignInFlow({ onDone, initialInvite = "", allowInvite = true, onPasskeyOffer }: { onDone: (r: { invite: string }) => void; initialInvite?: string; allowInvite?: boolean; /** The passkey offer is showing (the page gives it the whole screen). */ onPasskeyOffer?: () => void }) {
  const { t, locale, reload } = useSession();
  const [invite, setInvite] = useState(initialInvite);
  const [showInvite, setShowInvite] = useState(Boolean(initialInvite));
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
  const done = () => {
    haptic("success");
    onDone({ invite: invite.trim().toUpperCase() });
  };

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
          onPasskeyOffer?.();
          return;
        }
      }
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "passkey") return <PasskeyOffer onDone={done} />;

  const field = "h-14 rounded-2xl bg-fill text-txt outline-none placeholder:text-mut focus-visible:ring-2 focus-visible:ring-gold";
  if (step === "code") {
    return (
      <form onSubmit={verify} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm text-mut" htmlFor="code">{t("auth.code")}</label>
          <button type="button" onClick={() => { setStep("phone"); setCode(""); setError(null); }} aria-label={`Change number ${phone}`} className="hit inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-mut">
            <Icon name="back" className="size-4" /> <span className="tabular-nums">{phone}</span>
          </button>
        </div>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${field} px-4 text-center text-2xl tracking-[.5em]`}
        />
        {devCode && (
          <p className="text-center text-xs text-mut">
            {t("auth.devCode")}: <button type="button" className="hit font-mono text-gold underline" onClick={() => setCode(devCode)}>{devCode}</button>
          </p>
        )}
        <ErrorNote error={error} />
        <Button disabled={busy || code.length !== 6}>{t("auth.verify")}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <label className="text-sm text-mut" htmlFor="phone">{t("auth.phone")}</label>
      <div className="flex gap-2">
        <select
          aria-label={t("region.country")}
          value={country}
          onChange={(e) => setCountry(e.target.value as RegionCode)}
          className={`${field} shrink-0 pl-3 pr-2 text-base`}
        >
          {REGION_CODES.map((c) => (
            <option key={c} value={c} className="bg-ink-2 text-white">{c} +{REGIONS[c].dialCode}</option>
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
          className={`${field} min-w-0 flex-1 px-4 text-lg`}
        />
      </div>
      {phoneCheck && !phoneCheck.ok && <p id="phone-hint" className="text-xs text-gold">{phoneCheck.message}</p>}
      {allowInvite &&
        (showInvite ? (
          <label className="flex flex-col gap-2 text-sm text-mut">
            {t("pilot.code")}
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="NYA-1A2B3C"
              className={`${field} h-12 px-4 font-mono tracking-[.15em]`}
            />
          </label>
        ) : (
          <button type="button" onClick={() => setShowInvite(true)} className="-my-2 inline-flex min-h-11 items-center self-start text-sm text-mut underline underline-offset-4">{t("pilot.haveCode")}</button>
        ))}
      <ErrorNote error={error} />
      <Button disabled={busy || phone.replace(/\D/g, "").length < 9 || (phoneCheck ? !phoneCheck.ok : false)}>{t("auth.sendCode")}</Button>
      <PasskeySignInButton onSignedIn={async () => { await reload(); done(); }} />
    </form>
  );
}
