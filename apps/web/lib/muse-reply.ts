import type { Intent } from "@nyambika/contracts";
import type { Locale } from "@nyambika/i18n";

/**
 * The Muse's short spoken answer (E22): one sentence that confirms what it understood.
 * Built from the parsed intent so it is grounded (no free-form LLM speech). RW/FR need native review.
 */
const OCCASION: Record<Locale, Record<string, string>> = {
  en: { wedding: "a wedding", "traditional-ceremony": "a traditional ceremony", office: "the office", church: "church", party: "a party", graduation: "a graduation", casual: "every day" },
  rw: { wedding: "ubukwe", "traditional-ceremony": "umuhango gakondo", office: "akazi", church: "urusengero", party: "ibirori", graduation: "kurangiza amashuri", casual: "buri munsi" },
  fr: { wedding: "un mariage", "traditional-ceremony": "une cérémonie traditionnelle", office: "le bureau", church: "l'église", party: "une fête", graduation: "une remise de diplômes", casual: "tous les jours" },
  sw: {}, // E41: Swahili replies fall back to English wording until reviewed
};

const money = (n: number) => n.toLocaleString("en-US");

export function museReply(i: Intent, locale: Locale, signedIn: boolean): string {
  const occ = i.occasion ? (OCCASION[locale][i.occasion] ?? OCCASION.en[i.occasion] ?? i.occasion) : null;
  const budget = i.budgetMax;
  if (locale === "rw") {
    const what = occ ? `imyenda yo ${occ === "ubukwe" ? "mu bukwe" : `mu ${occ}`}` : "imyenda";
    return `Numvise: ${what}${budget ? `, munsi ya ${money(budget)} RWF` : ""}. ${signedIn ? "Dore uko bigaragara ukwambaye." : "Injira urebe uko bigaragara ukwambaye."}`;
  }
  if (locale === "fr") {
    const what = occ ? `une tenue pour ${occ}` : "une tenue";
    return `Compris : ${what}${budget ? `, à moins de ${money(budget)} francs` : ""}. ${signedIn ? "Voici des looks sur vous." : "Connectez-vous pour les voir sur vous."}`;
  }
  const what = occ ? `something for ${occ}` : "something you'll love";
  return `Got it: ${what}${budget ? `, under ${money(budget)} francs` : ""}. ${signedIn ? "Here are looks on you." : "Sign in to see them on you."}`;
}
