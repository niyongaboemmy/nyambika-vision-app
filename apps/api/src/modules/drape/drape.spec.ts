import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { bodyFields, DRAPE_SPIKE, garmentForCategory, paramsFromSpec, PatternPreviewInput, toEvalRecord, TwinDrapeInput } from "./drape-rules";
import { DrapeSpikeService } from "./drape.module";

const sim = { glb_b64: "Z2xURg==", heatmap_glb_b64: "Z2xURg==", fit: { share: {} }, metrics: {}, pattern: {}, legend: [], latency_s: 2, model_id: DRAPE_SPIKE.modelId };

function make(opts: { flag?: boolean; share?: boolean } = {}) {
  const prisma = {
    featureFlag: { findUnique: vi.fn(async () => ({ key: DRAPE_SPIKE.flag, enabled: opts.flag ?? true })) },
    customOrder: { findUniqueOrThrow: vi.fn(async () => ({ id: "co1", pageId: "p1", productId: "prod1", spec: { length: "midi", sleeve: "long", hue: 200 } })) },
    product: { findUnique: vi.fn(async () => ({ category: "shirt" })) },
    modelEval: { create: vi.fn(async ({ data }) => ({ id: "e1", ...data, createdAt: new Date() })) },
  };
  const ai = {
    post: vi.fn(async (path: string) => (path === "/v1/drape/eval" ? { job_id: "j1" } : sim)),
    get: vi.fn(async () => ({ status: "DONE", report: { kind: "DRAPE_SPIKE", model_id: DRAPE_SPIKE.modelId, passed: true, gate: { stability: true }, thresholds: {}, summary: { runs: 3 }, licence: "in-house", commercial_use: true } })),
  };
  const access = { audit: vi.fn(), requireHost: vi.fn() };
  const metering = { assertBudgetOpen: vi.fn() };
  const twin3d = {
    state: vi.fn(async () => ({ consent: true })),
    ready: vi.fn(async () => ({ id: "a1" })),
    params: vi.fn(() => ({ measurements: { bustCm: 97, waistCm: 80, hipsCm: 104 }, skin_rgb: [0.5, 0.35, 0.25], body_size: "L" })),
  };
  const measurements = {
    forTailor: vi.fn(async () => {
      if (opts.share === false) throw new ForbiddenException({ code: "NO_ACTIVE_SHARE" });
      return { measurements: { heightCm: 170, bustCm: 98, waistCm: 82, hipsCm: 106, note: "x" }, expiresAt: new Date("2026-12-01") };
    }),
  };
  const svc = new DrapeSpikeService(prisma as never, ai as never, access as never, metering as never, twin3d as never, measurements as never);
  return { svc, prisma, ai, access, twin3d, measurements };
}

describe("drape spike rules", () => {
  it("maps catalogue categories to the three seeded pattern types", () => {
    expect(garmentForCategory("dress")).toBe("a_line_dress");
    expect(garmentForCategory("Skirt")).toBe("wrap_skirt");
    expect(garmentForCategory("blouse")).toBe("shirt");
    expect(garmentForCategory(null)).toBe("a_line_dress");
  });

  it("derives pattern params from the customer's morph spec, scaled by height", () => {
    expect(paramsFromSpec("a_line_dress", { length: "midi", sleeve: "sleeveless" }, 165)).toEqual({ length_cm: 112, ease_cm: 0, sleeve: "none" });
    expect(paramsFromSpec("shirt", { length: null, sleeve: "elbow" })).toMatchObject({ sleeve: "short", length_cm: 66 });
    expect(paramsFromSpec("wrap_skirt", { length: "maxi", sleeve: "long" }, 180).sleeve).toBe("none");
    expect(paramsFromSpec("a_line_dress", { length: "maxi", sleeve: null }, 230).length_cm).toBe(140);
  });

  it("forwards only body measurement fields", () => {
    expect(bodyFields({ bustCm: 90, note: "secret", heightCm: Number.NaN, hipsCm: 100 })).toEqual({ bustCm: 90, hipsCm: 100 });
  });

  it("validates inputs and defaults", () => {
    expect(TwinDrapeInput.parse({})).toMatchObject({ garment: "a_line_dress", fabric: "cotton", params: { ease_cm: 0 } });
    expect(() => PatternPreviewInput.parse({ params: { ease_cm: 50 } })).toThrow();
    expect(() => TwinDrapeInput.parse({ size: "XS" })).toThrow();
  });

  it("builds a model-registry eval record that only passes for this exact model", () => {
    const rep = { kind: "DRAPE_SPIKE", model_id: DRAPE_SPIKE.modelId, passed: true, gate: { a: true }, thresholds: { b: 1 }, summary: { runs: 54 }, scope: "full", runs: [1] };
    const rec = toEvalRecord(rep, "host1");
    expect(rec).toMatchObject({ modelId: DRAPE_SPIKE.modelId, kind: "DRAPE_SPIKE", passed: true, createdBy: "host1" });
    expect(rec.summary).toMatchObject({ runs: 54, scope: "full", spike: true, gate: { a: true } });
    expect(toEvalRecord({ ...rep, model_id: "other@1" }, null).passed).toBe(false);
    expect(() => toEvalRecord({ ...rep, kind: "NLB_VIDEO" }, null)).toThrow();
  });
});

describe("DrapeSpikeService", () => {
  it("is off unless the flag is on", async () => {
    const { svc, ai } = make({ flag: false });
    await expect(svc.twin("u1", {})).rejects.toThrow(/experiment is off/);
    await expect(svc.tailorPreview("t1", "co1", {})).rejects.toThrow(/experiment is off/);
    expect(ai.post).not.toHaveBeenCalled();
    expect((await svc.status()).enabled).toBe(false);
  });

  it("drapes on the shopper's own twin body and returns data URLs, nothing stored", async () => {
    const { svc, ai } = make();
    const r = await svc.twin("u1", { garment: "shirt", fabric: "jersey" });
    const [path, body] = ai.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe("/v1/drape/simulate");
    expect(body).toMatchObject({ garment: "shirt", size: "L", fabric: "jersey", skin_rgb: [0.5, 0.35, 0.25], body_measurements: { bustCm: 97 } });
    expect(r.glb.startsWith("data:model/gltf-binary;base64,")).toBe(true);
    expect(r).toMatchObject({ experimental: true, disclaimer: DRAPE_SPIKE.disclaimer });
  });

  it("needs a ready 3D twin", async () => {
    const { svc, twin3d } = make();
    twin3d.ready.mockResolvedValueOnce(null as never);
    await expect(svc.twin("u1", {})).rejects.toThrow(/Build your 3D twin/);
  });

  it("tailor preview uses the active share, a neutral synthetic body and the order's spec; audited", async () => {
    const { svc, ai, access, measurements } = make();
    const r = await svc.tailorPreview("t1", "co1", { params: { ease_cm: 2 } });
    expect(measurements.forTailor).toHaveBeenCalledWith("t1", "co1");
    const body = (ai.post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(body).toMatchObject({ garment: "shirt", hue: 200, params: { sleeve: "long", ease_cm: 2, length_cm: 74 } });
    expect(body.skin_rgb).toBeUndefined(); // never the shopper's skin or twin
    expect(body.body_measurements).toEqual({ heightCm: 170, bustCm: 98, waistCm: 82, hipsCm: 106 });
    expect(r.garment).toBe("shirt");
    expect(access.audit).toHaveBeenCalledWith("t1", "DRAPE_SPIKE_PREVIEW", expect.objectContaining({ customOrderId: "co1" }), "p1");
  });

  it("tailor preview is refused once the share has ended", async () => {
    const { svc, ai } = make({ share: false });
    await expect(svc.tailorPreview("t1", "co1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(ai.post).not.toHaveBeenCalled();
  });

  it("host eval stores a DRAPE_SPIKE model-registry record", async () => {
    const { svc, prisma, access } = make();
    const r = await svc.runEval("h1", { scope: "smoke" });
    expect(access.requireHost).toHaveBeenCalledWith("h1");
    expect(prisma.modelEval.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "DRAPE_SPIKE", modelId: DRAPE_SPIKE.modelId, passed: true }) });
    expect(r.passed).toBe(true);
    expect(access.audit).toHaveBeenCalledWith("h1", "admin.drape_spike_eval", expect.objectContaining({ scope: "smoke" }));
  });
});
