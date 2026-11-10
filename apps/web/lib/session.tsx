"use client";

import { translate, type Locale, type MessageKey } from "@nyambika/i18n";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  locale: Locale;
  isHost: boolean;
  hasTwin: boolean;
  twinSize: string | null;
  roles: { role: string; page: { id: string; handle: string; name: string; memberType: string } | null }[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  locale: Locale;
  setLocale: (l: Locale) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  t: (k: MessageKey) => string;
}

const Ctx = createContext<SessionValue | null>(null);

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem("nya_locale");
    return v === "rw" || v === "en" || v === "fr" ? v : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocaleState] = useState<Locale>("en");

  const reload = useCallback(async () => {
    try {
      let r = await api<{ user: Me | null }>("/auth/me");
      if (!r.user) {
        // Access token may have expired: try a silent refresh once.
        const ok = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
          .then((x) => x.json())
          .then((b) => b.ok === true)
          .catch(() => false);
        if (ok) r = await api<{ user: Me | null }>("/auth/me");
      }
      setMe(r.user);
      if (r.user && !storedLocale()) setLocaleState(r.user.locale);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const l = storedLocale();
    if (l) setLocaleState(l);
    void reload();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [reload]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      try {
        localStorage.setItem("nya_locale", l);
      } catch {}
      if (me) void api("/auth/me", { method: "PATCH", json: { locale: l } }).catch(() => {});
    },
    [me],
  );

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ me, loading, locale, setLocale, reload, signOut, t: (k) => translate(locale, k) }),
    [me, loading, locale, setLocale, reload, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
