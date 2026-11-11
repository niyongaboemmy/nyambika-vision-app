import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// Platform hardening pass 1: region on look renders (E42), the attr route + stored-policy compat (R4), coop maker
// training consent (R4). Own synthetic rows per run; nothing seeded is changed.
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
const uniq = String(Date.now()).slice(-6);
let aiUrl = "";
let aiUp = false;

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return agent;
}
const e164 = (p: string) => `+250${p.slice(1)}`;

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  aiUrl = (await import("../src/config")).config.aiUrl; // after dotenv: this app's own gateway
  aiUp = await fetch(`${aiUrl}/health`).then((r) => r.ok).catch(() => false);
});

afterAll(async () => {
  await app?.close();
});

describe("look generation passes the residency region to /v1/tryon (E42)", () => {
  it("uses the shopper's country first, then the page region, and still delivers with routing off", async (ctx) => {
    if (!aiUp) ctx.skip();
    const { AiClient } = await import("../src/common/ai.client");
    const { GenerationService } = await import("../src/modules/looks/generation.service");
    const ai = app.get(AiClient);
    const bodies: Record<string, unknown>[] = [];
    const real = ai.post.bind(ai);
    const spy = vi.spyOn(ai, "post").mockImplementation(async (path: string, body: unknown, ...rest: unknown[]) => {
      if (path === "/v1/tryon") bodies.push(body as Record<string, unknown>);
      return (real as (...a: unknown[]) => Promise<unknown>)(path, body, ...rest);
    });
    onTestFinished(() => spy.mockRestore());
    const gens = app.get(GenerationService);
    const shopper = await login(`0781${uniq}`);
    const userId = (await shopper.get("/auth/me")).body.user.id as string;
    // Persona renders are cached across users by (persona, variant, model): pick two that are not cached, and free
    // our rows afterwards so the next run can pick them again.
    const model = (await gens.model("PREVIEW")).id;
    const cached = new Set((await prisma.generation.findMany({ where: { cacheKey: { startsWith: "persona-3:v0|" } }, select: { cacheKey: true } })).map((g) => g.cacheKey));
    const variants = (await prisma.variant.findMany({ where: { cutoutPath: { not: null }, product: { status: "PUBLISHED" } }, include: { product: true }, orderBy: { id: "asc" } }))
      .filter((v) => !cached.has(`persona-3:v0|${v.id}|${model}`))
      .slice(0, 2);
    expect(variants).toHaveLength(2);
    onTestFinished(async () => {
      await prisma.generation.deleteMany({ where: { userId } });
    });
    const pageId = variants[1].product.pageId;
    const pageRegion = await prisma.pageRegion.findUnique({ where: { pageId } });
    await prisma.pageRegion.upsert({ where: { pageId }, create: { pageId, region: "UG" }, update: { region: "UG" } });
    onTestFinished(async () => {
      if (pageRegion) await prisma.pageRegion.update({ where: { pageId }, data: { region: pageRegion.region } });
      else await prisma.pageRegion.delete({ where: { pageId } });
    });
    const wait = async (id: string) => {
      for (const until = Date.now() + 60_000; Date.now() < until; ) {
        const g = await prisma.generation.findUniqueOrThrow({ where: { id } });
        if (["DELIVERED", "WITHHELD", "FAILED"].includes(g.status)) return g;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("generation did not finish");
    };
    await prisma.shopperPrefs.upsert({ where: { userId }, create: { userId, country: "KE" }, update: { country: "KE" } });
    const a = await wait((await gens.ensure(userId, variants[0].id, "PREVIEW", 3)).id);
    expect(a.status).toBe("DELIVERED"); // the dev gateway ignores the region unless routing is on
    expect(bodies.at(-1)?.region).toBe("KE");
    await prisma.shopperPrefs.delete({ where: { userId } });
    const b = await wait((await gens.ensure(userId, variants[1].id, "PREVIEW", 3)).id);
    expect(b.status).toBe("DELIVERED");
    expect(bodies.at(-1)?.region).toBe("UG"); // no shopper country: the page's region
    expect(bodies.at(-1)?.request_id).toBe(b.id);
  }, 120_000);
});

describe("inference routing list includes attr; stored policies stay valid (R4 compat)", () => {
  it("upgrades a policy stored before attr existed, shows attr in the admin panel and accepts edits", async (ctx) => {
    if (!aiUp) ctx.skip();
    const { InferenceService } = await import("../src/modules/inference/inference.service");
    const svc = app.get(InferenceService);
    const original = await prisma.inferencePolicy.findUnique({ where: { id: "default" } });
    onTestFinished(async () => {
      if (original) await prisma.inferencePolicy.update({ where: { id: "default" }, data: { policy: original.policy as object, version: original.version } });
      else await prisma.inferencePolicy.deleteMany({ where: { id: "default" } });
      await svc.sync().catch(() => undefined);
    });
    const live = await svc.sync();
    const { attr: _a, ...legacyRoutes } = live.policy.routes as Record<string, unknown>;
    const version = (original?.version ?? 1) + 50;
    // Exactly what E42 stored: five routes, plus a key an older API rejected.
    await prisma.inferencePolicy.upsert({
      where: { id: "default" },
      create: { id: "default", policy: { ...live.policy, version, routes: legacyRoutes } as object, version },
      update: { policy: { ...live.policy, version, routes: legacyRoutes } as object, version },
    });
    await svc.sync();
    const row = await prisma.inferencePolicy.findUniqueOrThrow({ where: { id: "default" } });
    expect(row.version).toBe(version);
    expect(Object.keys((row.policy as { routes: object }).routes).sort()).toEqual(["attr", "avatar", "llm", "stt", "tryon", "video"]);
    expect((row.policy as { routes: Record<string, { strategy: string; residency: string }> }).routes.attr).toMatchObject({ strategy: "pool-only", residency: "in-region" });

    const host = await login("0788900001");
    const panel = (await host.get("/admin/inference").expect(200)).body;
    expect(panel.routes.map((r: { route: string }) => r.route)).toContain("attr");
    // Editing any route works on the upgraded policy (with attr unknown to the schema this was a 500 before).
    const tryon = panel.routes.find((r: { route: string }) => r.route === "tryon").policy;
    const r = await host.put("/admin/inference/policy/tryon").send({ policy: { ...tryon, latency_slo_ms: tryon.latency_slo_ms + 1 } }).expect(200);
    expect(r.body.version).toBe(version + 1);
    const attr = panel.routes.find((x: { route: string }) => x.route === "attr").policy;
    await host.put("/admin/inference/policy/attr").send({ policy: { ...attr, latency_slo_ms: 1800 } }).expect(200);
    const gw = await fetch(`${aiUrl}/v1/inference/status`).then((x) => x.json());
    expect(gw.policy.routes.attr.latency_slo_ms).toBe(1800);
  }, 60_000);
});

describe("coop training data needs the credited maker's consent too (R4)", () => {
  it("admin yes + maker yes → included; either withdrawal removes it and leaves a tombstone", async () => {
    const adminPhone = `0782${uniq}`;
    const makerPhone = `0783${uniq}`;
    const other = await login(`0784${uniq}`);
    const admin = await login(adminPhone);
    const maker = await login(makerPhone);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { phone: e164(adminPhone) } });
    const makerUser = await prisma.user.findUniqueOrThrow({ where: { phone: e164(makerPhone) } });
    const page = await prisma.page.create({ data: { handle: `coop-tr-${uniq}`, name: `Coop ${uniq}`, memberType: "COOPERATIVE", status: "PUBLISHED", roles: { create: [{ userId: adminUser.id, role: "COOP_ADMIN" }, { userId: makerUser.id, role: "COOP_MEMBER" }] } } });
    const m = await prisma.coopMember.create({ data: { pageId: page.id, name: "Test Maker", userId: makerUser.id } });
    const mk = (title: string, credited: boolean) =>
      prisma.product.create({ data: { pageId: page.id, title, category: "dress", priceRwf: 20000, status: "PUBLISHED", ...(credited ? { makers: { create: { coopMemberId: m.id } } } : {}) } });
    const hers = await mk("Her dress", true);
    const coopOwn = await mk("Coop dress", false);
    const included = async () => Object.fromEntries((await admin.get(`/pages/${page.id}/training-data`).expect(200)).body.products.map((p: { id: string; included: boolean }) => [p.id, p.included]));

    await admin.put(`/pages/${page.id}/training-data`).send({ optedIn: true }).expect(200);
    expect(await included()).toEqual({ [hers.id]: false, [coopOwn.id]: true }); // maker has not said yes yet
    const st = (await admin.get(`/pages/${page.id}/training-data`)).body.products.find((p: { id: string }) => p.id === hers.id);
    expect(st).toMatchObject({ waitingForMaker: true, makers: [{ name: "Test Maker", consented: false }] });

    // Only the credited maker can give the maker's consent.
    await other.get(`/pages/${page.id}/training-data/maker`).expect(403);
    await admin.put(`/pages/${page.id}/training-data/maker`).send({ consented: true }).expect(403);
    const yes = (await maker.put(`/pages/${page.id}/training-data/maker`).send({ consented: true }).expect(200)).body;
    expect(yes).toMatchObject({ consented: true, pieces: [{ id: hers.id, coopShares: true, included: true }] });
    expect(await included()).toEqual({ [hers.id]: true, [coopOwn.id]: true });
    expect(await prisma.consentRecord.count({ where: { userId: makerUser.id, purpose: `TRAINING_DATA_MAKER:${page.id}:${m.id}`, granted: true } })).toBe(1);

    // Maker withdraws → out, tombstone for her piece only, audit-logged.
    await maker.put(`/pages/${page.id}/training-data/maker`).send({ consented: false }).expect(200);
    expect(await included()).toEqual({ [hers.id]: false, [coopOwn.id]: true });
    expect(await prisma.trainingTombstone.findMany({ where: { pageId: page.id }, select: { productId: true, reason: true } })).toEqual([{ productId: hers.id, reason: "maker withdrawn" }]);
    expect(await prisma.auditLog.count({ where: { actorId: makerUser.id, action: "training_data.maker_consent" } })).toBe(2);

    // Maker back in; the admin keeps her piece out → out again, with a tombstone from the admin's side.
    await maker.put(`/pages/${page.id}/training-data/maker`).send({ consented: true }).expect(200);
    expect((await included())[hers.id]).toBe(true);
    await admin.put(`/pages/${page.id}/training-data/products/${hers.id}`).send({ included: false }).expect(200);
    expect((await included())[hers.id]).toBe(false);
    expect((await maker.get(`/pages/${page.id}/training-data/maker`)).body.pieces[0]).toMatchObject({ coopShares: false, included: false });
    expect(await prisma.trainingTombstone.count({ where: { pageId: page.id, productId: hers.id, reason: "product withdrawn" } })).toBe(1);
  });
});
