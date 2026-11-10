import { Logger } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { config } from "../../config";

export interface PayRequest {
  amountRwf: number;
  payerPhone: string;
  merchant: string;
  reference: string;
  wallet: "MTN_MOMO" | "AIRTEL_MONEY";
  note: string;
}

export type PayStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

/** Mobile Money adapter (ADR-0002). Money always goes to the maker's own merchant account (OP-2). */
export interface PaymentProvider {
  readonly name: string;
  requestToPay(req: PayRequest): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<PayStatus>;
}

export function sign(body: string) {
  return createHmac("sha256", config.webhookSecret).update(body).digest("hex");
}

/**
 * Local MoMo/Airtel simulator: the push lands on a simulated handset (/dev/handset) where the
 * shopper approves with a PIN; the "provider" then calls our webhook with an HMAC signature.
 * If nobody acts, it auto-approves after MOCK_AUTO_APPROVE_MS so demos complete.
 */
export class MockMomoProvider implements PaymentProvider {
  readonly name = "mock";
  private log = new Logger("MockMoMo");
  private decided = new Map<string, PayStatus>();

  async requestToPay(req: PayRequest) {
    const providerRef = `MOCK-${randomUUID()}`;
    this.log.log(`USSD push → ${req.payerPhone}: pay RWF ${req.amountRwf} to ${req.merchant} (${req.note})`);
    if (config.mockAutoApproveMs > 0) {
      setTimeout(() => {
        if (!this.decided.has(providerRef)) void this.decide(providerRef, true);
      }, config.mockAutoApproveMs).unref();
    }
    return { providerRef };
  }

  async status(providerRef: string): Promise<PayStatus> {
    return this.decided.get(providerRef) ?? "PENDING";
  }

  /** Called by the simulated handset; posts a signed webhook like the real provider would. */
  async decide(providerRef: string, approve: boolean) {
    if (this.decided.has(providerRef)) return this.decided.get(providerRef)!;
    const status: PayStatus = approve ? "SUCCESSFUL" : "FAILED";
    this.decided.set(providerRef, status);
    const body = JSON.stringify({ referenceId: providerRef, status, financialTransactionId: approve ? `FT${Date.now()}` : null });
    await fetch(`${config.selfUrl}/payments/webhook/mock`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(body) },
      body,
    }).catch((e) => this.log.error(`webhook delivery failed: ${(e as Error).message}`));
    return status;
  }
}

/**
 * MTN MoMo Collections (sandbox/production). Needs MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY,
 * MTN_TARGET_ENV and MTN_BASE_URL. Not exercised locally (no credentials); see ADR-0002.
 */
export class MtnMomoProvider implements PaymentProvider {
  readonly name = "mtn";
  private base = process.env.MTN_BASE_URL ?? "https://sandbox.momodeveloper.mtn.com";
  private env = process.env.MTN_TARGET_ENV ?? "sandbox";
  private key = process.env.MTN_SUBSCRIPTION_KEY ?? "";

  private async token() {
    const basic = Buffer.from(`${process.env.MTN_API_USER}:${process.env.MTN_API_KEY}`).toString("base64");
    const res = await fetch(`${this.base}/collection/token/`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "Ocp-Apim-Subscription-Key": this.key },
    });
    if (!res.ok) throw new Error(`MTN token ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async requestToPay(req: PayRequest) {
    const providerRef = randomUUID();
    const res = await fetch(`${this.base}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "X-Reference-Id": providerRef,
        "X-Target-Environment": this.env,
        "X-Callback-Url": `${config.selfUrl}/payments/webhook/mtn`,
        "Ocp-Apim-Subscription-Key": this.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: String(req.amountRwf),
        currency: this.env === "sandbox" ? "EUR" : "RWF",
        externalId: req.reference,
        payer: { partyIdType: "MSISDN", partyId: req.payerPhone.replace(/\D/g, "") },
        payerMessage: req.note.slice(0, 160),
        payeeNote: req.reference,
      }),
    });
    if (res.status !== 202) throw new Error(`MTN requesttopay ${res.status}`);
    return { providerRef };
  }

  async status(providerRef: string): Promise<PayStatus> {
    const res = await fetch(`${this.base}/collection/v1_0/requesttopay/${providerRef}`, {
      headers: { authorization: `Bearer ${await this.token()}`, "X-Target-Environment": this.env, "Ocp-Apim-Subscription-Key": this.key },
    });
    const body = (await res.json()) as { status: string };
    return body.status === "SUCCESSFUL" ? "SUCCESSFUL" : body.status === "FAILED" ? "FAILED" : "PENDING";
  }
}
