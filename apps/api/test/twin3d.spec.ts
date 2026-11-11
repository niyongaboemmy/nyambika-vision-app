import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";

// E33 3D twin + E34 3D try-on against the real app, database, queue and (when running) the AI gateway.
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let aiUp = false;
const phone = `0787${String(Date.now()).slice(-6)}`;

async function login(p: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone: p }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone: p, code: r.body.devCode }).expect(200);
  return agent;
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  aiUp = await fetch(`${process.env.AI_GATEWAY_URL ?? "http://localhost:8100"}/v1/avatar/models`).then((r) => r.ok).catch(() => false);
});

afterAll(async () => {
  await app?.close();
});

describe("3D twin: consent → persona turnaround → avatar → dressed fit → privacy (E33/E34)", () => {
  it("runs the full flow with a separate consent, encrypted storage and the deletion cascade", async () => {
    const s = await login(phone);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+250${phone.slice(1)}` } });

    // No consent yet: building is refused and nothing is stored.
    expect((await s.get("/twin3d").expect(200)).body).toMatchObject({ consent: false, avatar: null });
    await s.post("/twin3d/persona").send({ persona: 2, consent: true }).expect(403);
    await s.post("/twin3d/measurements").send({ skin: [0.4, 0.3, 0.2], consent: true }).expect(403);
    // The photo-twin consent does not imply the 3D one.
    await s.post("/twin/persona").send({ persona: 2, consent: true }).expect((r) => expect([200, 201, 503]).toContain(r.status));
    await s.post("/twin3d/persona").send({ persona: 2, consent: true }).expect(403);

    await s.post("/twin3d/consent").send({ granted: true }).expect(201);
    const ledger = await prisma.consentRecord.findFirst({ where: { userId: user.id, purpose: "AVATAR_3D", granted: true } });
    expect(ledger).toBeTruthy();
    if (!aiUp) return;

    const t = await s.get("/twin3d/personas/2/turnaround").expect(200);
    expect(t.body.frames).toHaveLength(24);
    const started = await s.post("/twin3d/persona").send({ persona: 2, consent: true }).expect(201);
    expect(started.body).toMatchObject({ version: 1, building: true });
    const built = await until(
      async () => (await s.get(`/twin3d/avatar/${started.body.id}`)).body,
      (b) => !b.building,
    );
    expect(built).toMatchObject({ status: "READY", joints: 18, version: 1 });
    expect(built.eval.passed).toBe(true);
    const row = await prisma.avatar3d.findUniqueOrThrow({ where: { id: built.id } });
    expect(row.framesPath).toBeNull(); // capture frames deleted after the build
    expect(row.paramsSealed?.startsWith("v1:")).toBe(true);

    // Signed, owner-only, decrypted GLB; tampered signature refused.
    const glb = await s
      .get(built.glb.replace(/^\/api/, ""))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(glb.headers["content-type"]).toBe("model/gltf-binary");
    expect((glb.body as Buffer).subarray(0, 4).toString("latin1")).toBe("glTF");
    await request(app.getHttpServer()).get(built.glb.replace(/^\/api/, "").replace(/sig=[0-9a-f]{4}/, "sig=0000")).expect(403);
    const onDisk = await prisma.avatar3d.findUniqueOrThrow({ where: { id: built.id } });
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(`${process.env.STORAGE_DIR ?? "./storage"}/${onDisk.glbPath}`);
    expect(raw.subarray(0, 4).toString("latin1")).not.toBe("glTF"); // encrypted at rest

    // Dress it: a published dress, the fit job, size switch.
    const variant = await prisma.variant.findFirstOrThrow({ where: { cutoutPath: { not: null }, product: { status: "PUBLISHED", category: "dress" } } });
    const g = await s.get(`/twin3d/garment/${variant.id}`).expect(200);
    expect(g.body).toMatchObject({ supported: true });
    const fit = await s.post("/twin3d/fit").send({ variantId: variant.id, size: "L" }).expect(201);
    const fitted = await until(async () => (await s.get(`/twin3d/fit/${fit.body.id}`)).body, (b) => b.status !== "QUEUED");
    expect(fitted).toMatchObject({ status: "READY", size: "L", disclaimer: "Visual guidance only. Actual fit may differ." });
    const usage = await prisma.usageEvent.findMany({ where: { userId: user.id, kind: { in: ["AVATAR_3D", "TRYON_3D"] } } });
    expect(usage.map((u) => u.kind).sort()).toEqual(["AVATAR_3D", "TRYON_3D"]);

    // FR-AVA-03: adjust → version 2 replaces version 1 (bytes and fits purged).
    const adj = await s.post("/twin3d/adjust").send({ measurements: { heightCm: 172 } }).expect(201);
    const v2 = await until(async () => (await s.get(`/twin3d/avatar/${adj.body.id}`)).body, (b) => !b.building);
    expect(v2).toMatchObject({ status: "READY", version: 2, measurements: expect.objectContaining({ heightCm: 172 }) });
    expect((await prisma.avatar3d.findUniqueOrThrow({ where: { id: built.id } })).deletedAt).toBeTruthy();
    expect(await prisma.avatarFit3d.count({ where: { avatarId: built.id } })).toBe(0);

    // Export (additive) and deletion cascade from the Trust centre.
    const exp = await s.get("/privacy/export").expect(200);
    expect(JSON.parse(exp.text).twin3d.avatars.length).toBeGreaterThanOrEqual(2);
    const del = await s.post("/privacy/delete").send({ scope: "TWIN" }).expect(201);
    expect(del.body.steps.map((x: { step: string }) => x.step)).toContain("3D twin deleted");
    expect(await prisma.avatar3d.count({ where: { userId: user.id, deletedAt: null } })).toBe(0);
    expect((await s.get("/twin3d").expect(200)).body).toMatchObject({ consent: false, avatar: null });
    await s.get(v2.glb.replace(/^\/api/, "")).expect((r) => expect([403, 404]).toContain(r.status));
  }, 120_000);
});
