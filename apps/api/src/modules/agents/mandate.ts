import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * User-mandate token for agent-initiated checkouts (FR-AGT-04, AP2-style "cart mandate").
 * Nyambika signs the exact cart (maker, items, total, expiry) the agent asked for; the shopper confirms
 * that cart in Nyambika. The token is single-use (a nonce consumed atomically in the database) and expires.
 *
 * Token: base64url(JSON payload) + "." + base64url(HMAC-SHA-256(payload)).
 */
export interface MandatePayload {
  v: 1;
  /** checkout session id */
  sid: string;
  /** single-use nonce, stored on the session */
  n: string;
  pageId: string;
  totalRwf: number;
  /** sha256 of the canonical item list */
  ih: string;
  /** expiry, unix seconds */
  exp: number;
}

export interface MandateItem {
  variantId: string;
  size: string;
  qty: number;
  unitPriceRwf: number;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function itemsHash(items: MandateItem[]) {
  const canonical = items
    .map((i) => `${i.variantId}|${i.size}|${i.qty}|${i.unitPriceRwf}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export const newNonce = () => randomBytes(16).toString("hex");

function mac(body: string, secret: string) {
  return createHmac("sha256", `mandate:${secret}`).update(body).digest();
}

export function signMandate(p: Omit<MandatePayload, "v">, secret: string) {
  const body = b64u(JSON.stringify({ v: 1, ...p }));
  return `${body}.${b64u(mac(body, secret))}`;
}

export type MandateCheck = { ok: true; payload: MandatePayload } | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/** Verify signature and expiry. Single-use is enforced by the caller against the stored nonce. */
export function verifyMandate(token: string, secret: string, now = Date.now()): MandateCheck {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "MALFORMED" };
  const expected = mac(body, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "BAD_SIGNATURE" };
  let payload: MandatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MandatePayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (payload.v !== 1 || typeof payload.exp !== "number") return { ok: false, reason: "MALFORMED" };
  if (payload.exp * 1000 <= now) return { ok: false, reason: "EXPIRED" };
  return { ok: true, payload };
}
