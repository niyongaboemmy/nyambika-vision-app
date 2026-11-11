import { z } from "zod";
import { DEFAULT_SHARE_DAYS, MAX_SHARE_DAYS, MEASUREMENT_FIELDS, MEASUREMENT_LIMITS, MORPH_LENGTHS, MORPH_SLEEVES, type MeasurementField } from "./tailor-data";

// ==== E23 Live morph · E24 Tailor custom orders · E32 Size recommendation ====
// zod schemas (API validation). Pure logic lives in tailor-data.ts and is re-exported here unchanged.
export * from "./tailor-data";

export const MorphSpec = z.object({
  hue: z.number().min(0).max(360).nullable().default(null),
  length: z.enum(MORPH_LENGTHS).nullable().default(null),
  sleeve: z.enum(MORPH_SLEEVES).nullable().default(null),
});
export type MorphSpec = z.infer<typeof MorphSpec>;

const deltas = <T extends readonly string[]>(keys: T) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number().int().min(-500_000).max(500_000).nullable()])) as Record<T[number], z.ZodNullable<z.ZodNumber>>);

/**
 * Tailor template for a customizable product (FR-TRY-16). A null delta means "not offered".
 * Deltas are added to the product base price; money always goes to the tailor (OP-2).
 */
export const MorphTemplateInput = z.object({
  enabled: z.boolean().default(true),
  colourEnabled: z.boolean().default(true),
  colourDeltaRwf: z.number().int().min(0).max(500_000).default(0),
  baseLength: z.enum(MORPH_LENGTHS).default("knee"),
  baseSleeve: z.enum(MORPH_SLEEVES).default("short"),
  lengths: deltas(MORPH_LENGTHS).partial().default({}),
  sleeves: deltas(MORPH_SLEEVES).partial().default({}),
  leadTimeDays: z.number().int().min(1).max(90).default(7),
});
export type MorphTemplateInput = z.infer<typeof MorphTemplateInput>;

export const MeasurementsInput = z.object(
  Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, z.number().min(MEASUREMENT_LIMITS[f][0]).max(MEASUREMENT_LIMITS[f][1]).optional()])) as Record<
    MeasurementField,
    z.ZodOptional<z.ZodNumber>
  >,
);

export const QuoteInput = z.object({
  priceRwf: z.number().int().min(1000).max(5_000_000),
  depositPct: z.number().int().min(10).max(100),
  leadTimeDays: z.number().int().min(1).max(120),
  note: z.string().max(500).default(""),
});
export type QuoteInput = z.infer<typeof QuoteInput>;

export const CustomOrderRequest = z
  .object({
    pageId: z.string(),
    productId: z.string().optional(),
    variantId: z.string().optional(),
    serviceId: z.string().optional(),
    spec: MorphSpec.optional(),
    /** Generation id of the preview; only copied to the tailor when `sharePreview` is true. */
    renderId: z.string().optional(),
    sharePreview: z.boolean().default(false),
    shareMeasurements: z.boolean().default(false),
    shareDays: z.number().int().min(1).max(MAX_SHARE_DAYS).default(DEFAULT_SHARE_DAYS),
    size: z.string().max(10).optional(),
    note: z.string().max(500).default(""),
  })
  .refine((v) => v.productId || v.serviceId, { message: "Pick a product or a service" });
export type CustomOrderRequest = z.infer<typeof CustomOrderRequest>;

export const TailorServiceInput = z.object({
  title: z.string().min(3).max(80),
  description: z.string().max(600).default(""),
  startingPriceRwf: z.number().int().min(500).max(5_000_000),
  leadTimeDays: z.number().int().min(1).max(120),
  requiredMeasurements: z.array(z.enum(MEASUREMENT_FIELDS)).default([]),
  active: z.boolean().default(true),
});
export type TailorServiceInput = z.infer<typeof TailorServiceInput>;
