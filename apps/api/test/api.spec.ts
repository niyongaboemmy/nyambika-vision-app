import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

const { AppModule } = await import("../src/app.module");
const { PrismaService } = await import("../src/common/prisma.service");

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const uniq = String(Date.now()).slice(-6);

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return agent;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe("identity", () => {
  it("rejects a wrong OTP and accepts the right one", async () => {
    const phone = `0789${uniq}`;
    const agent = request.agent(app.getHttpServer());
    const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
    const wrong = r.body.devCode === "000000" ? "111111" : "000000";
    await agent.post("/auth/otp/verify").send({ phone, code: wrong }).expect(401);
    const ok = await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
    expect(ok.body.user.phone).toBe(`+250789${uniq}`);
    const me = await agent.get("/auth/me").expect(200);
    expect(me.body.user.roles.map((x: { role: string }) => x.role)).toContain("SHOPPER");
  });
});

describe("tenant isolation (ADR-0003)", () => {
  let pageA: string;
  let ownerA: request.Agent;
  let ownerB: request.Agent;

  beforeAll(async () => {
    ownerA = await login(`0781${uniq}`);
    ownerB = await login(`0782${uniq}`);
    const a = await ownerA.post("/pages").send({ handle: `tenant-a-${uniq}`, name: "Tenant A", memberType: "TAILOR" }).expect(201);
    pageA = a.body.id;
    await ownerB.post("/pages").send({ handle: `tenant-b-${uniq}`, name: "Tenant B", memberType: "SELLER" }).expect(201);
  });

  it("lets the owner manage their page", async () => {
    await ownerA.get(`/pages/${pageA}`).expect(200);
    await ownerA
      .post(`/pages/${pageA}/products`)
      .send({ title: "A dress", category: "dress", priceRwf: 30000, variants: [{ colourName: "Red", colourHex: "#c0392b", sizes: ["M"], stock: 1 }] })
      .expect(201);
  });

  it("blocks another member from reading or changing it", async () => {
    await ownerB.get(`/pages/${pageA}`).expect(403);
    await ownerB.patch(`/pages/${pageA}`).send({ name: "Hijacked" }).expect(403);
    await ownerB.get(`/pages/${pageA}/products`).expect(403);
    await ownerB.get(`/pages/${pageA}/orders`).expect(403);
    await ownerB.get(`/pages/${pageA}/analytics`).expect(403);
  });

  it("enforces one page per member (FR-PAGE-01)", async () => {
    await ownerA.post("/pages").send({ handle: `tenant-a2-${uniq}`, name: "Second", memberType: "TAILOR" }).expect(409);
  });

  it("keeps unverified pages out of public view", async () => {
    await request(app.getHttpServer()).get(`/pages/by-handle/tenant-a-${uniq}`).expect(404);
  });

  it("restricts admin routes to host roles", async () => {
    await ownerA.get("/admin/overview").expect(403);
  });
});

describe("privacy", () => {
  it("keeps a verifiable consent ledger that detects tampering", async () => {
    const agent = await login(`0783${uniq}`);
    await agent.post("/privacy/consents").send({ purpose: "MARKETING", granted: true }).expect(201);
    await agent.post("/privacy/consents").send({ purpose: "MARKETING", granted: false }).expect(201);
    let s = await agent.get("/privacy").expect(200);
    expect(s.body.ledgerVerified).toBe(true);
    const me = await agent.get("/auth/me");
    const rec = await prisma.consentRecord.findFirstOrThrow({ where: { userId: me.body.user.id }, orderBy: { createdAt: "asc" } });
    await prisma.consentRecord.update({ where: { id: rec.id }, data: { granted: false } });
    s = await agent.get("/privacy").expect(200);
    expect(s.body.ledgerVerified).toBe(false);
  });

  it("requires explicit consent to create a twin", async () => {
    const agent = await login(`0784${uniq}`);
    await agent.post("/twin").field("consent", "false").attach("file", Buffer.from("x"), "a.png").expect(400);
  });
});

describe("payments", () => {
  it("rejects webhooks without a valid signature", async () => {
    await request(app.getHttpServer())
      .post("/payments/webhook/mock")
      .set("x-signature", "deadbeef")
      .send({ referenceId: "MOCK-x", status: "SUCCESSFUL" })
      .expect(401);
  });

  it("requires an idempotency key to hold-to-buy", async () => {
    const agent = await login(`0785${uniq}`);
    await agent.post("/orders").send({}).expect(400);
  });
});
