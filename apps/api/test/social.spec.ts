import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// E25 Ask your circle + E26 Digital wardrobe, end to end against the real Nest app and database.
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let storage: import("../src/common/storage.service").StorageService;
let circle: import("../src/modules/circle/circle.module").CircleService;
const uniq = String(Date.now()).slice(-6);
let aiUp = false;

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return agent;
}

/** A delivered look without calling the AI gateway: a synthetic image written to private storage. */
async function seedLook(userId: string, sessionId: string, variantId: string, rank: number) {
  const v = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
  const img = await sharp({ create: { width: 288, height: 512, channels: 3, background: v.colourHex } }).png().toBuffer();
  const outputPath = await storage.put(`private/looks/${userId}/test-${uniq}-${rank}.png`, img);
  const gen = await prisma.generation.create({
    data: { userId, variantId, twinVersion: 0, modelVersion: "test", cacheKey: `test-${uniq}-${userId}-${rank}`, status: "DELIVERED", outputPath },
  });
  return prisma.look.create({ data: { userId, intentSessionId: sessionId, productId: v.productId, variantId, rank, generationId: gen.id } });
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { StorageService } = await import("../src/common/storage.service");
  const { CircleService } = await import("../src/modules/circle/circle.module");
  const { MemoryCounterStore } = await import("../src/modules/circle/guards");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  storage = app.get(StorageService);
  circle = app.get(CircleService);
  circle.counters = new MemoryCounterStore();
  aiUp = await fetch(`${process.env.AI_GATEWAY_URL ?? "http://localhost:8100"}/health`).then((r) => r.ok).catch(() => false);
});

afterAll(async () => {
  await app?.close();
});

describe("ask your circle (E25)", () => {
  let owner: request.Agent;
  let ownerId: string;
  let lookIds: string[];
  let poll: { id: string; token: string; options: { id: string }[] };

  beforeAll(async () => {
    const phone = `0783${uniq}`;
    owner = await login(phone);
    ownerId = (await owner.get("/auth/me")).body.user.id;
    const session = await prisma.intentSession.create({ data: { userId: ownerId, input: "test", source: "text", intent: {} } });
    const variants = await prisma.variant.findMany({ where: { cutoutPath: { not: null }, product: { status: "PUBLISHED" } }, take: 3 });
    lookIds = [];
    for (const [i, v] of variants.entries()) lookIds.push((await seedLook(ownerId, session.id, v.id, i)).id);
  });

  it("requires explicit consent and only the shopper's own finished looks", async () => {
    await owner.post("/circle/polls").send({ lookIds: lookIds.slice(0, 2), question: "Which one for Saturday?" }).expect(400);
    const other = await login(`0784${uniq}`);
    await other.post("/circle/polls").send({ lookIds: lookIds.slice(0, 2), question: "Mine?", consent: true }).expect(400);
    await owner.post("/circle/polls").send({ lookIds: [lookIds[0]], question: "One?", consent: true }).expect(400);
  });

  it("creates a poll with watermarked copies, records consent and keeps originals private", async () => {
    const r = await owner.post("/circle/polls").send({ lookIds: lookIds.slice(0, 3), question: "Which one for Saturday?", consent: true }).expect(201);
    poll = r.body;
    expect(poll.options).toHaveLength(3);
    expect(r.body.shareUrl).toMatch(new RegExp(`/c/${poll.token}$`));
    const consents = await prisma.consentRecord.findMany({ where: { userId: ownerId, purpose: "CIRCLE_SHARE", granted: true } });
    expect(consents.length).toBe(1);
    const rows = await prisma.circleOption.findMany({ where: { pollId: poll.id } });
    const looks = await prisma.look.findMany({ where: { id: { in: lookIds } }, include: { generation: true } });
    for (const o of rows) {
      expect(o.imagePath).toMatch(/^private\/polls\//);
      expect(looks.map((l) => l.generation!.outputPath)).not.toContain(o.imagePath);
    }
    const img = await request(app.getHttpServer()).get(`/c/${poll.token}/img/${poll.options[0].id}`).expect(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    const og = await request(app.getHttpServer()).get(`/c/${poll.token}/og.jpg`).expect(200);
    expect((await sharp(og.body).metadata()).width).toBe(1200);
  });

  it("lets anyone vote without an account, one vote per device", async () => {
    const friend = request.agent(app.getHttpServer());
    const view = await friend.get(`/c/${poll.token}`).expect(200);
    expect(view.body.state).toBe("OPEN");
    expect(String(view.headers["set-cookie"])).toMatch(/nya_dv=/);
    await friend.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[0].id, name: "Grace", comment: "So elegant", emoji: "💙" }).expect(201);
    const again = await friend.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[1].id }).expect(201);
    expect(again.body.total).toBe(1);
    expect(again.body.myVote.optionId).toBe(poll.options[1].id);
    const friend2 = request.agent(app.getHttpServer());
    await friend2.get(`/c/${poll.token}`);
    const r2 = await friend2.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[1].id }).expect(201);
    expect(r2.body.total).toBe(2);
    expect(r2.body.options[1]).toMatchObject({ votes: 2, pct: 100 });
    // A forged device cookie is ignored and replaced, never trusted.
    const forged = await request(app.getHttpServer()).get(`/c/${poll.token}`).set("cookie", "nya_dv=abc.def");
    expect(String(forged.headers["set-cookie"])).toMatch(/nya_dv=/);
    // Invalid input
    await friend2.post(`/c/${poll.token}/vote`).send({ optionId: "nope" }).expect(400);
    await friend2.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[0].id, emoji: "💩" }).expect(400);
  });

  it("rate-limits a device hammering the vote button", async () => {
    const spammer = request.agent(app.getHttpServer());
    await spammer.get(`/c/${poll.token}`);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await spammer.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[i % 3].id })).status);
    expect(codes.slice(0, 6).every((c) => c === 201)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
  });

  it("shows the owner live results and comments; nobody else can open the owner view", async () => {
    const r = await owner.get(`/circle/polls/${poll.id}`).expect(200);
    expect(r.body.total).toBe(3);
    expect(r.body.comments.some((c: { name: string; comment: string }) => c.name === "Grace" && c.comment === "So elegant")).toBe(true);
    expect(r.body.winner).toBe(lookIds[1]);
    expect(r.body.options[1].look.id).toBe(lookIds[1]);
    const maker = await login("0788100001");
    await maker.get(`/circle/polls/${poll.id}`).expect(404);
    const host = await login("0788900001");
    await host.get(`/circle/polls/${poll.id}`).expect(404);
  });

  it("streams snapshots over Server-Sent Events", async () => {
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((ok) => server.listen(0, ok));
    const port = (server.address() as { port: number }).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/c/${poll.token}/stream`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    let text = "";
    const until = async (re: RegExp) => {
      while (!re.test(text)) {
        const { value } = await reader.read();
        text += new TextDecoder().decode(value);
      }
    };
    await until(/event: snapshot\ndata: .*"total":3/);
    const friend = request.agent(server);
    await friend.get(`/c/${poll.token}`);
    await friend.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[2].id, comment: "Green!" }).expect(201);
    await until(/"total":4/);
    ctrl.abort();
  });

  it("closes on expiry: no images, no votes, shared copies swept", async () => {
    await prisma.circlePoll.update({ where: { id: poll.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const v = await request(app.getHttpServer()).get(`/c/${poll.token}`).expect(200);
    expect(v.body).toMatchObject({ state: "EXPIRED", options: [] });
    await request(app.getHttpServer()).get(`/c/${poll.token}/img/${poll.options[0].id}`).expect(404);
    await request(app.getHttpServer()).get(`/c/${poll.token}/og.jpg`).expect(404);
    const friend = request.agent(app.getHttpServer());
    await friend.post(`/c/${poll.token}/vote`).send({ optionId: poll.options[0].id }).expect(410);
    expect(await circle.sweep()).toBeGreaterThanOrEqual(1);
    const rows = await prisma.circleOption.findMany({ where: { pollId: poll.id } });
    await expect(storage.read(rows[0].imagePath)).rejects.toThrow();
    // The owner still has results, now shown with their private originals.
    const owned = await owner.get(`/circle/polls/${poll.id}`).expect(200);
    expect(owned.body.state).toBe("EXPIRED");
    expect(owned.body.options[0].image).toMatch(/^\/api\/private\/look/);
  });

  it("can be revoked by the owner at any time", async () => {
    const r = await owner.post("/circle/polls").send({ lookIds: lookIds.slice(0, 2), question: "Second?", consent: true, hours: 24 }).expect(201);
    expect(new Date(r.body.expiresAt).getTime() - Date.now()).toBeLessThan(24 * 3600_000 + 5000);
    await request(app.getHttpServer()).get(`/c/${r.body.token}/img/${r.body.options[0].id}`).expect(200);
    const other = await login(`0785${uniq}`);
    await other.post(`/circle/polls/${r.body.id}/revoke`).expect(404);
    const rv = await owner.post(`/circle/polls/${r.body.id}/revoke`).expect(201);
    expect(rv.body.state).toBe("REVOKED");
    await request(app.getHttpServer()).get(`/c/${r.body.token}/img/${r.body.options[0].id}`).expect(404);
    expect((await request(app.getHttpServer()).get(`/c/${r.body.token}`)).body.state).toBe("REVOKED");
  });

  it("is part of the data export and the deletion cascade", async () => {
    const exp = await owner.get("/privacy/export").expect(200);
    const body = JSON.parse(exp.text);
    expect(body.circlePolls.length).toBe(2);
    expect(body.wardrobe).toBeTruthy();
    await owner.post("/privacy/delete").send({ scope: "LOOKS" }).expect(201);
    expect(await prisma.circlePoll.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.circleVote.count({ where: { pollId: poll.id } })).toBe(0);
  });
});

describe("digital wardrobe (E26)", () => {
  let shopper: request.Agent;
  let userId: string;

  beforeAll(async () => {
    shopper = await login(`0786${uniq}`);
    userId = (await shopper.get("/auth/me")).body.user.id;
    // Owned piece: a delivered office shirt.
    const shirt = await prisma.variant.findFirstOrThrow({ where: { cutoutPath: { not: null }, product: { category: "shirt", status: "PUBLISHED", occasions: { has: "office" } } }, include: { product: true } });
    await prisma.order.create({
      data: {
        code: `NY-T${uniq}`,
        pageId: shirt.product.pageId,
        shopperId: userId,
        status: "DELIVERED",
        totalRwf: shirt.product.priceRwf,
        deliveryMode: "PICKUP",
        wallet: "MTN_MOMO",
        payerPhone: "+250786000000",
        payoutMsisdn: "+250780000000",
        payoutLabel: "Test",
        idempotencyKey: `wardrobe-${uniq}`,
        items: { create: { productId: shirt.productId, variantId: shirt.id, title: shirt.product.title, colourName: shirt.colourName, size: "M", unitPriceRwf: shirt.product.priceRwf } },
      },
    });
  });

  it("lists owned pieces from delivered orders only", async () => {
    const r = await shopper.get("/wardrobe").expect(200);
    expect(r.body.owned).toHaveLength(1);
    expect(r.body.owned[0]).toMatchObject({ category: "shirt", slot: "TOP" });
    const item = await shopper.get(`/wardrobe/items/${r.body.owned[0].id}`).expect(200);
    expect(item.body.title).toBe(r.body.owned[0].title);
    const stranger = await login(`0787${uniq}`);
    await stranger.get(`/wardrobe/items/${r.body.owned[0].id}`).expect(404);
  });

  it("restyles for an event: 3 outfits with the owned shirt, rendered, then a WhatsApp reminder", async (ctx) => {
    if (!aiUp) ctx.skip();
    const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const r = await shopper.post("/wardrobe/events").send({ title: "Board presentation", occasion: "office", date, budgetMax: 40000 }).expect(201);
    expect(r.body.looks.length).toBe(3);
    for (const o of r.body.looks) {
      expect(o.pieces.some((p: { owned: boolean }) => p.owned)).toBe(true);
      expect(o.newCostRwf).toBeLessThanOrEqual(40000);
    }
    let ev = r.body;
    for (let i = 0; i < 60 && ev.looks.some((o: { status: string }) => ["QUEUED", "GENERATING", "GUARDING"].includes(o.status)); i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      ev = (await shopper.get(`/wardrobe/events/${r.body.id}`)).body;
    }
    expect(ev.looks.filter((o: { status: string }) => o.status === "DELIVERED").length).toBeGreaterThan(0);
    expect(ev.reminderSentAt).toBeTruthy();
    const usage = await prisma.usageEvent.count({ where: { userId, kind: "TRYON" } });
    expect(usage).toBeGreaterThan(0);
    const phone = (await shopper.get("/auth/me")).body.user.phone;
    const msg = await prisma.notification.findFirst({ where: { to: phone, template: "wardrobe_event_reminder" } });
    expect(msg?.body).toMatch(/Board presentation in 3 days: your outfit is ready/);
    const amb = await shopper.get("/wardrobe/ambient").expect(200);
    expect(amb.body.id).toBe(r.body.id);
  }, 60000);

  it("rejects past dates and respects the AI kill switch", async () => {
    await shopper.post("/wardrobe/events").send({ occasion: "office", date: "2020-01-01" }).expect(400);
    await prisma.featureFlag.upsert({ where: { key: "ai.kill_switch" }, create: { key: "ai.kill_switch", enabled: true }, update: { enabled: true } });
    try {
      const date = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
      await shopper.post("/wardrobe/events").send({ occasion: "office", date }).expect(503);
    } finally {
      await prisma.featureFlag.update({ where: { key: "ai.kill_switch" }, data: { enabled: false } });
    }
  });
});
