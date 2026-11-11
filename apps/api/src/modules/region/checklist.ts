import { isCurrency, REGIONS, type RegionCode } from "@nyambika/contracts";

export interface ChecklistItem {
  key: string;
  label: string;
  kind: "auto" | "manual";
  done: boolean;
  detail: string;
  by?: string | null;
  at?: string | null;
}

export const MANUAL_ITEMS: { key: string; label: string }[] = [
  { key: "regulator", label: "Wallet / payment regulator approval for direct-to-maker tills" },
  { key: "dataProtection", label: "Data-protection registration (e.g. ODPC Kenya, PDPO Uganda, PDPC Tanzania)" },
  { key: "counsel", label: "Counsel sign-off: terms, legal entity and tax texts" },
  { key: "language", label: "Native-speaker review of the language catalogue" },
  { key: "support", label: "In-country support line and dispute contact" },
  { key: "residencyInfra", label: "Regional bucket + database provisioned (ADR-0006)" },
];

type Manual = Record<string, { done?: boolean; by?: string; at?: string; note?: string }>;

/** Country launch checklist (E41): automatic config checks + manual sign-offs. Pure for testing. */
export function launchChecklist(
  cfg: { code: string; currency: string; wallets: string[]; languages: string[]; taxNote: string; legalEntity: string; storageBucket: string; dbSchema: string; checklist: unknown },
  ctx: { fxFresh: boolean; pages: number; swCatalogue: boolean },
): { items: ChecklistItem[]; ready: boolean } {
  const code = cfg.code as RegionCode;
  const draft = (s: string) => !s.trim() || /^draft/i.test(s.trim());
  const manual = (cfg.checklist ?? {}) as Manual;
  const items: ChecklistItem[] = [
    { key: "currency", label: "Currency and FX rate", kind: "auto", done: isCurrency(cfg.currency) && ctx.fxFresh, detail: ctx.fxFresh ? `${cfg.currency} with a rate from the last 24 h` : `No fresh ${cfg.currency} rate` },
    { key: "wallets", label: "Mobile wallets configured", kind: "auto", done: cfg.wallets.length > 0, detail: cfg.wallets.join(", ") || "none" },
    { key: "phones", label: "Phone format and validation", kind: "auto", done: Boolean(REGIONS[code]), detail: REGIONS[code] ? `+${REGIONS[code].dialCode} · e.g. ${REGIONS[code].phoneExample}` : "unknown country" },
    { key: "languages", label: "Languages available", kind: "auto", done: cfg.languages.length > 0 && (!cfg.languages.includes("sw") || ctx.swCatalogue), detail: cfg.languages.join(", ") },
    { key: "tax", label: "Tax / VAT note final", kind: "auto", done: !draft(cfg.taxNote), detail: draft(cfg.taxNote) ? "still a draft" : "final" },
    { key: "legal", label: "Legal entity text final", kind: "auto", done: !draft(cfg.legalEntity), detail: draft(cfg.legalEntity) ? "still a draft" : "final" },
    { key: "residency", label: "Residency route set", kind: "auto", done: Boolean(cfg.storageBucket && cfg.dbSchema), detail: `${cfg.storageBucket} · schema ${cfg.dbSchema}` },
    { key: "pilotPages", label: "At least one pilot maker page", kind: "auto", done: ctx.pages > 0, detail: `${ctx.pages} page(s)` },
    ...MANUAL_ITEMS.map((m) => ({ key: m.key, label: m.label, kind: "manual" as const, done: Boolean(manual[m.key]?.done), detail: manual[m.key]?.note ?? "", by: manual[m.key]?.by ?? null, at: manual[m.key]?.at ?? null })),
  ];
  return { items, ready: items.every((i) => i.done) };
}
