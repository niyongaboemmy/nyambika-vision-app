"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Fact, Screen, Spinner, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Joined {
  joined: boolean;
  kind: "SHOPPER" | "PAGE";
  cohort: string;
  pages: number;
}

/** Pilot invite redemption (plan §8.1 allowlist): /join/<code>, or /join to type a code. */
export default function Join() {
  const params = useParams<{ code?: string[] }>();
  const initial = (params.code?.[0] ?? "").toUpperCase();
  const { me, loading, t } = useSession();
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Joined | null>(null);
  const tried = useRef(false);

  async function redeem(c: string) {
    setBusy(true);
    setError(null);
    try {
      setDone(await api<Joined>("/pilot/join", { method: "POST", json: { code: c } }));
      navigator.vibrate?.([12, 40, 12]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || !me || !initial || tried.current) return;
    tried.current = true;
    void redeem(initial);
  }, [loading, me, initial]);

  return (
    <Screen>
      <TopBar back="/" />
      <main className="flex min-h-[80dvh] flex-col justify-center gap-7 px-6">
        <div className="animate-rise">
          <span aria-hidden className="orb mb-6 block size-16 rounded-full shadow-[0_0_40px_rgba(242,184,75,.45)] motion-safe:animate-orb" />
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-gold">Nyambika pilot · Kigali</p>
          <h1 className="mt-2 font-display text-4xl font-black leading-tight text-grad">{done ? t("pilot.joined") : t("pilot.join")}</h1>
          {done ? (
            <p className="mt-2 text-mut">{done.kind === "PAGE" ? `${done.cohort} · pilot shoppers see your pieces` : `Welcome to ${done.cohort}`}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Fact icon="store">Rwandan makers</Fact>
              <Fact icon="lock">On your private twin</Fact>
              <Fact icon="sparkle">Invite only</Fact>
            </div>
          )}
        </div>

        {done ? (
          <Button onClick={() => router.push(done.kind === "PAGE" ? "/studio" : "/")}>{done.kind === "PAGE" ? "Open my Page Manager" : "✨ Ask the Muse"}</Button>
        ) : loading || (busy && !error) ? (
          <div className="flex items-center gap-3 text-mut"><Spinner /> Checking your invite…</div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!me) return router.push(`/signin?next=${encodeURIComponent(`/join/${code.trim().toUpperCase()}`)}&invite=${encodeURIComponent(code.trim())}`);
              void redeem(code);
            }}
          >
            <label className="flex flex-col gap-2 text-sm text-mut">
              {t("pilot.code")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="NYA-1A2B3C"
                className="glass h-14 rounded-2xl px-4 text-center font-mono text-xl tracking-[.2em] text-white outline-none placeholder:text-white/30"
              />
            </label>
            <ErrorNote error={error} />
            <Button disabled={code.trim().length < 4}>{t("pilot.join")}{me ? "" : " →"}</Button>
            <p className="text-center text-xs text-mut">
              No code? <Link href="/makers" className="inline-flex min-h-11 items-center underline">Browse makers</Link>
            </p>
          </form>
        )}
      </main>
    </Screen>
  );
}
