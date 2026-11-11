import { Logger } from "@nestjs/common";
import { CURRENCIES, type CurrencyCode } from "@nyambika/contracts";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../config";

/**
 * Stripe Connect for export orders (FR-ORD-08). DIRECT charges: every PaymentIntent and refund is
 * created on the maker's connected account (Stripe-Account header), with no application fee, so the
 * money settles to the maker and Nyambika never collects (central collection is off, CON-08).
 */
export interface StripeIntent {
  id: string;
  clientSecret: string;
  status: string;
}

export interface StripeAdapter {
  readonly mode: "mock" | "test" | "live";
  readonly publishableKey: string | null;
  createAccount(country: string, email?: string): Promise<{ id: string; onboardingUrl: string | null }>;
  accountReady(accountId: string): Promise<boolean>;
  createIntent(p: { account: string; amountMinor: number; currency: CurrencyCode; reference: string; description: string; receiptEmail?: string }): Promise<StripeIntent>;
  refund(p: { account: string; paymentIntent: string; amountMinor: number }): Promise<{ id: string; status: string }>;
}

/** Stripe's amount unit equals ISO minor units for our currencies (RWF/UGX are zero-decimal in both). */
export function stripeAmount(amountMinor: number, currency: CurrencyCode) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new RangeError("Stripe amount must be a positive integer");
  void CURRENCIES[currency];
  return amountMinor;
}

// ------------------------------------------------------------------ webhook signatures

export const STRIPE_TOLERANCE_SEC = 300;

export function stripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || "whsec_dev_mock_only";
}

/** Build a `Stripe-Signature` header exactly like Stripe does (t=…,v1=HMAC_SHA256(secret, `${t}.${payload}`)). */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Verify a Stripe webhook signature header against the raw body (constant-time, with replay tolerance). */
export function verifyStripeSignature(payload: string | Buffer, header: string | undefined, secret: string, now = Math.floor(Date.now() / 1000)): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !sigs.length) return { ok: false, reason: "malformed signature" };
  if (Math.abs(now - t) > STRIPE_TOLERANCE_SEC) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${t}.${payload.toString()}`).digest();
  const match = sigs.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export interface StripeEventBody {
  id: string;
  type: string;
  /** Connected account the event belongs to (Connect webhooks). */
  account?: string;
  data: { object: { id: string; object: string; status?: string; amount?: number; amount_refunded?: number; currency?: string; payment_intent?: string; metadata?: Record<string, string>; last_payment_error?: { message?: string } } };
}

// ------------------------------------------------------------------ mock adapter

/**
 * Offline stand-in used when STRIPE_SECRET_KEY is absent: intents live in memory, the mock Payment
 * Element confirms through `/region/stripe/mock/confirm`, and this adapter then posts a correctly
 * signed Connect webhook to our own endpoint, so the full signature + routing path runs locally.
 */
export class MockStripeAdapter implements StripeAdapter {
  readonly mode = "mock" as const;
  readonly publishableKey = null;
  private log = new Logger("MockStripe");
  readonly intents = new Map<string, { account: string; amountMinor: number; currency: CurrencyCode; status: string; clientSecret: string; reference: string }>();

  constructor(private webhookUrl = `${config.selfUrl}/stripe/webhook`) {}

  async createAccount() {
    return { id: `acct_mock_${randomBytes(6).toString("hex")}`, onboardingUrl: null };
  }
  async accountReady(accountId: string) {
    return accountId.startsWith("acct_mock_");
  }

  async createIntent(p: { account: string; amountMinor: number; currency: CurrencyCode; reference: string }) {
    const id = `pi_mock_${randomBytes(8).toString("hex")}`;
    const clientSecret = `${id}_secret_${randomBytes(8).toString("hex")}`;
    this.intents.set(id, { account: p.account, amountMinor: stripeAmount(p.amountMinor, p.currency), currency: p.currency, status: "requires_payment_method", clientSecret, reference: p.reference });
    return { id, clientSecret, status: "requires_payment_method" };
  }

  async refund(p: { account: string; paymentIntent: string; amountMinor: number }) {
    const pi = this.intents.get(p.paymentIntent);
    if (pi && pi.account !== p.account) throw new Error("No such payment_intent on this account");
    return { id: `re_mock_${randomBytes(6).toString("hex")}`, status: "succeeded" };
  }

  /** Test cards: 4242… succeeds, 4000 0000 0000 0002 is declined. */
  async confirm(clientSecret: string, card: string) {
    const entry = [...this.intents.entries()].find(([, v]) => v.clientSecret === clientSecret);
    if (!entry) throw new Error("Unknown client secret");
    const [id, pi] = entry;
    if (pi.status === "succeeded") return { status: pi.status };
    const digits = card.replace(/\D/g, "");
    const ok = digits !== "4000000000000002" && luhn(digits);
    pi.status = ok ? "succeeded" : "requires_payment_method";
    const event: StripeEventBody = {
      id: `evt_mock_${randomBytes(8).toString("hex")}`,
      type: ok ? "payment_intent.succeeded" : "payment_intent.payment_failed",
      account: pi.account,
      data: { object: { id, object: "payment_intent", status: pi.status, amount: pi.amountMinor, currency: pi.currency.toLowerCase(), metadata: { reference: pi.reference }, ...(ok ? {} : { last_payment_error: { message: "Your card was declined." } }) } },
    };
    const body = JSON.stringify(event);
    const res = await fetch(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signStripePayload(body, stripeWebhookSecret()) }, body }).catch((e) => {
      this.log.error(`webhook delivery failed: ${(e as Error).message}`);
      return null;
    });
    if (res && !res.ok) this.log.error(`webhook rejected: ${res.status}`);
    return { status: pi.status, error: ok ? null : "Your card was declined." };
  }
}

export function luhn(d: string) {
  if (!/^\d{12,19}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

// ------------------------------------------------------------------ real adapter (test or live keys)

/** Stripe REST over fetch (no SDK). Used when STRIPE_SECRET_KEY is set; not exercised in CI. */
export class HttpStripeAdapter implements StripeAdapter {
  readonly mode: "test" | "live";
  readonly publishableKey: string | null;
  constructor(private secret: string) {
    this.mode = secret.startsWith("sk_live_") ? "live" : "test";
    this.publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? null;
  }

  private async call<T>(path: string, form: Record<string, string>, account?: string, method = "POST"): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(account ? { "Stripe-Account": account } : {}),
        "Idempotency-Key": form.__idem ?? randomBytes(12).toString("hex"),
      },
      body: method === "GET" ? undefined : new URLSearchParams(Object.entries(form).filter(([k]) => k !== "__idem")).toString(),
    });
    const body = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${body.error?.message ?? "error"}`);
    return body;
  }

  async createAccount(country: string, email?: string) {
    const acct = await this.call<{ id: string }>("/accounts", { type: "express", country, ...(email ? { email } : {}), "capabilities[card_payments][requested]": "true", "capabilities[transfers][requested]": "true" });
    const link = await this.call<{ url: string }>("/account_links", { account: acct.id, refresh_url: `${config.webUrl}/studio`, return_url: `${config.webUrl}/studio`, type: "account_onboarding" });
    return { id: acct.id, onboardingUrl: link.url };
  }

  async accountReady(accountId: string) {
    const a = await this.call<{ charges_enabled: boolean }>(`/accounts/${accountId}`, {}, undefined, "GET");
    return a.charges_enabled;
  }

  async createIntent(p: { account: string; amountMinor: number; currency: CurrencyCode; reference: string; description: string; receiptEmail?: string }) {
    const pi = await this.call<{ id: string; client_secret: string; status: string }>(
      "/payment_intents",
      {
        amount: String(stripeAmount(p.amountMinor, p.currency)),
        currency: p.currency.toLowerCase(),
        "automatic_payment_methods[enabled]": "true",
        description: p.description.slice(0, 200),
        "metadata[reference]": p.reference,
        __idem: `pi-${p.reference}`,
        // No application_fee_amount: the platform takes nothing from the maker's charge.
      },
      p.account,
    );
    return { id: pi.id, clientSecret: pi.client_secret, status: pi.status };
  }

  async refund(p: { account: string; paymentIntent: string; amountMinor: number }) {
    return this.call<{ id: string; status: string }>("/refunds", { payment_intent: p.paymentIntent, amount: String(p.amountMinor) }, p.account);
  }
}
