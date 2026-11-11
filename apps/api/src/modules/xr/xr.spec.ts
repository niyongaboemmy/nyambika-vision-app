import { describe, expect, it, vi } from "vitest";
import { Asset3dService } from "./asset3d.service";
import { MotionService } from "./motion.service";
import {
  allowanceAllows,
  ASSET_3D,
  checkAssetBudget,
  motionCostRwf,
  motionEligibility,
  MOTION,
  personaFromCacheKey,
  pickModelSize,
  pickVideoSource,
  quoteLabel,
} from "./xr-rules";

const glbHead = (version = 2) => {
  const b = Buffer.alloc(12);
  b.write("glTF", 0, "latin1");
  b.writeUInt32LE(version, 4);
  return b;
};

describe("motion metering source order (FR-PLAN-03, FR-VID-04)", () => {
  const base = { freeUsedThisWeek: 0, pageAllowanceOn: true, pageCap: 100, pageUnitsUsed: 0 };
  it("free weekly quota first", () => {
    expect(pickVideoSource(base)).toBe("FREE_QUOTA");
  });
  it("then the page allowance, only when enabled and with room for all units", () => {
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 1 })).toBe("PAGE_ALLOWANCE");
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 1, pageUnitsUsed: 98 })).toBe("CREDITS");
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 1, pageUnitsUsed: 97 })).toBe("PAGE_ALLOWANCE");
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 1, pageAllowanceOn: false })).toBe("CREDITS");
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 1, pageCap: null })).toBe("CREDITS");
  });
  it("host-configurable order, credits always the fallback", () => {
    expect(pickVideoSource({ ...base, order: ["PAGE_ALLOWANCE", "FREE_QUOTA", "CREDITS"] })).toBe("PAGE_ALLOWANCE");
    expect(pickVideoSource({ ...base, order: ["CREDITS"] })).toBe("CREDITS");
    expect(pickVideoSource({ ...base, freeUsedThisWeek: 5, pageAllowanceOn: false, order: ["FREE_QUOTA"] })).toBe("CREDITS");
  });
  it("price is shown before confirming", () => {
    expect(motionCostRwf()).toBe(MOTION.credits * MOTION.creditRwf);
    expect(quoteLabel("CREDITS")).toBe(`3 credits · RWF ${motionCostRwf().toLocaleString("en-US")}`);
    expect(quoteLabel("FREE_QUOTA")).toMatch(/free/i);
  });
});

describe("3D asset rules (FR-3D-03/07)", () => {
  it("page allowance gate", () => {
    expect(allowanceAllows(null, 999, 3)).toBe(true);
    expect(allowanceAllows(10, 7, 3)).toBe(true);
    expect(allowanceAllows(10, 8, 3)).toBe(false);
  });
  it("budget validation", () => {
    expect(checkAssetBudget({ bytes: 400_000, triangles: 11_000, posterBytes: 40_000, glbHead: glbHead() })).toEqual([]);
    const bad = checkAssetBudget({ bytes: 3_000_000, triangles: 60_000, posterBytes: 400_000, glbHead: glbHead(1) });
    expect(bad).toHaveLength(4);
  });
  it("model size from the size chart", () => {
    expect(pickModelSize(["S", "M", "L"])).toBe("M");
    expect(pickModelSize(["xs", "s", "l", "xl"])).toBe("S");
    expect(pickModelSize([])).toBe("M");
  });
  it("motion eligibility and persona decoding", () => {
    expect(motionEligibility({ generationStatus: "GENERATING" }, 0).ok).toBe(false);
    expect(motionEligibility({ generationStatus: "DELIVERED" }, MOTION.dailyCap).ok).toBe(false);
    expect(motionEligibility({ generationStatus: "DELIVERED" }, 0).ok).toBe(true);
    expect(personaFromCacheKey("persona-4:v0|var|model")).toBe(4);
    expect(personaFromCacheKey("twin123:v2|var|model")).toBe(2);
  });
});

/** Minimal in-memory Prisma stand-in for the bits the job handlers use. */
function fakePrisma(seed: { asset?: Record<string, unknown>; clip?: Record<string, unknown>; generation?: Record<string, unknown> }) {
  const asset = { ...seed.asset };
  const clip = { ...seed.clip };
  const usage: Record<string, unknown>[] = [];
  const moderation: Record<string, unknown>[] = [];
  const media: Record<string, unknown>[] = [];
  return {
    usage,
    moderation,
    media,
    asset,
    clip,
    garmentAsset3d: { update: vi.fn(async ({ data }: { data: object }) => Object.assign(asset, data)) },
    motionClip: { update: vi.fn(async ({ data }: { data: object }) => Object.assign(clip, data)) },
    variant: {
      findUnique: vi.fn(async () => ({ id: "v1", cutoutPath: "public/media/p1/v1-cutout.png", sizes: ["S", "M"], product: { category: "dress" } })),
    },
    generation: { findUnique: vi.fn(async () => seed.generation ?? null) },
    mediaAsset: { deleteMany: vi.fn(async () => ({})), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => media.push(data)) },
    usageEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => usage.push(data)),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { units: 0 } })),
    },
    page: { findUnique: vi.fn(async () => ({ allowanceOn: true, subscription: { monthlyCap: 100, periodStart: new Date(0) } })) },
    moderationItem: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => moderation.push(data)) },
  };
}

const storage = () => {
  const files = new Map<string, Buffer>();
  return {
    files,
    read: vi.fn(async () => Buffer.from("png")),
    put: vi.fn(async (rel: string, data: Buffer) => (files.set(rel, data), rel)),
    publicUrl: (rel: string | null) => (rel ? `/api/files/${rel}` : null),
  };
};
const metering = () => ({ record: vi.fn(async () => ({})), assertBudgetOpen: vi.fn(async () => undefined) });
const generations = () => ({ handle: vi.fn(), enqueue: vi.fn() });

describe("3D generation job (E27)", () => {
  const glb = Buffer.concat([glbHead(), Buffer.alloc(500)]);
  const ok = { glb_b64: glb.toString("base64"), poster_b64: Buffer.alloc(100).toString("base64"), triangles: 11_000, vertices: 5000, bytes: glb.length, dimensions_m: { width: 0.7, height: 1.08, depth: 0.25 }, model_version: "silhouette-lift@1.0", sha256: "ab" };

  it("stores public media, meters ASSET_3D against the page allowance and marks READY", async () => {
    const prisma = fakePrisma({ asset: { id: "a1", variantId: "v1", productId: "p1", pageId: "pg1", size: "M", requestedBy: "u1" } });
    const st = storage();
    const m = metering();
    const ai = { post: vi.fn(async () => ok) };
    const svc = new Asset3dService(prisma as never, st as never, ai as never, m as never, generations() as never);
    await svc.process("a1");
    expect(ai.post).toHaveBeenCalledWith("/v1/garment/3d", expect.objectContaining({ category: "dress", size: "M" }), 120_000);
    expect([...st.files.keys()]).toEqual(["public/media/pg1/v1-3d.glb", "public/media/pg1/v1-3d-poster.webp"]);
    expect(m.record).toHaveBeenCalledWith("ASSET_3D", "PAGE_ALLOWANCE", ASSET_3D.costRwf, "u1", "pg1", "v1");
    expect(prisma.media).toEqual([{ productId: "p1", path: "public/media/pg1/v1-3d.glb", kind: "MODEL_3D" }]);
    expect(prisma.asset).toMatchObject({ status: "READY", progress: 100, triangles: 11_000, heightM: 1.08 })
    expect(prisma.asset).not.toHaveProperty("approved"); // approval is a separate human step (FR-3D-06);
  });

  it("rejects an over-budget model, never meters it, marks FAILED", async () => {
    const prisma = fakePrisma({ asset: { id: "a2", variantId: "v1", productId: "p1", pageId: "pg1", size: "M" } });
    const m = metering();
    const ai = { post: vi.fn(async () => ({ ...ok, triangles: 80_000 })) };
    const svc = new Asset3dService(prisma as never, storage() as never, ai as never, m as never, generations() as never);
    await expect(svc.process("a2")).rejects.toThrow(/triangles/);
    expect(m.record).not.toHaveBeenCalled();
    expect(prisma.asset).toMatchObject({ status: "FAILED" });
  });

  it("registers its job name on the shared queue", () => {
    const g = generations();
    new Asset3dService({} as never, {} as never, {} as never, {} as never, g as never).onModuleInit();
    expect(g.handle).toHaveBeenCalledWith("asset3d", expect.any(Function));
  });
});

describe("motion job (E28)", () => {
  const generation = { id: "g1", status: "DELIVERED", cacheKey: "persona-3:v0|v1|m", variant: { cutoutPath: "c.png", product: { category: "dress" } } };
  const clipSeed = { id: "c1", userId: "u1", generationId: "g1", pageId: "pg1" };
  const twins = { renderSource: vi.fn(async () => ({ image: Buffer.from("twin") })), current: vi.fn(async () => null) };
  const make = (prisma: ReturnType<typeof fakePrisma>, ai: { post: ReturnType<typeof vi.fn> }, st = storage()) => {
    return new MotionService(prisma as never, st as never, ai as never, metering() as never, {} as never, twins as never, generations() as never);
  };

  it("delivers privately, meters VIDEO units with the resolved source", async () => {
    const prisma = fakePrisma({ clip: { ...clipSeed }, generation });
    const st = storage();
    const ai = { post: vi.fn(async () => ({ status: "DELIVERED", guard: { passed: true, reasons: [] }, frames: 48, fps: 12, duration_ms: 4000, width: 340, height: 512, model_version: "m", webp_b64: "AAAA", mp4_b64: "BBBB", poster_b64: "CCCC", c2pa: { sha256: "f".repeat(64), signature: "s", manifest: {} } })) };
    await make(prisma, ai, st).process("c1");
    expect(twins.renderSource).toHaveBeenCalledWith("u1", 3);
    expect([...st.files.keys()].every((k) => k.startsWith("private/motion/u1/"))).toBe(true);
    expect(prisma.usage).toEqual([expect.objectContaining({ kind: "VIDEO", source: "FREE_QUOTA", units: MOTION.credits, userId: "u1", pageId: null, refId: "c1" })]);
    expect(prisma.clip).toMatchObject({ status: "DELIVERED", frames: 48, progress: 100, credits: 3 });
  });

  it("withheld by the frame guard: never stored, never billed, sent to moderation", async () => {
    const prisma = fakePrisma({ clip: { ...clipSeed }, generation });
    const st = storage();
    const ai = { post: vi.fn(async () => ({ status: "WITHHELD", guard: { passed: false, reasons: ["identity_drift"] }, frames: 48, fps: 12, duration_ms: 4000, width: 340, height: 512, model_version: "m" })) };
    await make(prisma, ai, st).process("c1");
    expect(st.files.size).toBe(0);
    expect(prisma.usage).toHaveLength(0);
    expect(prisma.moderation[0]).toMatchObject({ kind: "GUARD_WITHHELD", refId: "c1" });
    expect(prisma.clip).toMatchObject({ status: "WITHHELD" });
  });

  it("fails cleanly when the look was purged", async () => {
    const prisma = fakePrisma({ clip: { ...clipSeed } });
    const ai = { post: vi.fn() };
    await expect(make(prisma, ai).process("c1")).rejects.toThrow(/no longer available/);
    expect(ai.post).not.toHaveBeenCalled();
    expect(prisma.clip).toMatchObject({ status: "FAILED" });
  });

  it("signed URLs point at the range-capable motion route and expire", () => {
    const svc = make(fakePrisma({}), { post: vi.fn() });
    const url = svc.sign("private/motion/u1/c1.mp4");
    expect(url).toMatch(/^\/api\/xr\/motion-file\?p=private%2Fmotion%2Fu1%2Fc1\.mp4&exp=\d+&sig=[0-9a-f]{64}$/);
  });
});
