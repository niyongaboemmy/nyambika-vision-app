import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";

// E35 3D shelf, VR showroom data and virtual fashion shows, end to end against the real Nest app and database.
let app: INestApplication;
let base: string;
let prisma: import("../src/common/prisma.service").PrismaService;
let vr: import("../src/modules/vr/vr.service").VrService;
let pageId: string;
let products: { id: string; title: string }[];
const uniq = String(Date.now()).slice(-6);
const created: string[] = [];

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return agent;
}

/** Open an SSE stream and resolve with the first snapshot; returns a closer. */
function openStream(showId: string): Promise<{ first: { viewers: number }; next: () => Promise<Record<string, unknown>>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const queue: Record<string, unknown>[] = [];
    const waiters: ((v: Record<string, unknown>) => void)[] = [];
    let buf = "";
    const req = http.get(`${base}/vr/public/shows/${showId}/stream`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (!block.includes("event: snapshot") || !data) continue;
          const snap = JSON.parse(data.slice(6));
          const w = waiters.shift();
          if (w) w(snap);
          else queue.push(snap);
        }
      });
    });
    req.on("error", reject);
    const next = () => new Promise<Record<string, unknown>>((r) => (queue.length ? r(queue.shift()!) : waiters.push(r)));
    void next().then((first) => resolve({ first: first as { viewers: number }, next, close: () => req.destroy() }));
  });
}

const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { VrService } = await import("../src/modules/vr/vr.service");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  await new Promise<void>((r) => app.getHttpServer().listen(0, r));
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  prisma = app.get(PrismaService);
  vr = app.get(VrService);
  const page = await prisma.page.findUniqueOrThrow({ where: { handle: "umurage-wear" } });
  pageId = page.id;
  products = await prisma.product.findMany({ where: { pageId, status: "PUBLISHED" }, take: 3, orderBy: { createdAt: "asc" } });
});

afterAll(async () => {
  if (prisma && created.length) await prisma.fashionShow.deleteMany({ where: { id: { in: created } } });
  await app?.close();
});

describe("3D shelf + showroom (E35)", () => {
  it("serves approved 3D pieces only, shaped for the shelf and the room", async () => {
    const shelf = (await request(app.getHttpServer()).get("/vr/public/pages/umurage-wear/shelf").expect(200)).body;
    expect(shelf.items.length).toBeGreaterThan(0);
    const approved = await prisma.garmentAsset3d.findMany({ where: { pageId, approved: true, status: "READY" }, select: { productId: true } });
    for (const i of shelf.items) {
      expect(approved.map((a) => a.productId)).toContain(i.productId);
      expect(i.glb).toMatch(/^\/api\/files\/public\/media\/.+\.glb$/);
    }
    const room = (await request(app.getHttpServer()).get("/vr/public/pages/umurage-wear/showroom").expect(200)).body;
    expect(room.budget.totalBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
    expect(room.page.palette.primary).toMatch(/^#/);
    expect(room.items[0].variants[0]).toHaveProperty("sizes");
  });

  it("booth settings are manager-only and featured ids are filtered to the page", async () => {
    const shopper = await login(`0789${uniq}1`);
    await shopper.put(`/vr/pages/${pageId}/booth`).send({ enabled: true, banner: "x", featured: [] }).expect(403);
    const tailor = await login("0788100001");
    const before = await prisma.showroomBooth.findUnique({ where: { pageId } });
    const r = await tailor.put(`/vr/pages/${pageId}/booth`).send({ enabled: true, banner: "Test banner", featured: [products[0].id, "not-a-product"] }).expect(200);
    expect(r.body.featured).toEqual([products[0].id]);
    if (before) await prisma.showroomBooth.update({ where: { pageId }, data: { banner: before.banner, featured: before.featured, enabled: before.enabled } });
  });
});

describe("fashion shows: scheduling, RSVP, reminders, live counts (FR-VR-05)", () => {
  let showId: string;

  it("validates and schedules a show, queuing the runway build", async () => {
    const tailor = await login("0788100001");
    await tailor.post(`/vr/pages/${pageId}/shows`).send({ title: "Too late", startsAt: inMin(-30), items: [{ productId: products[0].id }] }).expect(400);
    await tailor.post(`/vr/pages/${pageId}/shows`).send({ title: "Dupes", startsAt: inMin(30), items: [{ productId: products[0].id }, { productId: products[0].id }] }).expect(400);
    const other = await prisma.product.findFirstOrThrow({ where: { pageId: { not: pageId }, status: "PUBLISHED" } });
    await tailor.post(`/vr/pages/${pageId}/shows`).send({ title: "Foreign", startsAt: inMin(30), items: [{ productId: other.id }] }).expect(400);
    const shopper = await login(`0789${uniq}2`);
    await shopper.post(`/vr/pages/${pageId}/shows`).send({ title: "Not mine", startsAt: inMin(30), items: [{ productId: products[0].id }] }).expect(403);

    const r = await tailor.post(`/vr/pages/${pageId}/shows`).send({ title: `Test show ${uniq}`, startsAt: inMin(120), items: products.slice(0, 2).map((p) => ({ productId: p.id })) }).expect(201);
    showId = r.body.id;
    created.push(showId);
    const items = await prisma.fashionShowItem.findMany({ where: { showId }, orderBy: { position: "asc" } });
    expect(items.map((i) => i.productId)).toEqual(products.slice(0, 2).map((p) => p.id));
    const pub = (await request(app.getHttpServer()).get(`/vr/public/shows/${showId}`).expect(200)).body;
    expect(pub).toMatchObject({ phase: "UPCOMING", rsvps: 0, going: false });
    expect(pub.model.label).toMatch(/synthetic/);
    const audit = await prisma.auditLog.findFirst({ where: { action: "show.schedule", pageId }, orderBy: { createdAt: "desc" } });
    expect(audit?.data).toMatchObject({ showId });
  });

  it("RSVP is idempotent, counted for the maker without identities, and reminds once inside the window", async () => {
    const phone = `0789${uniq}3`;
    const shopper = await login(phone);
    await request(app.getHttpServer()).post(`/vr/shows/${showId}/rsvp`).send({ going: true }).expect(401);
    expect((await shopper.post(`/vr/shows/${showId}/rsvp`).send({ going: true }).expect(201)).body).toMatchObject({ going: true, rsvps: 1 });
    expect((await shopper.post(`/vr/shows/${showId}/rsvp`).send({ going: true }).expect(201)).body.rsvps).toBe(1);
    expect((await shopper.get(`/vr/public/shows/${showId}`).expect(200)).body.going).toBe(true);
    const tailor = await login("0788100001");
    const studio = (await tailor.get(`/vr/pages/${pageId}`).expect(200)).body;
    const row = studio.shows.find((s: { id: string }) => s.id === showId);
    expect(row.rsvps).toBe(1);
    expect(JSON.stringify(studio)).not.toContain(phone.slice(1)); // makers never see who RSVP'd

    // 2 h ahead: nothing yet.
    const norm = `+250${phone.slice(1)}`;
    const sent = () => prisma.notification.count({ where: { template: "fashion_show_reminder", refId: showId } });
    expect(await vr.remindDue()).toBe(0);
    expect(await sent()).toBe(0);
    // The show moves to 30 min from now → the sweep sends exactly one WhatsApp reminder.
    await prisma.fashionShow.update({ where: { id: showId }, data: { startsAt: new Date(Date.now() + 30 * 60_000) } });
    expect(await vr.remindDue()).toBe(1);
    expect(await vr.remindDue()).toBe(0);
    const msg = await prisma.notification.findFirstOrThrow({ where: { template: "fashion_show_reminder", refId: showId } });
    expect(msg.channel).toBe("WHATSAPP");
    expect([phone, norm]).toContain(msg.to);
    expect(msg.body).toContain(`/m/umurage-wear/shows/${showId}`);

    // A late RSVP (already inside the window) is reminded right away.
    const late = await login(`0789${uniq}4`);
    await late.post(`/vr/shows/${showId}/rsvp`).send({ going: true }).expect(201);
    expect(await sent()).toBe(2);
    // Un-RSVP removes the row; cancelled shows never remind.
    await late.post(`/vr/shows/${showId}/rsvp`).send({ going: false }).expect(201);
    expect(await prisma.fashionShowRsvp.count({ where: { showId } })).toBe(1);
  });

  it("live: viewer count over SSE, reactions fan out, rate limits and phase rules", async () => {
    // Reactions are refused before doors open.
    await request(app.getHttpServer()).post(`/vr/public/shows/${showId}/react`).send({ emoji: "🔥" }).expect(400);
    await prisma.fashionShow.update({ where: { id: showId }, data: { startsAt: new Date(Date.now() - 2000) } });
    const a = await openStream(showId);
    const b = await openStream(showId);
    expect(b.first.viewers).toBe(2);
    expect(((await a.next()) as { viewers: number }).viewers).toBe(2); // A is told when B joins
    await request(app.getHttpServer()).post(`/vr/public/shows/${showId}/react`).send({ emoji: "🤡" }).expect(400);
    await request(app.getHttpServer()).post(`/vr/public/shows/${showId}/react`).send({ emoji: "🔥" }).expect(201);
    let snap = (await b.next()) as { reactions: Record<string, number>; phase: string; recent: { emoji: string }[] };
    while (snap.reactions["🔥"] < 1) snap = (await b.next()) as typeof snap;
    expect(snap.phase).toBe("LIVE");
    expect(snap.recent.at(-1)?.emoji).toBe("🔥");
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await request(app.getHttpServer()).post(`/vr/public/shows/${showId}/react`).send({ emoji: "👏" })).status);
    expect(codes).toContain(429);
    b.close();
    let left = (await a.next()) as { viewers: number };
    while (left.viewers !== 1) left = (await a.next()) as { viewers: number };
    expect(left.viewers).toBe(1);
    a.close();
    const track = (await request(app.getHttpServer()).get(`/vr/public/shows/${showId}/reactions`).expect(200)).body.reactions;
    expect(track.length).toBeGreaterThanOrEqual(12);
    expect(track[0].offsetMs).toBeGreaterThanOrEqual(0);
    expect((await prisma.fashionShow.findUniqueOrThrow({ where: { id: showId } })).peakViewers).toBeGreaterThanOrEqual(2);
  });

  it("cancel: no reminders, RSVPs refused; privacy export and account deletion cover RSVPs", async () => {
    const tailor = await login("0788100001");
    const r = await tailor.post(`/vr/pages/${pageId}/shows`).send({ title: `Cancel me ${uniq}`, startsAt: inMin(20), items: [{ productId: products[0].id }] }).expect(201);
    created.push(r.body.id);
    const phone = `0789${uniq}5`;
    const shopper = await login(phone);
    await shopper.post(`/vr/shows/${r.body.id}/rsvp`).send({ going: true }).expect(201);
    expect(await prisma.notification.count({ where: { template: "fashion_show_reminder", refId: r.body.id } })).toBe(1);
    await tailor.post(`/vr/pages/${pageId}/shows/${r.body.id}/cancel`).expect(201);
    expect((await request(app.getHttpServer()).get(`/vr/public/shows/${r.body.id}`).expect(200)).body.phase).toBe("CANCELLED");
    await shopper.post(`/vr/shows/${r.body.id}/rsvp`).send({ going: true }).expect(400);

    const exp = await shopper.get("/privacy/export").expect(200);
    const data = JSON.parse(exp.text);
    expect(data.fashionShowRsvps).toHaveLength(1);
    await shopper.post("/privacy/delete").send({ scope: "ACCOUNT" }).expect(201);
    const user = await prisma.user.findFirstOrThrow({ where: { phone: { contains: "deleted:" } }, orderBy: { deletedAt: "desc" } });
    expect(await prisma.fashionShowRsvp.count({ where: { userId: user.id } })).toBe(0);
  });

  it("builds runway models on the synthetic avatar when the AI gateway is up", async () => {
    const up = await fetch(`${process.env.AI_GATEWAY_URL ?? "http://localhost:8100"}/health`).then((r) => r.ok).catch(() => false);
    if (!up) return;
    const out = await vr.buildRunway(showId);
    expect(["READY", "PARTIAL"]).toContain(out.runwayStatus);
    const items = await prisma.fashionShowItem.findMany({ where: { showId } });
    for (const i of items.filter((x) => x.status === "READY")) expect(i.glbPath).toMatch(new RegExp(`^public/media/${pageId}/shows/${showId}/`));
    const metered = await prisma.usageEvent.count({ where: { pageId, kind: "TRYON_3D", refId: { in: items.map((i) => i.id) } } });
    expect(metered).toBe(items.filter((x) => x.status === "READY").length);
  });
});
