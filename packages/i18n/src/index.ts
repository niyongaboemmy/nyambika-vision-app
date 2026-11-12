/**
 * Kinyarwanda / English / French catalogues (FR-ACC-09), plus a Swahili starter catalogue (E41).
 * Kinyarwanda and French strings need native-speaker review before the pilot (plan §15.1 localisation).
 *
 * One file per locale (JS budget pass 2): `en.ts` is always bundled (it defines every key and is the fallback);
 * `rw.ts`, `fr.ts` and `sw.ts` load on demand through `loadLocale()`, so a route ships one catalogue instead of four.
 * New keys: add to `en.ts`, then append the translation at the end of `rw.ts`, `fr.ts` (and `sw.ts` if drafted).
 * `translate()` stays synchronous: for a locale that has not loaded yet it returns the English string.
 */
import { en, type Messages } from "./en.ts";

export type Locale = "rw" | "en" | "fr" | "sw";
export const LOCALES: Locale[] = ["rw", "en", "fr", "sw"];
export type MessageKey = keyof Messages;

/** Swahili is machine-drafted and not yet reviewed (country launch checklist item "language"). */
export const SW_MACHINE_DRAFTED = true;

/** Loaded catalogues. `rw`, `fr` and `sw` are empty until `loadLocale()` resolves for them. */
export const catalogues: Record<Locale, Partial<Messages>> = { en, rw: {}, fr: {}, sw: {} };

const loaders: Record<Exclude<Locale, "en">, () => Promise<Partial<Messages>>> = {
  rw: () => import("./rw.ts").then((m) => m.rw),
  fr: () => import("./fr.ts").then((m) => m.fr),
  sw: () => import("./sw.ts").then((m) => m.sw),
};
const pending = new Map<Locale, Promise<void>>();

/** True once `translate(locale, …)` returns that locale's own strings. */
export function isLocaleLoaded(locale: Locale): boolean {
  return locale === "en" || Object.keys(catalogues[locale] ?? {}).length > 0;
}

/** Fetches a locale's catalogue once (idempotent, safe to call early). Resolves when `translate` can use it. */
export function loadLocale(locale: Locale): Promise<void> {
  if (locale === "en" || !(locale in loaders)) return Promise.resolve();
  let p = pending.get(locale);
  if (!p) {
    p = loaders[locale as Exclude<Locale, "en">]()
      .then((c) => void (catalogues[locale] = c))
      .catch((e) => {
        pending.delete(locale); // a failed chunk fetch (offline) can be retried; English shows meanwhile
        throw e;
      });
    pending.set(locale, p);
  }
  return p;
}

export function translate(locale: Locale, key: MessageKey): string {
  return catalogues[locale]?.[key] ?? en[key] ?? key;
}
