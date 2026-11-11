/**
 * Money (E40/E41) without zod, so browser bundles can format prices without pulling in schema code.
 * Integer minor units + ISO 4217 code; FX conversion is exact BigInt arithmetic with half-even rounding.
 * Re-exported from the package root (`region.ts`); browser code imports `@nyambika/contracts/money`.
 */
// ---------------------------------------------------------------- currencies

export const CURRENCY_CODES = ["RWF", "KES", "UGX", "TZS", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** ISO 4217 exponents (RWF and UGX have no minor unit; Stripe treats them as zero-decimal too). */
export const CURRENCIES: Record<CurrencyCode, { exponent: number; name: string; symbol: string }> = {
  RWF: { exponent: 0, name: "Rwandan franc", symbol: "RWF" },
  KES: { exponent: 2, name: "Kenyan shilling", symbol: "KES" },
  UGX: { exponent: 0, name: "Ugandan shilling", symbol: "UGX" },
  TZS: { exponent: 2, name: "Tanzanian shilling", symbol: "TZS" },
  USD: { exponent: 2, name: "US dollar", symbol: "USD" },
  EUR: { exponent: 2, name: "Euro", symbol: "EUR" },
};

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export function isCurrency(c: string): c is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(c);
}

function assertMinor(n: number) {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Money must be an integer number of minor units (got ${n})`);
}

/** "4,500.50" / "4500.5" → 450050 for KES. Rejects more decimals than the currency allows. */
export function parseMajor(input: string, currency: CurrencyCode): number {
  const exp = CURRENCIES[currency].exponent;
  const s = input.trim().replace(/[,\s_]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`Not an amount: "${input}"`);
  const frac = m[3] ?? "";
  if (frac.length > exp) throw new RangeError(`${currency} has ${exp} decimal place(s)`);
  const minor = BigInt(m[2] + frac.padEnd(exp, "0"));
  const n = Number(m[1] ? -minor : minor);
  assertMinor(n);
  return n;
}

/** Minor units → plain major string without grouping ("4500.50"). */
export function toMajorString(amountMinor: number, currency: CurrencyCode): string {
  assertMinor(amountMinor);
  const exp = CURRENCIES[currency].exponent;
  const neg = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exp + 1, "0");
  const whole = exp ? digits.slice(0, -exp) : digits;
  const frac = exp ? digits.slice(-exp) : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** "KES 4,500" (cents only shown when non-zero, unless `cents: true`). Integer-only formatting. */
export function formatMoney(amountMinor: number, currency: CurrencyCode, opts: { cents?: boolean; approx?: boolean } = {}): string {
  const major = toMajorString(Math.abs(amountMinor), currency);
  const [whole, frac = ""] = major.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showFrac = frac && (opts.cents || /[1-9]/.test(frac));
  return `${opts.approx ? "≈ " : ""}${amountMinor < 0 ? "−" : ""}${CURRENCIES[currency].symbol} ${grouped}${showFrac ? `.${frac}` : ""}`;
}

/** Integer division of BigInts with round-half-even (banker's rounding). */
export function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("Division by zero");
  if (den < 0n) return divRoundHalfEven(-num, -den);
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = a / den;
  const r = a - q * den;
  const twice = r * 2n;
  let out = q;
  if (twice > den || (twice === den && q % 2n === 1n)) out = q + 1n;
  return neg ? -out : out;
}

/** Decimal rate string ("129.5") → exact rational. */
export function parseRate(rate: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new RangeError(`Bad rate "${rate}"`);
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw new RangeError("Rate must be positive");
  return { num, den: 10n ** BigInt(frac.length) };
}

/** Units of `quote` per 1 USD, as decimal strings (FxRate rows). USD itself is implicitly "1". */
export type RateTable = Partial<Record<CurrencyCode, string>>;

/**
 * Convert minor units between currencies via USD cross rates, exactly, rounding once (half-even).
 * Used for "≈" display only; never to compute a charge.
 */
export function convertMinor(amountMinor: number, from: CurrencyCode, to: CurrencyCode, rates: RateTable): number {
  assertMinor(amountMinor);
  if (from === to) return amountMinor;
  const rFrom = parseRate(from === "USD" ? "1" : (rates[from] ?? missing(from)));
  const rTo = parseRate(to === "USD" ? "1" : (rates[to] ?? missing(to)));
  const eFrom = 10n ** BigInt(CURRENCIES[from].exponent);
  const eTo = 10n ** BigInt(CURRENCIES[to].exponent);
  // to_minor = from_minor / eFrom / rateFrom * rateTo * eTo
  const num = BigInt(amountMinor) * rTo.num * rFrom.den * eTo;
  const den = rTo.den * rFrom.num * eFrom;
  const n = Number(divRoundHalfEven(num, den));
  assertMinor(n);
  return n;
}

function missing(c: string): never {
  throw new RangeError(`No FX rate for ${c}`);
}

/** Basis-point share of an amount (e.g. VAT 1600 bp = 16%), half-even. */
export function shareBp(amountMinor: number, bp: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bp)) throw new RangeError("bp must be an integer");
  return Number(divRoundHalfEven(BigInt(amountMinor) * BigInt(bp), 10_000n));
}

/** VAT contained in a VAT-inclusive price (price × bp / (10000 + bp)), half-even. */
export function vatIncluded(amountMinor: number, bp: number): number {
  assertMinor(amountMinor);
  return Number(divRoundHalfEven(BigInt(amountMinor) * BigInt(bp), 10_000n + BigInt(bp)));
}

export function sumMinor(...amounts: number[]): number {
  const n = amounts.reduce((a, b) => a + b, 0);
  assertMinor(n);
  return n;
}

/** Display line for a price: the charge in the maker's currency plus an optional "≈" in the shopper's currency. */
export function displayPrice(charge: Money, display: CurrencyCode | null | undefined, rates: RateTable | null | undefined) {
  const primary = formatMoney(charge.amountMinor, charge.currency);
  if (!display || display === charge.currency || !rates) return { primary, approx: null as string | null, approxMinor: null as number | null };
  try {
    const approxMinor = convertMinor(charge.amountMinor, charge.currency, display, rates);
    return { primary, approx: formatMoney(approxMinor, display, { approx: true }), approxMinor };
  } catch {
    return { primary, approx: null, approxMinor: null };
  }
}
