import { describe, expect, it, vi } from "vitest";
import { decryptField } from "../tailor/crypto";
import {
  AVATAR_3D,
  AVATAR_COST,
  canBuild,
  coverageOf,
  FIT_COST,
  fitSizes,
  isAvatarPath,
  mapJobStatus,
  nextVersion,
  progressFor,
  supports3dTryOn,
  validateCapture,
} from "./twin3d-rules";
import { AVATAR_JOB, FIT_JOB, Twin3dService } from "./twin3d.service";

const yaws24 = Array.from({ length: 24 }, (_, i) => i * 15);
const frame = (bytes = 40_000, mime = "image/jpeg") => ({ bytes, mime });

describe("capture validation + coverage (FR-AVA-01)", () => {
  it("coverage counts 30° bins of the turn", () => {
    expect(coverageOf(yaws24)).toBe(1);
    expect(coverageOf([0, 10, 20, 95])).toBeCloseTo(2 / 12);
    expect(coverageOf([-15, 345])).toBeCloseTo(1 / 12); // negative angles wrap
  });
  it("accepts a full 24-frame turn", () => {
    expect(validateCapture(yaws24.map(() => frame()), yaws24)).toEqual([]);
  });
  it("rejects too few frames, missing angles, big or wrong files and a partial turn", () => {
    expect(validateCapture([frame(), frame()], [0, 15])[0]).toMatch(/at least 8/);
    expect(validateCapture(yaws24.map(() => frame()), yaws24.slice(1))).toContain("Each frame needs its turn angle.");
    expect(validateCapture(yaws24.map(() => frame(900_000)), yaws24)).toContain("A frame is too large.");
    expect(validateCapture(yaws24.map(() => frame(1000, "image/gif")), yaws24)).toContain("Frames must be JPEG, PNG or WebP.");
    const quarter = Array.from({ length: 10 }, (_, i) => i * 9);
    expect(validateCapture(quarter.map(() => frame()), quarter)).toContain("Turn all the way round so we see every side.");
  });
});

describe("consent, versioning and job rules (FR-AVA-02)", () => {
  it("needs the separate 3D consent, one build at a time, and a daily cap", () => {
    expect(canBuild({ consent: false, buildsToday: 0, building: false })).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
    expect(canBuild({ consent: true, buildsToday: 0, building: true })).toMatchObject({ ok: false, code: "BUSY" });
    expect(canBuild({ consent: true, buildsToday: AVATAR_COST.dailyCap, building: false })).toMatchObject({ ok: false, code: "DAILY_CAP" });
    expect(canBuild({ consent: true, buildsToday: 0, building: false })).toEqual({ ok: true });
  });
  it("versions increase from the last build", () => {
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion({ version: 4 })).toBe(5);
  });
  it("maps gateway job states and progress", () => {
    expect(mapJobStatus("DONE")).toBe("READY");
    expect(mapJobStatus("REJECTED")).toBe("REJECTED");
    expect(mapJobStatus("WITHHELD")).toBe("WITHHELD");
    expect(mapJobStatus("RUNNING")).toBe("BUILDING");
    expect(mapJobStatus("FAILED")).toBe("FAILED");
    expect(mapJobStatus("weird")).toBe("FAILED");
    expect(progressFor(0)).toBe(10);
    expect(progressFor(100)).toBe(90);
  });
  it("sizes offered and recommended from the avatar's body size", () => {
    expect(fitSizes(["s", "M", "L", "M"], "L")).toEqual({ sizes: ["S", "M", "L"], recommended: "L" });
    expect(fitSizes(["XS", "S"], "XL").recommended).toBe("S");
    expect(fitSizes([], null)).toEqual({ sizes: ["S", "M", "L"], recommended: "M" });
    expect(supports3dTryOn("umushanana")).toBe(true);
    expect(supports3dTryOn("bag")).toBe(false);
  });
  it("only per-user versioned avatar paths are servable", () => {
    expect(isAvatarPath("private/avatars/cmabc123/v2/avatar.glb.enc")).toBe(true);
    expect(isAvatarPath("private/twins/u/v1.enc")).toBe(false);
    expect(isAvatarPath("private/avatars/u/v1/../../twins/x")).toBe(false);
  });
});

// ── service with in-memory fakes ─────────────────────────────────────────────
type Row = Record<string, unknown> & { id: string };
function table(rows: Row[] = []) {
  let n = rows.length;
  const match = (r: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Record<string, unknown>[]).some((w) => match(r, w));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>;
        if ("not" in o) return r[k] !== o.not;
        if ("lt" in o) return (r[k] as number) < (o.lt as number);
        if ("gte" in o) return true;
        if ("notIn" in o) return !(o.notIn as unknown[]).includes(r[k]);
        if ("in" in o) return (o.in as unknown[]).includes(r[k]);
        return true;
      }
      return (r[k] ?? null) === v;
    });
  const sorted = (where?: Record<string, unknown>, orderBy?: Record<string, string>) => {
    const out = rows.filter((r) => match(r, where));
    if (orderBy) {
      const [k, dir] = Object.entries(orderBy)[0];
      out.sort((a, b) => ((a[k] as number) - (b[k] as number)) * (dir === "desc" ? -1 : 1));
    }
    return out;
  };
  return {
    rows,
    findFirst: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, string> } = {}) => sorted(where, orderBy)[0] ?? null),
    findMany: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, string> } = {}) => sorted(where, orderBy)),
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const k = Object.values(where)[0];
      return (typeof k === "object" ? rows.find((r) => match(r, k as Record<string, unknown>)) : rows.find((r) => r.id === k)) ?? null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)!),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => match(r, where)).length),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `r${++n}`, createdAt: new Date(), deletedAt: null, status: "QUEUED", progress: 0, ...data } as Row;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const keep = rows.filter((r) => !match(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
  };
}

function harness(opts: { consent?: boolean; jobs?: { status: string; progress: number; result?: unknown; error?: string }[]; dress?: unknown } = {}) {
  const avatars = table();
  const fits = table();
  const usage: unknown[] = [];
  const consents: { purpose: string; granted: boolean }[] = opts.consent === false ? [] : [{ purpose: AVATAR_3D, granted: true }];
  const prisma = {
    avatar3d: avatars,
    avatarFit3d: fits,
    consentRecord: { findFirst: vi.fn(async () => ({ id: "c1" })) },
    featureFlag: { findUnique: vi.fn(async () => null) },
    variant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        productId: "p1",
        cutoutPath: where.id === "bag" ? null : "public/media/p1/v1-cutout.png",
        sizes: ["S", "M", "L"],
        colourName: "Indigo",
        colourHex: "#2F3E9E",
        product: { status: "PUBLISHED", title: "Dress", category: where.id === "bag" ? "bag" : "dress", variants: [] },
      })),
    },
  };
  const files = new Map<string, Buffer>();
  const storage = {
    files,
    root: "/tmp",
    putEncrypted: vi.fn(async (rel: string, data: Buffer) => (files.set(rel, data), { iv: "aa", authTag: "bb" })),
    readEncrypted: vi.fn(async (rel: string) => files.get(rel) ?? Buffer.from("x")),
    read: vi.fn(async () => Buffer.from("png")),
    put: vi.fn(async (rel: string, d: Buffer) => (files.set(rel, d), rel)),
    remove: vi.fn(async (rel: string) => files.delete(rel)),
    publicUrl: (rel: string | null) => (rel ? `/api/files/${rel}` : null),
  };
  const jobs = [...(opts.jobs ?? [])];
  const ai = {
    post: vi.fn(async (path: string) => (path === "/v1/avatar/build" ? { job_id: "j1", status: "QUEUED" } : opts.dress)),
    get: vi.fn(async () => jobs.shift() ?? { status: "FAILED", progress: 100, error: "gone" }),
  };
  const consent = {
    has: vi.fn(async (_u: string, p: string) => consents.filter((c) => c.purpose === p).at(-1)?.granted === true),
    record: vi.fn(async (_u: string, purpose: string, granted: boolean) => consents.push({ purpose, granted })),
  };
  const metering = { record: vi.fn(async (...a: unknown[]) => usage.push(a)), assertBudgetOpen: vi.fn(async () => undefined) };
  const generations = { handle: vi.fn(), enqueue: vi.fn(async () => undefined) };
  const twins = { current: vi.fn(async () => ({ size: "M" })) };
  const measurements = { profile: vi.fn(async () => ({ heightCm: 170 })) };
  const svc = new Twin3dService(prisma as never, storage as never, ai as never, consent as never, metering as never, generations as never, twins as never, measurements as never);
  return { svc, prisma, storage, ai, consent, metering, generations, usage, avatars, fits };
}

const done = (over: Record<string, unknown> = {}) => ({
  status: "DONE",
  progress: 100,
  result: {
    status: "DONE",
    glb_b64: Buffer.from("glTF....").toString("base64"),
    poster_b64: Buffer.from("png").toString("base64"),
    triangles: 7000,
    joints: 18,
    bytes: 200_000,
    skin_rgb: [0.4, 0.3, 0.2],
    skin_hex: "#664D33",
    measurements_used: { heightCm: 170, bustCm: 90 },
    measurement_sources: ["heightCm"],
    size_estimate: "M",
    body_size: "M",
    eval: { passed: true, skin_tone_delta: 0.001, proportion_error: 0.0005 },
    checks: { ok: true, checks: {} },
    model_version: "parametric-body@1.0",
    ...over,
  },
});

describe("3D twin service (E33)", () => {
  it("registers its jobs on the shared generation queue", () => {
    const h = harness();
    h.svc.onModuleInit();
    expect(h.generations.handle).toHaveBeenCalledWith(AVATAR_JOB, expect.any(Function));
    expect(h.generations.handle).toHaveBeenCalledWith(FIT_JOB, expect.any(Function));
  });

  it("refuses a capture without the separate AVATAR_3D consent", async () => {
    const h = harness({ consent: false });
    await expect(h.svc.capture("u1", [], [])).rejects.toMatchObject({ status: 403 });
    expect(h.avatars.rows).toHaveLength(0);
  });

  it("stores the capture encrypted, queues a job, and versions each build", async () => {
    const h = harness();
    const frames = yaws24.map(() => ({ buffer: Buffer.from("jpeg"), mimetype: "image/jpeg", size: 4 }));
    const v1 = await h.svc.capture("u1", frames, yaws24);
    expect(v1).toMatchObject({ version: 1, status: "QUEUED", building: true, glb: null });
    expect([...h.storage.files.keys()]).toEqual(["private/avatars/u1/v1/capture.enc"]);
    expect(h.generations.enqueue).toHaveBeenCalledWith(AVATAR_JOB, { id: v1.id }, `avatar3d-${v1.id}`);
    // A second build while the first is still queued is refused.
    await expect(h.svc.capture("u1", frames, yaws24)).rejects.toMatchObject({ status: 429 });
    h.avatars.rows[0].status = "READY";
    const v2 = await h.svc.fromMeasurements("u1", [0.3, 0.2, 0.1]);
    expect(v2.version).toBe(2);
    expect(JSON.parse(decryptField(h.avatars.rows[1].paramsSealed as string))).toEqual({ skin_rgb: [0.3, 0.2, 0.1] });
  });

  it("job: polls the gateway, stores the GLB encrypted, deletes frames, meters, and purges the older version", async () => {
    const h = harness({ jobs: [{ status: "RUNNING", progress: 40 }, done()] });
    const old = await h.prisma.avatar3d.create({ data: { userId: "u1", version: 1, source: "PERSONA", status: "READY", glbPath: "private/avatars/u1/v1/avatar.glb.enc" } });
    await h.prisma.avatarFit3d.create({ data: { avatarId: old.id, userId: "u1", variantId: "v1", size: "M", glbPath: "private/avatars/u1/v1/fits/v1-M.glb.enc" } });
    h.storage.files.set("private/avatars/u1/v1/avatar.glb.enc", Buffer.from("old"));
    h.storage.files.set("private/avatars/u1/v1/fits/v1-M.glb.enc", Buffer.from("oldfit"));
    const v2 = await h.svc.capture("u1", yaws24.map(() => ({ buffer: Buffer.from("j"), mimetype: "image/jpeg", size: 1 })), yaws24);
    expect(v2.version).toBe(2);
    await h.svc.process(v2.id);
    const row = h.avatars.rows.find((r) => r.id === v2.id)!;
    expect(row).toMatchObject({ status: "READY", progress: 100, framesPath: null, triangles: 7000, joints: 18, modelVersion: "parametric-body@1.0" });
    expect(h.ai.post).toHaveBeenCalledWith("/v1/avatar/build", expect.objectContaining({ measurements: { heightCm: 170 }, size_estimate: "M", request_id: `avatar3d-${v2.id}` }));
    expect([...h.storage.files.keys()].sort()).toEqual(["private/avatars/u1/v2/avatar.glb.enc", "private/avatars/u1/v2/poster.png.enc"]);
    expect(h.usage).toEqual([[AVATAR_COST.kind, "FREE_QUOTA", AVATAR_COST.costRwf, "u1", null, v2.id]]);
    expect(old.deletedAt).toBeInstanceOf(Date);
    expect(h.fits.rows).toHaveLength(0);
    const view = h.svc.view(row as never);
    expect(view.glb).toMatch(/^\/api\/twin3d\/file\?p=private%2Favatars%2Fu1%2Fv2%2Favatar\.glb\.enc&exp=\d+&sig=[0-9a-f]{64}$/);
    expect(view).toMatchObject({ skinHex: "#664D33", bodySize: "M", building: false });
  });

  it("job: a rejected capture keeps the retake checks, deletes the frames and is never billed", async () => {
    const checks = { ok: false, checks: { rotation: { pass: false, note: "turn slowly" } } };
    const h = harness({ jobs: [{ status: "REJECTED", progress: 100, result: { status: "REJECTED", checks, model_version: "m" } }] });
    const v = await h.svc.capture("u1", yaws24.map(() => ({ buffer: Buffer.from("j"), mimetype: "image/jpeg", size: 1 })), yaws24);
    await h.svc.process(v.id);
    expect(h.avatars.rows[0]).toMatchObject({ status: "REJECTED", checks, framesPath: null });
    expect(h.storage.files.size).toBe(0);
    expect(h.usage).toHaveLength(0);
  });

  it("job: a gateway failure (lost job) marks FAILED", async () => {
    const h = harness({ jobs: [] });
    const v = await h.svc.fromMeasurements("u1", [0.3, 0.2, 0.1]);
    await h.svc.process(v.id);
    expect(h.avatars.rows[0]).toMatchObject({ status: "FAILED" });
    expect(h.svc.view(h.avatars.rows[0] as never).error).toMatch(/try again/);
  });

  it("withdrawing the 3D consent deletes every version; files are refused afterwards", async () => {
    const h = harness({ jobs: [done()] });
    const v = await h.svc.fromMeasurements("u1", [0.3, 0.2, 0.1]);
    await h.svc.process(v.id);
    const glbPath = h.avatars.rows[0].glbPath as string;
    expect((await h.svc.file(glbPath)).type).toBe("model/gltf-binary");
    const after = await h.svc.setConsent("u1", false, "en");
    expect(after).toMatchObject({ consent: false, removed: 1, avatar: null });
    expect(h.storage.files.size).toBe(0);
    await expect(h.svc.file(glbPath)).rejects.toBeTruthy();
  });

  it("export lists versions and the body parameters used, never the GLB bytes", async () => {
    const h = harness({ jobs: [done()] });
    const v = await h.svc.fromMeasurements("u1", [0.3, 0.2, 0.1]);
    await h.svc.process(v.id);
    const out = await h.svc.exportFor("u1");
    expect(out.avatars[0]).toMatchObject({ version: 1, source: "MEASUREMENTS", status: "READY", bodyParameters: { skin_hex: "#664D33" } });
    expect(JSON.stringify(out)).not.toContain("glTF");
  });
});

describe("3D try-on (E34)", () => {
  const dress = { glb_b64: "Z2xURg==", poster_b64: "cG5n", fit: { fit: "regular", ease_m: 0.02 }, triangles: 13_000, bytes: 450_000, model_version: "parametric-body@1.0+wrap-fit@1.0" };
  const ready = async (h: ReturnType<typeof harness>) => {
    const v = await h.svc.fromMeasurements("u1", [0.3, 0.2, 0.1]);
    await h.svc.process(v.id);
    return h.avatars.rows[0];
  };

  it("needs a ready twin (and the consent)", async () => {
    const h = harness();
    await expect(h.svc.fit("u1", "v1")).rejects.toMatchObject({ status: 400, response: { code: "NO_AVATAR" } });
    await expect(harness({ consent: false }).svc.fit("u1", "v1")).rejects.toMatchObject({ status: 403 });
  });

  it("queues a fit at the recommended size, then dresses, stores privately and meters", async () => {
    const h = harness({ jobs: [done({ body_size: "L" })], dress });
    const avatar = await ready(h);
    await expect(h.svc.fit("u1", "bag")).rejects.toMatchObject({ status: 400 });
    const f = await h.svc.fit("u1", "v1");
    expect(f).toMatchObject({ size: "L", status: "QUEUED", glb: null, disclaimer: "Visual guidance only. Actual fit may differ." });
    expect(h.generations.enqueue).toHaveBeenLastCalledWith(FIT_JOB, { id: f.id }, expect.stringMatching(/^avatarfit-/));
    await h.svc.processFit(f.id);
    const view = await h.svc.getFit("u1", f.id);
    expect(view).toMatchObject({ status: "READY", fit: { fit: "regular" } });
    expect(view.glb).toContain(encodeURIComponent(`private/avatars/u1/v${avatar.version}/fits/v1-L.glb.enc`));
    expect(h.usage.at(-1)).toEqual([FIT_COST.kind, "FREE_QUOTA", FIT_COST.costRwf, "u1", null, f.id]);
    expect(h.ai.post).toHaveBeenLastCalledWith("/v1/avatar/dress", expect.objectContaining({ category: "dress", size: "L", params: expect.objectContaining({ skin_rgb: [0.4, 0.3, 0.2] }) }), 60_000);
    // Same piece and size again: the cached fit, no new job.
    const calls = h.generations.enqueue.mock.calls.length;
    expect((await h.svc.fit("u1", "v1", "l")).id).toBe(f.id);
    expect(h.generations.enqueue.mock.calls.length).toBe(calls);
    // Another size is a separate fit.
    expect((await h.svc.fit("u1", "v1", "S")).size).toBe("S");
  });

  it("a fit for a replaced twin fails cleanly", async () => {
    const h = harness({ jobs: [done()], dress });
    const avatar = await ready(h);
    const f = await h.svc.fit("u1", "v1", "M");
    avatar.deletedAt = new Date();
    await expect(h.svc.processFit(f.id)).rejects.toThrow(/replaced or deleted/);
    expect(h.fits.rows[0]).toMatchObject({ status: "FAILED" });
  });
});
