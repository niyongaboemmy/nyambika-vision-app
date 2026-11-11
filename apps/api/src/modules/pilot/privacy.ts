import { ANALYTICS_PROP_KEYS } from "@nyambika/contracts";
import { createHmac } from "node:crypto";
import { config } from "../../config";

/** Pure analytics privacy helpers (no Nest imports, so prisma/seed-pilot.ts can use them too). */

const SALT = process.env.ANALYTICS_SALT ?? `${config.jwtSecret}:analytics:v1`;
const PROP_KEYS = new Set<string>(ANALYTICS_PROP_KEYS);
/** Values that look like a phone number or e-mail are dropped (no PII in analytics). */
const PII = /(@|\+?\d[\d\s-]{7,}\d)/;

/** Pseudonymous analytics id: HMAC of the user id (or device id), not reversible without the salt. */
export function pseudonymise(id: string): string {
  return createHmac("sha256", SALT).update(id).digest("hex").slice(0, 32);
}

/** Keep only allow-listed keys with short, non-identifying primitive values. */
export function sanitizeProps(props: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (!PROP_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 64 && !PII.test(v)) out[k] = v;
  }
  return out;
}
