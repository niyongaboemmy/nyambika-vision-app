import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../../config";

/** Assisted mode (E31): a cooperative admin acts for a maker only with the maker's recorded, time-limited consent. */

export const ASSIST_SCOPES = ["PRODUCTS", "ORDERS"] as const;
export type AssistScope = (typeof ASSIST_SCOPES)[number];
export const ASSIST_DAYS = 30;
export const CODE_TTL_MIN = 15;
export const MAX_CODE_ATTEMPTS = 5;

export interface GrantLike {
  status: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type AssistCheck = { ok: true } | { ok: false; reason: "NO_CONSENT" | "PENDING" | "REVOKED" | "EXPIRED" | "OUT_OF_SCOPE" };

/** Pure gate for every on-behalf action. */
export function assistAllowed(grant: GrantLike | null | undefined, scope: AssistScope, now = new Date()): AssistCheck {
  if (!grant) return { ok: false, reason: "NO_CONSENT" };
  if (grant.revokedAt || grant.status === "REVOKED" || grant.status === "DENIED") return { ok: false, reason: "REVOKED" };
  if (grant.status === "PENDING") return { ok: false, reason: "PENDING" };
  if (grant.status !== "ACTIVE") return { ok: false, reason: "NO_CONSENT" };
  if (!grant.expiresAt || grant.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "EXPIRED" };
  if (!grant.scopes.includes(scope)) return { ok: false, reason: "OUT_OF_SCOPE" };
  return { ok: true };
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashCode = (grantId: string, code: string) => createHmac("sha256", config.jwtSecret).update(`assist:${grantId}:${code}`).digest("hex");

export type CodeCheck = { ok: true } | { ok: false; reason: "EXPIRED" | "LOCKED" | "WRONG" | "NOT_PENDING" };

/** Pure check of the code the maker read out to the admin. */
export function checkCode(g: { id: string; status: string; codeHash: string; attempts: number; createdAt: Date }, code: string, now = new Date()): CodeCheck {
  if (g.status !== "PENDING") return { ok: false, reason: "NOT_PENDING" };
  if (now.getTime() - g.createdAt.getTime() > CODE_TTL_MIN * 60_000) return { ok: false, reason: "EXPIRED" };
  if (g.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "LOCKED" };
  const a = Buffer.from(hashCode(g.id, code.trim()), "hex");
  const b = Buffer.from(g.codeHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "WRONG" };
}

export const CONSENT_TEXT = {
  rw: (admin: string, coop: string, days: number) => `Nemereye ${admin} wa ${coop} kumfasha gushyiraho imyenda no kwemeza komande mu izina ryanjye iminsi ${days}. Nshobora kubihagarika igihe cyose.`,
  en: (admin: string, coop: string, days: number) => `I allow ${admin} of ${coop} to add products and accept orders on my behalf for ${days} days. I can stop this at any time.`,
  fr: (admin: string, coop: string, days: number) => `J'autorise ${admin} de ${coop} à ajouter des produits et accepter des commandes en mon nom pendant ${days} jours. Je peux arrêter à tout moment.`,
};
