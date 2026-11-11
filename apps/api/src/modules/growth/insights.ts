/** Insights v2 + ✨ suggestions (FR-ANL-01/03). Pure rules; the optional LLM only rephrases them. */

export type Locale = "rw" | "en" | "fr";

export interface ProductFact {
  id: string;
  title: string;
  priceRwf: number;
  colours: number;
  looks: number;
  sales: number;
  ready: boolean;
}

export interface InsightFacts {
  products: ProductFact[];
  /** Maker Space visits by source tag (wa_status, qr_card, … or "direct"). */
  sources: Record<string, number>;
  /** Activity (visits + try-ons) per Kigali hour 0..23. */
  hours: number[];
  optedInFollowers: number;
  daysSinceBroadcast: number | null;
  activeOffers: number;
}

export interface Suggestion {
  key: string;
  tone: "violet" | "gold" | "mint" | "sky";
  text: string;
  /** Deep link inside the studio the card can open. */
  action?: { label: string; href: string };
  productId?: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function bestHours(hours: number[], n = 2): number[] {
  return hours
    .map((v, h) => ({ v, h }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.h - b.h)
    .slice(0, n)
    .map((x) => x.h);
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const T = {
  lowConv: {
    en: (t: string, l: number, s: number) => `“${t}” gets many try-ons (${l}) but few sales (${s}). Try a lower price, a time-boxed offer or more colours.`,
    fr: (t: string, l: number, s: number) => `« ${t} » est beaucoup essayée (${l}) mais peu vendue (${s}). Essayez un prix plus bas, une offre limitée ou plus de couleurs.`,
    rw: (t: string, l: number, s: number) => `“${t}” irageragezwa cyane (${l}) ariko igurwa gake (${s}). Gerageza kugabanya igiciro, igabanuka ry'igihe gito cyangwa amabara menshi.`,
  },
  oneColour: {
    en: (t: string) => `Shoppers like “${t}”. Add a second colour so more of them find one they love.`,
    fr: (t: string) => `« ${t} » plaît. Ajoutez une deuxième couleur pour en séduire davantage.`,
    rw: (t: string) => `Abaguzi bakunda “${t}”. Ongeraho irindi bara kugira ngo benshi babone iryo bakunda.`,
  },
  noLooks: {
    en: (t: string) => `Nobody tried “${t}” this month. A brighter photo or a story card could wake it up.`,
    fr: (t: string) => `Personne n'a essayé « ${t} » ce mois-ci. Une photo plus claire ou une story peut la relancer.`,
    rw: (t: string) => `Nta muntu wagerageje “${t}” uku kwezi. Ifoto isobanutse cyangwa ikarita ya status byayifasha.`,
  },
  whatsapp: {
    en: (s: string) => `Only ${s} of your visits come from WhatsApp. Post a story card on your Status: it's the busiest door in Rwanda.`,
    fr: (s: string) => `Seulement ${s} de vos visites viennent de WhatsApp. Publiez une story sur votre Statut.`,
    rw: (s: string) => `${s} gusa by'abasura page yawe baturuka kuri WhatsApp. Shyira ikarita kuri Status yawe.`,
  },
  hours: {
    en: (a: string, b?: string) => `Most shoppers visit around ${a}${b ? ` and ${b}` : ""}. Post your stories just before.`,
    fr: (a: string, b?: string) => `La plupart des clients passent vers ${a}${b ? ` et ${b}` : ""}. Publiez juste avant.`,
    rw: (a: string, b?: string) => `Abaguzi benshi basura ahagana ${a}${b ? ` na ${b}` : ""}. Shyiraho amakuru mbere gato.`,
  },
  followers: {
    en: (n: number) => `${n} followers asked for WhatsApp updates. Tell them about your new pieces.`,
    fr: (n: number) => `${n} abonnés veulent vos nouveautés sur WhatsApp. Annoncez vos nouvelles pièces.`,
    rw: (n: number) => `Abakurikira ${n} basabye amakuru kuri WhatsApp. Bamenyeshe imyenda mishya.`,
  },
  retake: {
    en: (t: string) => `“${t}” can't be tried on yet. Retake the photo flat, in daylight.`,
    fr: (t: string) => `« ${t} » ne peut pas encore être essayée. Reprenez la photo à plat, en lumière du jour.`,
    rw: (t: string) => `“${t}” ntirashobora kugeragezwa. Ongera ufotore uyirambitse, ku manywa.`,
  },
  allGood: {
    en: () => `Things look good. Keep sharing your Maker Space link: every share is a new door.`,
    fr: () => `Tout va bien. Continuez à partager votre lien : chaque partage ouvre une porte.`,
    rw: () => `Ibintu bimeze neza. Komeza usangize link ya page yawe.`,
  },
};

const LBL = {
  offer: { en: "Create an offer", fr: "Créer une offre", rw: "Shyiraho igabanuka" },
  colour: { en: "Add a colour", fr: "Ajouter une couleur", rw: "Ongeraho ibara" },
  card: { en: "Make a story card", fr: "Créer une story", rw: "Kora ikarita" },
  broadcast: { en: "Send an update", fr: "Envoyer", rw: "Ohereza amakuru" },
  photo: { en: "Retake photo", fr: "Reprendre", rw: "Ongera ufotore" },
};

/** Rule-based suggestions, most valuable first, at most `max`. */
export function suggest(f: InsightFacts, locale: Locale, base: string, max = 4): Suggestion[] {
  const out: Suggestion[] = [];
  const grow = `${base}/grow`;
  // 1. Many try-ons, few sales (the FR-ANL-03 example).
  const lowConv = f.products
    .filter((p) => p.looks >= 8 && p.sales / p.looks < 0.05)
    .sort((a, b) => b.looks - a.looks)[0];
  if (lowConv)
    out.push({ key: `lowconv:${lowConv.id}`, tone: "violet", productId: lowConv.id, text: T.lowConv[locale](lowConv.title, lowConv.looks, lowConv.sales), action: { label: LBL.offer[locale], href: `${grow}?tab=offers&product=${lowConv.id}` } });
  // 2. Popular single-colour piece.
  const single = f.products.filter((p) => p.colours === 1 && p.looks >= 5 && p.id !== lowConv?.id).sort((a, b) => b.looks - a.looks)[0];
  if (single) out.push({ key: `colour:${single.id}`, tone: "sky", productId: single.id, text: T.oneColour[locale](single.title), action: { label: LBL.colour[locale], href: `${base}/products/${single.id}` } });
  // 3. Not try-on ready.
  const notReady = f.products.find((p) => !p.ready);
  if (notReady) out.push({ key: `retake:${notReady.id}`, tone: "gold", productId: notReady.id, text: T.retake[locale](notReady.title), action: { label: LBL.photo[locale], href: `${base}/products/${notReady.id}` } });
  // 4. Ready but nobody tried it.
  const cold = f.products.find((p) => p.ready && p.looks === 0);
  if (cold) out.push({ key: `cold:${cold.id}`, tone: "gold", productId: cold.id, text: T.noLooks[locale](cold.title), action: { label: LBL.card[locale], href: `${grow}?tab=share&product=${cold.id}` } });
  // 5. WhatsApp share of traffic.
  const total = Object.values(f.sources).reduce((s, v) => s + v, 0);
  const wa = Object.entries(f.sources).filter(([k]) => k.startsWith("wa_") || k === "broadcast").reduce((s, [, v]) => s + v, 0);
  if (total >= 10 && wa / total < 0.2) out.push({ key: "whatsapp", tone: "mint", text: T.whatsapp[locale](pct(wa / total)), action: { label: LBL.card[locale], href: `${grow}?tab=share` } });
  // 6. Followers waiting for news.
  if (f.optedInFollowers > 0 && (f.daysSinceBroadcast === null || f.daysSinceBroadcast >= 14))
    out.push({ key: "followers", tone: "mint", text: T.followers[locale](f.optedInFollowers), action: { label: LBL.broadcast[locale], href: `${grow}?tab=broadcast` } });
  // 7. Best posting time.
  const [h1, h2] = bestHours(f.hours);
  if (h1 !== undefined && f.hours.reduce((s, v) => s + v, 0) >= 10) out.push({ key: "hours", tone: "sky", text: T.hours[locale](hh(h1), h2 !== undefined ? hh(h2) : undefined) });
  if (!out.length) out.push({ key: "ok", tone: "mint", text: T.allGood[locale]() });
  return out.slice(0, max);
}

/** Kigali is UTC+2 all year (no DST). */
export const kigaliHour = (d: Date) => (d.getUTCHours() + 2) % 24;
