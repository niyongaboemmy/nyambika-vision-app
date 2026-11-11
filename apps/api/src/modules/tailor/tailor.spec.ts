import {
  canProgress,
  depositSplit,
  morphPrice,
  MorphTemplateInput,
  offered,
  quantizeHue,
  recommendSize,
  shareActive,
  shareExpiry,
  twinSizeRecommendation,
  type SizeChartRow,
} from "@nyambika/contracts";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, openMeasurements, sealMeasurements } from "./crypto";
import { normaliseSpec, specKey } from "./morph";

const template = MorphTemplateInput.parse({
  colourDeltaRwf: 3000,
  baseLength: "knee",
  baseSleeve: "short",
  lengths: { mini: 0, knee: 0, midi: 2000, maxi: 5000 },
  sleeves: { sleeveless: 0, short: 0, elbow: 1500, long: 3000 },
});

describe("morph pricing (E23)", () => {
  it("base options cost the base price", () => {
    expect(morphPrice(28000, template, { hue: null, length: null, sleeve: null })).toEqual({ totalRwf: 28000, lines: [] });
    expect(morphPrice(28000, template, { hue: null, length: "knee", sleeve: "short" }).totalRwf).toBe(28000);
  });

  it("adds tailor-set deltas for colour, length and sleeves", () => {
    const p = morphPrice(28000, template, { hue: 210, length: "maxi", sleeve: "long" });
    expect(p.totalRwf).toBe(28000 + 3000 + 5000 + 3000);
    expect(p.lines.map((l) => l.label)).toEqual(["Custom colour", "Maxi length", "Long sleeves"]);
  });

  it("zero deltas add no line; negative deltas discount but never below zero", () => {
    expect(morphPrice(28000, template, { hue: null, length: "mini", sleeve: "sleeveless" }).lines).toEqual([]);
    const cheap = MorphTemplateInput.parse({ ...template, lengths: { mini: -50000, knee: 0 } });
    expect(morphPrice(28000, cheap, { hue: null, length: "mini", sleeve: null }).totalRwf).toBe(0);
  });

  it("rejects options the tailor does not offer", () => {
    const limited = MorphTemplateInput.parse({ baseLength: "knee", lengths: { knee: 0, midi: 1000 }, sleeves: { short: 0 } });
    expect(() => morphPrice(20000, limited, { hue: null, length: "maxi", sleeve: null })).toThrow(/isn't offered/);
    expect(() => morphPrice(20000, limited, { hue: null, length: null, sleeve: "long" })).toThrow(/aren't offered/);
    expect(offered(["mini", "knee", "midi", "maxi"] as const, "knee", limited.lengths)).toEqual(["knee", "midi"]);
  });

  it("colour is free when the tailor turned the ring off, and the spec drops it", () => {
    const noColour = MorphTemplateInput.parse({ ...template, colourEnabled: false });
    const spec = normaliseSpec({ hue: 100, length: "knee", sleeve: "long" }, noColour);
    expect(spec).toEqual({ hue: null, length: null, sleeve: "long" });
    expect(morphPrice(28000, noColour, spec).totalRwf).toBe(31000);
  });

  it("hue snaps to the ring step so nearby drags share a cache key", () => {
    expect(quantizeHue(209)).toBe(210);
    expect(quantizeHue(359)).toBe(0);
    expect(quantizeHue(-8)).toBe(345);
    const a = normaliseSpec({ hue: 203, length: "maxi", sleeve: "short" }, template);
    const b = normaliseSpec({ hue: 208, length: "maxi", sleeve: null }, template);
    expect(specKey(a)).toBe(specKey(b));
    expect(specKey(a)).toBe("h210|lmaxi|s-");
  });
});

const chart: SizeChartRow[] = [
  { size: "S", bustCm: [80, 86], waistCm: [62, 68], hipsCm: [86, 92] },
  { size: "M", bustCm: [87, 93], waistCm: [69, 75], hipsCm: [93, 99] },
  { size: "L", bustCm: [94, 101], waistCm: [76, 83], hipsCm: [100, 107] },
  { size: "XL", bustCm: [102, 110], waistCm: [84, 92], hipsCm: [108, 116] },
];

describe("size recommendation (E32, FR-SIZE-02)", () => {
  it("exact fit → high confidence", () => {
    const r = recommendSize({ bustCm: 90, waistCm: 72, hipsCm: 96 }, chart, "dress")!;
    expect(r).toMatchObject({ size: "M", confidence: "high", basis: "PROFILE" });
    expect(r.notes).toEqual(["True to your measurements"]);
  });

  it("snug at hips → recommends the size that fits the tightest area and notes it", () => {
    // Bust/waist say M, hips say L: tightness weighs more than looseness, so L, roomy at bust.
    const r = recommendSize({ bustCm: 89, waistCm: 74, hipsCm: 103 }, chart, "dress")!;
    expect(r.size).toBe("L");
    expect(r.notes.join(" ")).toMatch(/Roomy at bust/);
  });

  it("slightly over the largest-fitting range → snug note pointing up", () => {
    const r = recommendSize({ bustCm: 92, waistCm: 74, hipsCm: 100 }, ["S", "M"].map((s) => chart.find((c) => c.size === s)!), "dress")!;
    expect(r.size).toBe("M");
    expect(r.notes[0]).toBe("Snug at hips");
    expect(r.confidence).toBe("medium");
    const r2 = recommendSize({ bustCm: 92, waistCm: 74, hipsCm: 100 }, chart, "dress", ["M", "L"]);
    expect(r2!.size).toBe("M");
    expect(r2!.notes).toContain("Snug at hips; consider L");
  });

  it("“snug at hips; consider L” when M is clearly better elsewhere", () => {
    const r = recommendSize({ bustCm: 86, waistCm: 69, hipsCm: 100 }, chart, "dress")!;
    expect(r.size).toBe("M");
    expect(r.notes).toContain("Snug at hips; consider L");
  });

  it("uses only the relevant measurements per category", () => {
    // A skirt ignores the bust.
    expect(recommendSize({ bustCm: 120, waistCm: 66, hipsCm: 90 }, chart, "skirt")!.size).toBe("S");
    // Missing chart columns or measurements → no recommendation.
    expect(recommendSize({ heightCm: 165 }, chart, "dress")).toBeNull();
    expect(recommendSize({ bustCm: 90 }, [{ size: "M" }], "dress")).toBeNull();
  });

  it("respects the sizes the variant actually offers", () => {
    const r = recommendSize({ bustCm: 83, waistCm: 64, hipsCm: 88 }, chart, "dress", ["M", "L", "XL"])!;
    expect(r.size).toBe("M");
    expect(r.notes.join(" ")).toMatch(/Roomy/);
  });

  it("falls back to the twin estimate with low confidence", () => {
    expect(twinSizeRecommendation("M", ["S", "M", "L"])).toMatchObject({ size: "M", basis: "TWIN", confidence: "low" });
    expect(twinSizeRecommendation("XXL", ["S", "M"])).toBeNull();
    expect(twinSizeRecommendation(null, ["S"])).toBeNull();
  });
});

describe("measurement share expiry (FR-SIZE-04)", () => {
  const t0 = new Date("2026-11-11T08:00:00Z");
  it("defaults to 14 days, clamps to 1..60", () => {
    expect(shareExpiry(t0).toISOString()).toBe("2026-11-25T08:00:00.000Z");
    expect(shareExpiry(t0, 0).getTime() - t0.getTime()).toBe(86400_000);
    expect(shareExpiry(t0, 365).getTime() - t0.getTime()).toBe(60 * 86400_000);
  });
  it("is active until expiry or revocation", () => {
    const s = { expiresAt: shareExpiry(t0), revokedAt: null };
    expect(shareActive(s, new Date("2026-11-24T23:59:00Z"))).toBe(true);
    expect(shareActive(s, new Date("2026-11-25T08:00:00Z"))).toBe(false);
    expect(shareActive({ ...s, revokedAt: new Date("2026-11-12T00:00:00Z") }, new Date("2026-11-13T00:00:00Z"))).toBe(false);
  });
});

describe("custom order money and progress (E24)", () => {
  it("splits deposit and balance in whole hundreds", () => {
    expect(depositSplit(43000, 50)).toEqual({ depositRwf: 21500, balanceRwf: 21500 });
    expect(depositSplit(33333, 30)).toEqual({ depositRwf: 10000, balanceRwf: 23333 });
    expect(depositSplit(25000, 100)).toEqual({ depositRwf: 25000, balanceRwf: 0 });
  });
  it("progress only moves forward after the deposit", () => {
    expect(canProgress("DEPOSIT_PAID", "CUTTING")).toBe(true);
    expect(canProgress("CUTTING", "FITTING")).toBe(true);
    expect(canProgress("SEWING", "CUTTING")).toBe(false);
    expect(canProgress("QUOTED", "CUTTING")).toBe(false);
    expect(canProgress("READY", "READY")).toBe(false);
  });
});

describe("field-level encryption", () => {
  const key = randomBytes(32);
  it("round-trips and uses a fresh IV per field", () => {
    const a = encryptField("90", key);
    const b = encryptField("90", key);
    expect(a).not.toBe(b);
    expect(decryptField(a, key)).toBe("90");
    const sealed = sealMeasurements({ bustCm: 90, hipsCm: 97.5 }, key);
    expect(Object.keys(sealed)).toEqual(["bustCm", "hipsCm"]);
    expect(JSON.stringify(sealed)).not.toMatch(/97\.5/);
    expect(openMeasurements(sealed, key)).toEqual({ bustCm: 90, hipsCm: 97.5 });
  });
  it("detects tampering and wrong keys", () => {
    const s = encryptField("72", key);
    const [v, iv, tag, ct] = s.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() => decryptField([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
    expect(() => decryptField(s, randomBytes(32))).toThrow();
  });
});
