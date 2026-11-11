import {
  convertMinor,
  countryOfPhone,
  displayPrice,
  divRoundHalfEven,
  formatMoney,
  normalizePhone,
  parseMajor,
  PassportData,
  passportDiff,
  passportUri,
  pickZone,
  rankByRegion,
  shareBp,
  toMajorString,
  validatePassport,
  vatIncluded,
} from "@nyambika/contracts";
import { describe, expect, it } from "vitest";
import { launchChecklist } from "./checklist";
import { DEV_FIXED_RATES, trimRate } from "./fx";
import { pageWallets, stripeAction } from "./region.service";
import { regionalKey, routeFor } from "./residency";
import { luhn, MockStripeAdapter, signStripePayload, stripeAmount, verifyStripeSignature, type StripeEventBody } from "./stripe";

describe("currency math (minor units, no floats)", () => {
  it("parses and prints amounts per ISO exponent", () => {
    expect(parseMajor("4,500", "KES")).toBe(450_000);
    expect(parseMajor("4500.5", "KES")).toBe(450_050);
    expect(parseMajor("12 000", "RWF")).toBe(12_000);
    expect(() => parseMajor("1.5", "RWF")).toThrow(/0 decimal/);
    expect(() => parseMajor("1.005", "USD")).toThrow(/2 decimal/);
    expect(() => parseMajor("abc", "USD")).toThrow();
    expect(toMajorString(5, "USD")).toBe("0.05");
    expect(toMajorString(450_050, "KES")).toBe("4500.50");
    expect(formatMoney(450_000, "KES")).toBe("KES 4,500");
    expect(formatMoney(450_050, "KES")).toBe("KES 4,500.50");
    expect(formatMoney(1_234_567, "UGX")).toBe("UGX 1,234,567");
    expect(formatMoney(3475, "USD", { approx: true })).toBe("≈ USD 34.75");
  });

  it("refuses non-integer money", () => {
    expect(() => formatMoney(0.1 + 0.2, "USD")).toThrow(/integer/);
    expect(() => convertMinor(10.5, "USD", "KES", DEV_FIXED_RATES)).toThrow(/integer/);
    expect(() => shareBp(100, 12.5)).toThrow();
  });

  it("rounds half to even, exactly, with BigInt", () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);
    expect(divRoundHalfEven(-5n, 2n)).toBe(-2n);
    expect(divRoundHalfEven(10n, 4n)).toBe(2n);
    expect(divRoundHalfEven(11n, 4n)).toBe(3n);
    expect(shareBp(1_000, 1_650)).toBe(165);
    expect(shareBp(5, 5_000)).toBe(2); // 2.5 → 2 (even)
    expect(shareBp(15, 5_000)).toBe(8); // 7.5 → 8 (even)
    expect(vatIncluded(116_000, 1_600)).toBe(16_000); // KES 1,160 incl. 16% VAT
  });

  it("converts across exponents via USD cross rates", () => {
    // 1 USD = 129.5 KES = 1420 RWF  →  KES 4,500 = 4500 / 129.5 * 1420 = 49 343.629… RWF
    expect(convertMinor(450_000, "KES", "RWF", DEV_FIXED_RATES)).toBe(49_344);
    expect(convertMinor(450_000, "KES", "USD", DEV_FIXED_RATES)).toBe(3_475); // 34.749… → 34.75
    expect(convertMinor(100, "USD", "KES", DEV_FIXED_RATES)).toBe(12_950);
    expect(convertMinor(1_420, "RWF", "USD", DEV_FIXED_RATES)).toBe(100);
    expect(convertMinor(368_000, "UGX", "TZS", DEV_FIXED_RATES)).toBe(26_500_000); // 100 USD each side
    expect(convertMinor(777, "TZS", "TZS", {})).toBe(777);
    expect(() => convertMinor(100, "USD", "KES", {})).toThrow(/No FX rate/);
    // 0.1 + 0.2 style drift cannot happen: a large amount round-trips through exact rationals
    expect(convertMinor(9_007_199_254_740, "RWF", "RWF", DEV_FIXED_RATES)).toBe(9_007_199_254_740);
  });

  it("trims DB decimal text", () => {
    expect(trimRate("129.500000000000")).toBe("129.5");
    expect(trimRate("1420.000000000000")).toBe("1420");
  });
});

describe("FX display vs charge", () => {
  it("shows ≈ in the shopper's currency but keeps the charge in the maker's", () => {
    const charge = { amountMinor: 450_000, currency: "KES" as const };
    const d = displayPrice(charge, "USD", DEV_FIXED_RATES);
    expect(d.primary).toBe("KES 4,500");
    expect(d.approx).toBe("≈ USD 34.75");
    expect(charge.amountMinor).toBe(450_000); // the charge object is never mutated
    expect(displayPrice(charge, "KES", DEV_FIXED_RATES).approx).toBeNull();
    expect(displayPrice(charge, "EUR", {}).approx).toBeNull(); // no rate → no guess
  });
});

describe("regions: phone validation per country", () => {
  it.each([
    ["RW", "0788 123 456", "+250788123456"],
    ["RW", "+250 722 123 456", "+250722123456"],
    ["KE", "0712 345 678", "+254712345678"],
    ["KE", "254110123456", "+254110123456"],
    ["UG", "0772-123-456", "+256772123456"],
    ["TZ", "0754123456", "+255754123456"],
    ["TZ", "+255 654 123 456", "+255654123456"],
  ] as const)("%s accepts %s", (c, input, e164) => {
    const r = normalizePhone(input, c);
    expect(r.ok && r.e164).toBe(e164);
  });

  it.each([
    ["RW", "0712 345 678"], // Kenyan-looking prefix
    ["KE", "+250788123456"], // wrong country code
    ["KE", "0812345678"],
    ["UG", "077212345"], // too short
    ["TZ", "0854123456"],
  ] as const)("%s rejects %s with a hint", (c, input) => {
    const r = normalizePhone(input, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/look like|Use a/);
  });

  it("detects the country of an E.164 number", () => {
    expect(countryOfPhone("+254712345678")).toBe("KE");
    expect(countryOfPhone("+250788123456")).toBe("RW");
    expect(countryOfPhone("+15551234567")).toBeNull();
  });

  it("offers only wallets the country allows and the maker has", () => {
    expect(pageWallets("KE", { momo: "", airtel: "", mpesaTill: "5123456" })).toEqual(["MPESA"]);
    expect(pageWallets("RW", { momo: "0788100001", airtel: "", mpesaTill: "5123456" })).toEqual(["MTN_MOMO", "AIRTEL_MONEY"]); // no M-Pesa in RW
    expect(pageWallets("UG", { momo: "", airtel: "", mpesaTill: "" })).toEqual([]);
  });
});

describe("region-aware ranking", () => {
  const pages = [
    { id: "ke1", region: "KE" as const, crossBorder: true },
    { id: "rw1", region: "RW" as const, crossBorder: false },
    { id: "ke2", region: "KE" as const, crossBorder: false },
    { id: "rw2", region: "RW" as const, crossBorder: true },
    { id: "ug1", region: "UG" as const, crossBorder: true },
  ];
  it("shows only the shopper's country by default", () => {
    expect(rankByRegion(pages, { country: "RW", crossBorder: false }).map((p) => p.id)).toEqual(["rw1", "rw2"]);
    expect(rankByRegion(pages, { country: "KE", crossBorder: false }).map((p) => p.id)).toEqual(["ke1", "ke2"]);
  });
  it("adds opted-in foreign makers after home ones when the shopper opts in", () => {
    const r = rankByRegion(pages, { country: "RW", crossBorder: true });
    expect(r.map((p) => p.id)).toEqual(["rw1", "rw2", "ke1", "ug1"]); // ke2 didn't opt in
    expect(r.filter((p) => p.crossBorderListing).map((p) => p.id)).toEqual(["ke1", "ug1"]);
  });
});

describe("shipping zones", () => {
  const zones = [
    { id: "ea", name: "East Africa", countries: ["RW", "UG"], currency: "KES" as const, feeMinor: 120_000, etaDays: 4, active: true },
    { id: "eu", name: "Europe", countries: ["DE", "GB"], currency: "KES" as const, feeMinor: 450_000, etaDays: 8, active: false },
    { id: "row", name: "World", countries: ["*"], currency: "KES" as const, feeMinor: 600_000, etaDays: 12, active: true },
  ];
  it("picks the listed zone, then rest of world, skipping inactive ones", () => {
    expect(pickZone(zones, "ug")?.id).toBe("ea");
    expect(pickZone(zones, "DE")?.id).toBe("row");
    expect(pickZone(zones.slice(0, 2), "US")).toBeNull();
  });
});

describe("Stripe webhooks (signature + connected-account routing, mock)", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

  it("verifies Stripe-format signatures over the raw body", () => {
    const header = signStripePayload(body, secret, 1_700_000_000);
    expect(verifyStripeSignature(body, header, secret, 1_700_000_100)).toEqual({ ok: true });
    expect(verifyStripeSignature(body + " ", header, secret, 1_700_000_100)).toMatchObject({ ok: false, reason: "signature mismatch" });
    expect(verifyStripeSignature(body, header, "whsec_other", 1_700_000_100)).toMatchObject({ ok: false });
    expect(verifyStripeSignature(body, header, secret, 1_700_000_000 + 301)).toMatchObject({ ok: false, reason: "timestamp outside tolerance" });
    expect(verifyStripeSignature(body, undefined, secret)).toMatchObject({ ok: false, reason: "missing signature" });
    expect(verifyStripeSignature(body, "t=abc", secret)).toMatchObject({ ok: false, reason: "malformed signature" });
    // Stripe may send several v1 signatures during secret rotation
    const two = `${header},v1=${"0".repeat(64)}`;
    expect(verifyStripeSignature(body, two, secret, 1_700_000_000)).toEqual({ ok: true });
  });

  const payment = { connectedAccount: "acct_maker", amountMinor: 450_000, currency: "KES", status: "PENDING" };
  const ev = (o: Partial<StripeEventBody>): StripeEventBody => ({ id: "evt", type: "payment_intent.succeeded", account: "acct_maker", data: { object: { id: "pi_1", object: "payment_intent", amount: 450_000, currency: "kes" } }, ...o });

  it("settles only events from the maker's own connected account, for the exact amount", () => {
    expect(stripeAction(ev({}), payment)).toEqual({ kind: "settle", status: "SUCCESSFUL" });
    expect(stripeAction(ev({ account: "acct_someone_else" }), payment)).toEqual({ kind: "ignore", reason: "account mismatch" });
    expect(stripeAction(ev({ account: undefined }), payment)).toMatchObject({ kind: "ignore" }); // platform-account event
    expect(stripeAction(ev({ data: { object: { id: "pi_1", object: "payment_intent", amount: 1, currency: "kes" } } }), payment)).toMatchObject({ kind: "ignore", reason: "amount or currency mismatch" });
    expect(stripeAction(ev({ type: "payment_intent.payment_failed" }), payment)).toEqual({ kind: "settle", status: "FAILED" });
    expect(stripeAction(ev({ type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", amount_refunded: 1000, payment_intent: "pi_1" } } }), payment)).toEqual({ kind: "refund", refundedMinor: 1000 });
    expect(stripeAction(ev({}), null)).toMatchObject({ kind: "ignore", reason: "unknown payment" });
  });

  it("mock adapter creates intents on the connected account and refuses cross-account refunds", async () => {
    const m = new MockStripeAdapter("http://127.0.0.1:9/never");
    const pi = await m.createIntent({ account: "acct_a", amountMinor: 5000, currency: "USD", reference: "NY-1" });
    expect(pi.clientSecret.startsWith(`${pi.id}_secret_`)).toBe(true);
    expect(m.intents.get(pi.id)?.account).toBe("acct_a");
    await expect(m.refund({ account: "acct_b", paymentIntent: pi.id, amountMinor: 100 })).rejects.toThrow();
    expect((await m.refund({ account: "acct_a", paymentIntent: pi.id, amountMinor: 100 })).status).toBe("succeeded");
    expect(() => stripeAmount(0, "USD")).toThrow();
    expect(luhn("4242424242424242")).toBe(true);
    expect(luhn("4242424242424241")).toBe(false);
  });
});

describe("Digital Product Passport", () => {
  const base = PassportData.parse({ materials: [{ fibre: "Cotton", percent: 100 }] });

  it("validates fibre composition and repair services", () => {
    expect(validatePassport(base)).toEqual([]);
    expect(validatePassport({ ...base, materials: [{ fibre: "Cotton", percent: 60, origin: "", recycled: false }, { fibre: "Linen", percent: 30, origin: "", recycled: false }] })[0]).toMatch(/90%/);
    expect(validatePassport({ ...base, materials: [{ fibre: "Cotton", percent: 50, origin: "", recycled: false }, { fibre: "cotton", percent: 50, origin: "", recycled: false }] })[0]).toMatch(/once/);
    expect(validatePassport({ ...base, repair: { offered: true, services: [], contact: "" } })[0]).toMatch(/repair/);
    expect(validatePassport({ ...base, production: { date: "Oct 2026", batch: "" } })[0]).toMatch(/date/);
  });

  it("diffs versions by field", () => {
    expect(passportDiff(null, base)).toEqual(["first version"]);
    expect(passportDiff(base, base)).toEqual([]);
    expect(passportDiff(base, { ...base, care: ["Hand wash"] })).toEqual(["care"]);
  });

  it("builds GS1 Digital Link-style URIs", () => {
    expect(passportUri("https://nyambika.rw/", "p1")).toBe("https://nyambika.rw/p/p1");
    expect(passportUri("https://nyambika.rw", "p1", "6001234567890")).toBe("https://nyambika.rw/01/06001234567890");
  });
});

describe("data residency routing seam", () => {
  it("keeps everything home when off, prefixes regional buckets in prefix mode", () => {
    expect(routeFor("KE", "off")).toMatchObject({ bucket: "nyambika-ke-nbo", dbSchema: "region_ke", storagePrefix: "", applied: false, database: "home" });
    const ke = routeFor("KE", "prefix");
    expect(ke.storagePrefix).toBe("regions/nyambika-ke-nbo/");
    expect(regionalKey(ke, "passports/p1/v1.json")).toBe("regions/nyambika-ke-nbo/passports/p1/v1.json");
    expect(regionalKey(ke, regionalKey(ke, "a.json"))).toBe("regions/nyambika-ke-nbo/a.json"); // idempotent
    expect(routeFor("RW", "prefix").storagePrefix).toBe(""); // home region stays put
    expect(routeFor("UG", "off", {}, { DATABASE_URL_UG: "postgresql://x" }).database).toBe("regional");
    expect(routeFor("TZ", "off", { bucket: "custom-tz" }).bucket).toBe("custom-tz");
  });
});

describe("country launch checklist", () => {
  const cfg = { code: "KE", currency: "KES", wallets: ["MPESA"], languages: ["sw", "en"], taxNote: "Draft: …", legalEntity: "Nyambika Kenya Ltd", storageBucket: "b", dbSchema: "s", checklist: {} };
  it("needs final texts and all manual sign-offs", () => {
    const r = launchChecklist(cfg, { fxFresh: true, pages: 1, swCatalogue: true });
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === "tax")?.done).toBe(false);
    expect(r.items.find((i) => i.key === "legal")?.done).toBe(true);
    const all = Object.fromEntries(r.items.filter((i) => i.kind === "manual").map((i) => [i.key, { done: true }]));
    expect(launchChecklist({ ...cfg, taxNote: "Prices include VAT", checklist: all }, { fxFresh: true, pages: 1, swCatalogue: true }).ready).toBe(true);
    expect(launchChecklist({ ...cfg, taxNote: "Prices include VAT", checklist: all }, { fxFresh: false, pages: 1, swCatalogue: true }).ready).toBe(false);
  });
});
