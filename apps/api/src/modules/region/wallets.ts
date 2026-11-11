import { Logger } from "@nestjs/common";
import type { CurrencyCode, Wallet } from "@nyambika/contracts";
import { randomUUID } from "node:crypto";
import { config } from "../../config";
import { sign } from "../payments/providers";

export interface WalletPayRequest {
  method: Wallet;
  amountMinor: number;
  currency: CurrencyCode;
  payerPhone: string;
  /** The maker's own till / merchant number (OP-2: money goes straight to the maker). */
  merchant: string;
  reference: string;
  note: string;
}

export type WalletStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

/** Regional mobile-money adapter (M-Pesa STK push, MoMo/Airtel outside Rwanda). */
export interface WalletProvider {
  readonly name: string;
  push(req: WalletPayRequest): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<WalletStatus>;
}

/**
 * Local simulator for M-Pesa (and MoMo/Airtel in other currencies): the STK push shows up as a
 * simulated prompt in the order screen (dev only), and the "provider" calls our webhook with an
 * HMAC signature. Auto-approves after MOCK_AUTO_APPROVE_MS so demos complete.
 */
export class MockWalletProvider implements WalletProvider {
  readonly name = "wallet-mock";
  private log = new Logger("MockWallet");
  private decided = new Map<string, WalletStatus>();
  constructor(private webhookUrl = `${config.selfUrl}/region/webhook/wallet-mock`) {}

  async push(req: WalletPayRequest) {
    const providerRef = `${req.method === "MPESA" ? "MPESA" : "WLT"}-MOCK-${randomUUID()}`;
    this.log.log(`${req.method} push → ${req.payerPhone}: pay ${req.currency} minor ${req.amountMinor} to till ${req.merchant} (${req.note})`);
    if (config.mockAutoApproveMs > 0) {
      setTimeout(() => {
        if (!this.decided.has(providerRef)) void this.decide(providerRef, true);
      }, config.mockAutoApproveMs).unref();
    }
    return { providerRef };
  }

  async status(providerRef: string) {
    return this.decided.get(providerRef) ?? "PENDING";
  }

  async decide(providerRef: string, approve: boolean) {
    if (this.decided.has(providerRef)) return this.decided.get(providerRef)!;
    const status: WalletStatus = approve ? "SUCCESSFUL" : "FAILED";
    this.decided.set(providerRef, status);
    const body = JSON.stringify({ referenceId: providerRef, status, receipt: approve ? `RX${Date.now().toString(36).toUpperCase()}` : null });
    await fetch(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-signature": sign(body) }, body }).catch((e) =>
      this.log.error(`webhook delivery failed: ${(e as Error).message}`),
    );
    return status;
  }
}

/**
 * Safaricom Daraja M-Pesa Express (STK push) to the maker's own till (BuyGoods). Needs MPESA_CONSUMER_KEY,
 * MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_BASE_URL. Stub: not exercised locally
 * (no credentials), and the per-maker till model needs Safaricom's approval before use (ADR-0006).
 */
export class DarajaMpesaProvider implements WalletProvider {
  readonly name = "mpesa-daraja";
  private base = process.env.MPESA_BASE_URL ?? "https://sandbox.safaricom.co.ke";

  private async token() {
    const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { authorization: `Basic ${basic}` } });
    if (!res.ok) throw new Error(`Daraja token ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async push(req: WalletPayRequest) {
    if (req.currency !== "KES" && req.currency !== "TZS") throw new Error("M-Pesa charges KES/TZS only");
    const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const shortcode = process.env.MPESA_SHORTCODE ?? "";
    const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${ts}`).toString("base64");
    const res = await fetch(`${this.base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerBuyGoodsOnline",
        // Daraja takes whole shillings; minor units are converted exactly (prices are whole shillings).
        Amount: Math.floor(req.amountMinor / 100),
        PartyA: req.payerPhone.replace(/\D/g, ""),
        PartyB: req.merchant,
        PhoneNumber: req.payerPhone.replace(/\D/g, ""),
        CallBackURL: `${config.selfUrl}/region/webhook/mpesa`,
        AccountReference: req.reference,
        TransactionDesc: req.note.slice(0, 13),
      }),
    });
    if (!res.ok) throw new Error(`Daraja STK ${res.status}`);
    return { providerRef: ((await res.json()) as { CheckoutRequestID: string }).CheckoutRequestID };
  }

  async status(): Promise<WalletStatus> {
    return "PENDING"; // the callback is authoritative; STK query is not wired in this stub
  }
}
