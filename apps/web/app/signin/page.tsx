"use client";

import { LOCALES, type Locale } from "@nyambika/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SignInFlow } from "@/components/signin-flow";
import { Chip, Screen, TopBar } from "@/components/ui";
import { safeReturn } from "@/lib/nav";
import { useReturn } from "@/lib/use-nav";
import { useSession } from "@/lib/session";

const LABELS: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français", sw: "Kiswahili (beta)" };

/**
 * Full-page sign in: deep links, guards on signed-in-only screens and the Muse header. Most flows now sign in on a
 * sheet over the current screen instead (lib/auth-ask.ts); both share SignInFlow. `next` is same-site only.
 */
function SignIn() {
  const { t, locale, setLocale } = useSession();
  const router = useRouter();
  const back = useReturn();
  const search = useSearchParams();
  const next = safeReturn(search.get("next")) ?? "/";
  const [offer, setOffer] = useState(false);

  function proceed({ invite }: { invite: string }) {
    // Pilot invite entered at sign-in: redeem it on the join screen (which explains any problem).
    if (invite && !next.startsWith("/join")) return router.replace(`/join/${encodeURIComponent(invite)}`);
    back(next);
  }

  // Once OTP has proven the phone, the passkey offer gets the whole screen (no title or language chips around it).
  // One tree either way, so SignInFlow keeps its step.
  return (
    <Screen>
      {!offer && <TopBar back={next} />}
      <main className={`flex flex-col justify-center gap-8 px-6 ${offer ? "min-h-dvh" : "min-h-[80dvh]"}`}>
        {!offer && <div className="animate-rise">
          <span className="orb mb-6 block size-16 animate-orb rounded-full shadow-[0_0_40px_rgba(242,184,75,.45)]" />
          <h1 className="font-display text-4xl font-black leading-tight text-grad">{t("auth.title")}</h1>
          <p className="mt-2 text-mut">{t("app.tagline")}</p>
        </div>}

        {!offer && <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-gold">{t("lang.pick")}</p>
          <div role="group" aria-label={t("lang.pick")} className="grid grid-cols-2 gap-2 [&>*]:w-full [&>*]:justify-center">
            {LOCALES.map((l) => (
              <Chip key={l} active={l === locale} onClick={() => setLocale(l)}>{LABELS[l]}</Chip>
            ))}
          </div>
        </div>}

        <SignInFlow onDone={proceed} initialInvite={search.get("invite") ?? ""} onPasskeyOffer={() => setOffer(true)} />
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
