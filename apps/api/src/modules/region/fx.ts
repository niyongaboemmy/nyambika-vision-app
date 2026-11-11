import { Injectable, Logger } from "@nestjs/common";
import { CURRENCY_CODES, type CurrencyCode, type RateTable } from "@nyambika/contracts";
import { PrismaService } from "../../common/prisma.service";

/** FX source adapter. Rates are decimal strings: units of `quote` per 1 USD. */
export interface FxAdapter {
  readonly source: string;
  latest(): Promise<RateTable>;
}

/**
 * Dev adapter: fixed SYNTHETIC rates so the app and crawls work offline. Plausible magnitudes only,
 * not market data; never used when FX_PROVIDER is set to a real source.
 */
export const DEV_FIXED_RATES: RateTable = { RWF: "1420", KES: "129.5", UGX: "3680", TZS: "2650", EUR: "0.92" };

export class FixedFxAdapter implements FxAdapter {
  readonly source = "dev-fixed-synthetic";
  async latest() {
    return { ...DEV_FIXED_RATES };
  }
}

/**
 * Open Exchange Rates (USD base). Needs FX_API_KEY. Not exercised locally (no credentials).
 * Numbers arrive as JSON floats; we keep their decimal text (toString) and never compute with them.
 */
export class OpenExchangeRatesAdapter implements FxAdapter {
  readonly source = "openexchangerates";
  async latest(): Promise<RateTable> {
    const key = process.env.FX_API_KEY;
    if (!key) throw new Error("FX_API_KEY missing");
    const res = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(key)}&symbols=${CURRENCY_CODES.join(",")}`);
    if (!res.ok) throw new Error(`FX ${res.status}`);
    const text = await res.text();
    const out: RateTable = {};
    for (const c of CURRENCY_CODES) {
      if (c === "USD") continue;
      const m = new RegExp(`"${c}"\\s*:\\s*([0-9.]+)`).exec(text); // keep the decimal literal exactly
      if (m) out[c] = m[1];
    }
    return out;
  }
}

export interface FxSnapshot {
  base: "USD";
  rates: RateTable;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

const MAX_AGE_MS = 24 * 3600_000;

@Injectable()
export class FxService {
  private log = new Logger("FX");
  private cache: { at: number; snap: FxSnapshot } | null = null;

  constructor(private prisma: PrismaService) {}

  adapter(): FxAdapter {
    return process.env.FX_PROVIDER === "openexchangerates" ? new OpenExchangeRatesAdapter() : new FixedFxAdapter();
  }

  /** Fetch from the adapter and store one row per currency with source + timestamp. */
  async refresh(): Promise<FxSnapshot> {
    const a = this.adapter();
    const rates = await a.latest();
    const fetchedAt = new Date();
    await this.prisma.fxRate.createMany({
      data: Object.entries(rates).map(([quote, rate]) => ({ base: "USD", quote, rate: rate!, source: a.source, fetchedAt })),
    });
    this.cache = null;
    this.log.log(`rates refreshed from ${a.source}`);
    return this.snapshot();
  }

  /** Latest stored rate per currency from the active source; refreshes when empty or stale. */
  async snapshot(): Promise<FxSnapshot> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.snap;
    const source = this.adapter().source;
    const rows = await this.prisma.$queryRaw<{ quote: string; rate: string; fetchedAt: Date }[]>`
      SELECT DISTINCT ON (quote) quote, rate::text AS rate, "fetchedAt" FROM "FxRate"
      WHERE source = ${source} ORDER BY quote, "fetchedAt" DESC`;
    if (!rows.length) return this.refresh();
    const oldest = Math.min(...rows.map((r) => r.fetchedAt.getTime()));
    if (Date.now() - oldest > MAX_AGE_MS && source === "dev-fixed-synthetic") return this.refresh();
    const rates: RateTable = {};
    for (const r of rows) rates[r.quote as CurrencyCode] = trimRate(r.rate);
    const snap: FxSnapshot = { base: "USD", rates, source, fetchedAt: new Date(oldest).toISOString(), stale: Date.now() - oldest > MAX_AGE_MS };
    this.cache = { at: Date.now(), snap };
    return snap;
  }
}

/** "129.500000000000" → "129.5" */
export function trimRate(r: string) {
  return r.includes(".") ? r.replace(/0+$/, "").replace(/\.$/, "") : r;
}
