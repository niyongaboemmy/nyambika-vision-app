import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminController } from "../admin/admin.module";
import { mapGatewayStatus, residencyRegion, servedByActivatedModel, validateClip, VIDEO_TRYON, videoAvailable, videoEligibility, videoQuote } from "../video/video-rules";
import { VideoTryOnService } from "../video/video.service";
import { ADDED_ROUTE_DEFAULTS, counterDeltas, enforceInvariants, policySchema, poolShare, ROUTES, upgradePolicy, type Policy } from "./inference-rules";
import { activationDecision, assertActivationAllowed, EVAL_MAX_AGE_DAYS } from "./nlb-gate";

const video = { id: "motion-compose@1.0", tier: "VIDEO_TRYON" };
const now = new Date("2026-11-11T10:00:00Z");
const passing = { kind: "NLB_VIDEO", modelVersion: "motion-compose@1.0", passed: true, commercialUse: true, createdAt: new Date("2026-11-10T10:00:00Z"), summary: {} };

describe("NLB activation gate (E39, AI-BM-03/04/05)", () => {
  it("does not gate still-image tiers", () => {
    expect(activationDecision({ id: "local-compositor@1.0-preview", tier: "PREVIEW" }, null)).toEqual({ ok: true, evalRequired: false });
  });
  it("refuses a video model with no eval", () => {
    const d = activationDecision(video, null, now);
    expect(d).toMatchObject({ ok: false, code: "NO_EVAL" });
  });
  it("refuses a failed eval and names the failing subgroups", () => {
    const d = activationDecision(video, { ...passing, passed: false, summary: { failing_subgroups: ["MST9×XL", "MST10×S"] } }, now);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("MST9×XL");
  });
  it("refuses an eval of another version, a non-commercial licence and a stale eval", () => {
    expect(activationDecision(video, { ...passing, modelVersion: "motion-compose@0.9" }, now)).toMatchObject({ code: "VERSION_MISMATCH" });
    expect(activationDecision(video, { ...passing, commercialUse: false }, now)).toMatchObject({ code: "LICENCE" });
    const old = new Date(now.getTime() - (EVAL_MAX_AGE_DAYS + 1) * 86400_000);
    expect(activationDecision(video, { ...passing, createdAt: old }, now)).toMatchObject({ code: "EVAL_STALE" });
  });
  it("accepts a fresh passing eval for the exact version", () => {
    expect(activationDecision(video, passing, now)).toEqual({ ok: true, evalRequired: true });
  });
  it("assertActivationAllowed reads the latest eval and throws 409 NLB_GATE", async () => {
    const db = {
      modelVersion: { findUniqueOrThrow: vi.fn().mockResolvedValue(video) },
      modelEval: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(assertActivationAllowed(db as never, video.id, now)).rejects.toBeInstanceOf(ConflictException);
    expect(db.modelEval.findFirst).toHaveBeenCalledWith({ where: { modelId: video.id, kind: "NLB_VIDEO" }, orderBy: { createdAt: "desc" } });
    db.modelEval.findFirst.mockResolvedValue(passing);
    await expect(assertActivationAllowed(db as never, video.id, now)).resolves.toMatchObject({ ok: true });
  });
});

describe("PATCH /admin/models/:id uses the gate", () => {
  function controller(evalRow: unknown) {
    const prisma = {
      modelVersion: { findUniqueOrThrow: vi.fn().mockResolvedValue(video), update: vi.fn().mockResolvedValue({ ...video, status: "ACTIVE" }) },
      modelEval: { findFirst: vi.fn().mockResolvedValue(evalRow) },
    };
    const access = { requireHost: vi.fn().mockResolvedValue(undefined), audit: vi.fn().mockResolvedValue(undefined) };
    return { c: new AdminController(prisma as never, access as never, {} as never), prisma, access };
  }
  const host = { id: "host-1" } as never;

  it("refuses activation of an unevaluated video provider, audits the refusal and changes nothing", async () => {
    const { c, prisma, access } = controller(null);
    const err = await c.setModel(host, video.id, { status: "ACTIVE" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: "NLB_GATE", reason: "NO_EVAL" });
    expect(prisma.modelVersion.update).not.toHaveBeenCalled();
    expect(access.audit).toHaveBeenCalledWith("host-1", "admin.model_activation_refused", expect.objectContaining({ id: video.id }));
  });
  it("activates after a passing eval", async () => {
    const { c, prisma } = controller({ ...passing, createdAt: new Date() });
    await c.setModel(host, video.id, { status: "ACTIVE" });
    expect(prisma.modelVersion.update).toHaveBeenCalledWith({ where: { id: video.id }, data: { status: "ACTIVE" } });
  });
  it("retiring is never gated", async () => {
    const { c, prisma } = controller(null);
    await c.setModel(host, video.id, { status: "RETIRED" });
    expect(prisma.modelEval.findFirst).not.toHaveBeenCalled();
    expect(prisma.modelVersion.update).toHaveBeenCalled();
  });
});

describe("inference policy + metrics (E42)", () => {
  const route = { strategy: "cost", latency_slo_ms: 15000, residency: "any", fallback: true, pool: { enabled: true, cost_rwf: 14 }, hosted: { enabled: true, cost_rwf: 40 } } as const;
  const policy: Policy = { version: 3, breaker: { failure_threshold: 3, cooldown_s: 15 }, routes: { tryon: route, stt: route, llm: route, avatar: route, video: route, attr: route } };

  it("validates the policy and forces no-fallback on video", () => {
    expect(policySchema.safeParse(policy).success).toBe(true);
    expect(policySchema.safeParse({ ...policy, routes: { ...policy.routes, tryon: { ...route, strategy: "random" } } }).success).toBe(false);
    expect(enforceInvariants(policy).routes.video.fallback).toBe(false);
    expect(enforceInvariants(policy).routes.tryon.fallback).toBe(true);
  });
  it("lists the attr route and keeps policies stored before it valid (compat step)", () => {
    expect(ROUTES).toContain("attr");
    const { attr: _drop, ...routes5 } = policy.routes;
    const stored = { ...policy, routes: routes5 }; // saved by E42, before the R4 spike added `attr`
    expect(policySchema.safeParse(stored).success).toBe(false); // why adding the route naively broke them
    const up = upgradePolicy(stored);
    expect(up.changed).toBe(true);
    expect(policySchema.safeParse(up.policy).success).toBe(true);
    expect(up.policy.routes.attr).toEqual(ADDED_ROUTE_DEFAULTS.attr);
    expect(up.policy.routes.attr).toMatchObject({ strategy: "pool-only", residency: "in-region" });
    expect(up.policy.routes.tryon).toEqual(route);
    expect(up.policy.version).toBe(3);
    // The gateway's live attr policy wins over the built-in defaults.
    const live = { ...route, latency_slo_ms: 1500 };
    expect(upgradePolicy(stored, { routes: { attr: live } }).policy.routes.attr).toEqual(live);
    // Already complete: untouched. Unknown keys (from a newer gateway) are dropped instead of failing the parse.
    expect(upgradePolicy(policy)).toEqual({ policy, changed: false });
    const extra = upgradePolicy({ ...policy, routes: { ...policy.routes, teleport: route } });
    expect(extra.changed).toBe(true);
    expect(Object.keys(extra.policy.routes)).not.toContain("teleport");
    // A route we cannot fill is still an error, not a silent default.
    const { tryon: _t, ...noTryon } = policy.routes;
    expect(() => upgradePolicy({ ...policy, routes: noTryon })).toThrow(/tryon/);
  });
  it("turns cumulative gateway counters into deltas, surviving a gateway restart", () => {
    const a = { calls: 10, ok: 8, failures: 2, served_as_fallback: 1, cost_rwf: 112 };
    expect(counterDeltas(undefined, a)).toEqual({ cost: 112, ok: 8, failed: 2, fallback: 1 });
    expect(counterDeltas(a, { ...a, calls: 12, ok: 10, cost_rwf: 140 })).toEqual({ cost: 28, ok: 2, failed: 0, fallback: 0 });
    expect(counterDeltas(a, { calls: 1, ok: 1, failures: 0, served_as_fallback: 0, cost_rwf: 14 })).toEqual({ cost: 14, ok: 1, failed: 0, fallback: 0 });
  });
  it("pool share", () => {
    const s = (ok: number) => ({ calls: ok, ok, failures: 0, served_as_fallback: 0, cost_rwf: 0 });
    expect(poolShare({ pool: s(3), hosted: s(1) })).toBe(0.75);
    expect(poolShare({ pool: s(0), hosted: s(0) })).toBeNull();
  });
});

describe("video try-on rules (E39)", () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]).toString("base64");
  it("is available only with an active model and the kill switch open", () => {
    expect(videoAvailable(true, null)).toBe(false);
    expect(videoAvailable(true, { id: "m" })).toBe(true);
    expect(videoAvailable(false, { id: "m" })).toBe(false);
    expect(videoAvailable(undefined, { id: "m" })).toBe(true);
  });
  it("validates device-extracted clip frames", () => {
    expect(validateClip(Array(8).fill(jpeg))).toEqual([]);
    expect(validateClip(Array(3).fill(jpeg))[0]).toMatch(/at least 6/);
    expect(validateClip(Array(30).fill(jpeg))).toContain("At most 24 frames.");
    expect(validateClip(Array(8).fill(Buffer.from("GIF89a....").toString("base64")))).toContain("Frames must be JPEG, PNG or WebP.");
  });
  it("prices as a premium credit action and respects the daily cap", () => {
    expect(videoQuote({ pageAllowanceOn: false, pageCap: null, pageUnitsUsed: 0 })).toMatchObject({ source: "CREDITS", credits: 5, costRwf: 550 });
    expect(videoQuote({ pageAllowanceOn: true, pageCap: 100, pageUnitsUsed: 10 })).toMatchObject({ source: "PAGE_ALLOWANCE", costRwf: 0 });
    expect(videoEligibility("DELIVERED", VIDEO_TRYON.dailyCap).ok).toBe(false);
    expect(videoEligibility("WITHHELD", 0).ok).toBe(false);
  });
  it("routes inference in the shopper's E41 region, else the page's, else RW", () => {
    expect(residencyRegion("KE", "RW")).toBe("KE");
    expect(residencyRegion(null, "UG")).toBe("UG");
    expect(residencyRegion("XX", undefined)).toBe("RW");
  });
  it("only the activated model's output reaches the shopper", () => {
    expect(servedByActivatedModel("motion-compose@1.0", "motion-compose@1.0")).toBe(true);
    expect(servedByActivatedModel("pool-video-vton@1.0", "hosted-video@2026")).toBe(false);
    expect(mapGatewayStatus("RUNNING")).toBe("GENERATING");
  });
});

describe("video worker deletes the shopper clip whatever happens", () => {
  it("fails without charging and removes the sealed clip when the gateway is down", async () => {
    let row = { id: "v1", userId: "u", lookId: "l", generationId: "g", variantId: "var", pageId: "p", source: "CLIP", status: "QUEUED", modelId: "motion-compose@1.0", provider: "motion-compose", clipPath: "private/video/u/v1/clip.enc", clipIv: "aa", clipTag: "bb", clipDeletedAt: null as Date | null, error: null as string | null };
    const prisma = {
      videoTryOn: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (row = { ...row, ...data } as typeof row)),
        findUnique: vi.fn(async () => row),
      },
      generation: { findUnique: vi.fn(async () => ({ status: "DELIVERED", cacheKey: "persona-2:x", variant: { cutoutPath: "public/c.png", product: { category: "dress" } } })) },
      modelVersion: { findFirst: vi.fn(async () => ({ id: "motion-compose@1.0" })) },
      usageEvent: { create: vi.fn() },
      shopperPrefs: { findUnique: vi.fn(async () => ({ country: "RW" })) },
      pageRegion: { findUnique: vi.fn(async () => null) },
    };
    const storage = { read: vi.fn(async () => Buffer.from("png")), readEncrypted: vi.fn(async () => Buffer.from(JSON.stringify(["a"]))), remove: vi.fn(async () => undefined) };
    const ai = { post: vi.fn(async () => { throw new Error("AI gateway unreachable"); }) };
    const svc = new VideoTryOnService(prisma as never, storage as never, ai as never, {} as never, {} as never, {} as never, { handle: vi.fn() } as never);
    await svc.process("v1");
    expect(row.status).toBe("FAILED");
    expect(storage.remove).toHaveBeenCalledWith("private/video/u/v1/clip.enc");
    expect(row.clipDeletedAt).toBeInstanceOf(Date);
    expect(prisma.usageEvent.create).not.toHaveBeenCalled();
  });
});
