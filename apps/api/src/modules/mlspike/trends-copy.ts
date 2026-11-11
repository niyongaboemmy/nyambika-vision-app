import type { GapItem, PriceHint, RisingItem } from "./trends";

/** Rule-based trend sentences in RW / EN / FR (the LLM may rephrase them; numbers are kept). */
export type Locale = "rw" | "en" | "fr";

const COLOUR: Record<string, Record<Locale, string>> = {
  gold: { rw: "zahabu", en: "gold", fr: "or" },
  indigo: { rw: "indigo", en: "indigo", fr: "indigo" },
  teal: { rw: "icyatsi-ubururu", en: "teal", fr: "bleu canard" },
  crimson: { rw: "umutuku", en: "crimson", fr: "cramoisi" },
  terracotta: { rw: "ibara ry'ibumba", en: "terracotta", fr: "terre cuite" },
  "forest-green": { rw: "icyatsi kibisi", en: "forest green", fr: "vert forêt" },
  "royal-purple": { rw: "move", en: "royal purple", fr: "violet royal" },
  black: { rw: "umukara", en: "black", fr: "noir" },
};
const OCCASION: Record<string, Record<Locale, string>> = {
  wedding: { rw: "ubukwe", en: "weddings", fr: "les mariages" },
  church: { rw: "gusenga", en: "church", fr: "l'église" },
  party: { rw: "ibirori", en: "parties", fr: "les fêtes" },
  office: { rw: "akazi", en: "the office", fr: "le bureau" },
  casual: { rw: "buri munsi", en: "everyday wear", fr: "le quotidien" },
  graduation: { rw: "isozwa ry'amashuri", en: "graduations", fr: "les remises de diplômes" },
};
const CATEGORY: Record<string, Record<Locale, string>> = {
  dress: { rw: "amakanzu", en: "dresses", fr: "robes" },
  umushanana: { rw: "imishanana", en: "umushanana", fr: "umushanana" },
  shirt: { rw: "amashati", en: "shirts", fr: "chemises" },
  skirt: { rw: "amajipo", en: "skirts", fr: "jupes" },
  trousers: { rw: "amapantalo", en: "trousers", fr: "pantalons" },
};
const PATTERN: Record<string, Record<Locale, string>> = {
  imigongo: { rw: "imigongo", en: "imigongo", fr: "imigongo" },
  kitenge: { rw: "igitenge", en: "kitenge", fr: "kitenge" },
  wax: { rw: "wax", en: "wax print", fr: "wax" },
  solid: { rw: "ibara rimwe", en: "plain colours", fr: "unis" },
};

const t = (m: Record<string, Record<Locale, string>>, v: string, l: Locale) => m[v]?.[l] ?? v;
export const labelOf = (dim: "colour" | "pattern" | "occasion" | "category", v: string, l: Locale) =>
  t(dim === "colour" ? COLOUR : dim === "pattern" ? PATTERN : dim === "occasion" ? OCCASION : CATEGORY, v, l);

const where = (r: string, l: Locale) => (r === "ALL" ? { rw: "mu Rwanda hose", en: "across Rwanda", fr: "dans tout le Rwanda" }[l] : { rw: `i ${r}`, en: `in ${r}`, fr: `à ${r}` }[l]);

export function risingText(r: RisingItem, l: Locale) {
  const pct = Math.round(r.growth * 100);
  const v = labelOf(r.dimension, r.value, l);
  if (r.dimension === "occasion")
    return { rw: `Abashaka imyenda y'${v} biyongereyeho ${pct}% ${where(r.region, l)} mu byumweru 2 bishize.`, en: `Shoppers asking for ${v} outfits are up ${pct}% ${where(r.region, l)} over the last 2 weeks.`, fr: `Les demandes pour ${v} ont augmenté de ${pct} % ${where(r.region, l)} ces 2 dernières semaines.` }[l];
  return { rw: `${v[0].toUpperCase()}${v.slice(1)} irazamuka: +${pct}% ${where(r.region, l)} mu byumweru 2 bishize.`, en: `${v[0].toUpperCase()}${v.slice(1)} is rising: +${pct}% ${where(r.region, l)} over the last 2 weeks.`, fr: `${v[0].toUpperCase()}${v.slice(1)} est en hausse : +${pct} % ${where(r.region, l)} ces 2 dernières semaines.` }[l];
}

export function gapText(g: GapItem, l: Locale) {
  const c = labelOf("colour", g.colour, l);
  const cat = labelOf("category", g.category, l);
  const occ = g.occasion ? labelOf("occasion", g.occasion, l) : null;
  const makers = g.makers === 0 ? { rw: "nta mudozi", en: "no maker", fr: "aucun créateur" }[l] : g.makers === 1 ? { rw: "umudozi 1 gusa", en: "only 1 maker", fr: "un seul créateur" }[l] : { rw: `abadozi ${g.makers} gusa`, en: `only ${g.makers} makers`, fr: `seulement ${g.makers} créateurs` }[l];
  return {
    rw: `Abantu ≈${g.asks} basabye ${cat} by'${c}${occ ? ` by'${occ}` : ""} mu byumweru 4, ariko ${makers} ni bo babifite.`,
    en: `About ${g.asks} shoppers asked for ${c} ${cat}${occ ? ` for ${occ}` : ""} in 4 weeks, but ${makers} offer${g.makers === 1 ? "s" : ""} it.`,
    fr: `Environ ${g.asks} clients ont demandé des ${cat} ${c}${occ ? ` pour ${occ}` : ""} en 4 semaines, mais ${makers} en propose${g.makers > 1 ? "nt" : ""}.`,
  }[l];
}

export function priceText(h: PriceHint, l: Locale) {
  const cat = labelOf("category", h.category, l);
  return {
    rw: `${cat[0].toUpperCase()}${cat.slice(1)} biri hagati ya ${h.best} bigurwa inshuro ${h.lift} kurusha ibiri ${h.worst} nyuma yo kubigerageza.`,
    en: `${cat[0].toUpperCase()}${cat.slice(1)} priced ${h.best} turn try-ons into orders ${h.lift}× as often as ${h.worst}.`,
    fr: `Les ${cat} à ${h.best} transforment les essayages en commandes ${h.lift}× plus souvent qu'à ${h.worst}.`,
  }[l];
}
