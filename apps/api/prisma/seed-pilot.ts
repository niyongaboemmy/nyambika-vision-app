/**
 * Synthetic Phase 2 pilot (plan §8, §21): ~26 pilot days of SYNTHETIC shoppers (phones +25078999xxxx, names
 * "Synthetic shopper NNNN"), persona twins, looks, generations, orders, analytics events and survey answers at
 * plausible rates, so the /admin/pilot dashboard and the Gate 3 export can be rehearsed. Never real people.
 *
 *   pnpm --filter @nyambika/api db:seed:pilot        (PILOT_SHOPPERS=520 PILOT_DAYS=26 PILOT_SEED=7 by default)
 *
 * Idempotent: every run first removes the previous synthetic pilot (users in the +25078999 range and rows
 * flagged synthetic). Refuses to run when NODE_ENV=production.
 */
import { Prisma, PrismaClient, type OrderStatus } from "@prisma/client";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import "dotenv/config";
import { assign, type Variant } from "../src/modules/pilot/assign";
import { pseudonymise } from "../src/modules/pilot/privacy";

if (process.env.NODE_ENV === "production") throw new Error("seed-pilot is synthetic data: never run it in production");

const prisma = new PrismaClient();
const SHOPPERS = Number(process.env.PILOT_SHOPPERS ?? 520);
const DAYS = Number(process.env.PILOT_DAYS ?? 26);
const PHONE_PREFIX = "+25078999";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const TWIN_KEY = Buffer.from(process.env.TWIN_KEY ?? "0".repeat(63) + "1", "hex");
const DAY = 86_400_000;
const NOTICE_VERSION = "2026-11-v1";
const PAID_STATES: OrderStatus[] = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "DELIVERED", "COMPLETED", "COMPLETED"];

// Deterministic PRNG (mulberry32) so a given PILOT_SEED always yields the same pilot.
let state = Number(process.env.PILOT_SEED ?? 7) >>> 0;
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => rnd() < p;
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
/** Log-normal latency around a median (ms). */
const lognormal = (median: number, sigma: number) => {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
};
const geometric = (mean: number, max: number) => {
  let n = 1;
  while (n < max && chance(1 - 1 / mean)) n++;
  return n;
};
const id = () => `syn${randomUUID().replace(/-/g, "").slice(0, 22)}`;

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.event.deleteMany({ where: { synthetic: true } });
  await prisma.experimentExposure.deleteMany({ where: { OR: [{ synthetic: true }, { userId: { in: ids } }] } });
  await prisma.surveyResponse.deleteMany({ where: { OR: [{ synthetic: true }, { userId: { in: ids } }] } });
  await prisma.pilotMember.deleteMany({ where: { synthetic: true } });
  await prisma.pilotIncident.deleteMany({ where: { summary: { startsWith: "[synthetic]" } } });
  await prisma.order.deleteMany({ where: { shopperId: { in: ids } } });
  await prisma.usageEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

/** One encrypted copy per synthetic persona, shared by synthetic twins (saves disk; nobody real is involved). */
function personaTwinFiles() {
  const out: { encPath: string; iv: string; authTag: string }[] = [];
  for (let n = 1; n <= 5; n++) {
    const encPath = `private/twins/synthetic-pilot/persona-${n}.enc`;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", TWIN_KEY, iv);
    const enc = Buffer.concat([cipher.update(readFileSync(join(STORAGE, "personas", `persona-${n}.png`))), cipher.final()]);
    const full = join(STORAGE, encPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, enc);
    out.push({ encPath, iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") });
  }
  return out;
}

async function main() {
  const removed = await cleanup();
  const now = Date.now();
  const start = new Date(now - DAYS * DAY);
  start.setUTCHours(22, 0, 0, 0); // 00:00 Kigali
  const cohort = await prisma.pilotCohort.upsert({
    where: { key: "pilot-kigali-2027" },
    update: { startsAt: start, endsAt: new Date(now + DAY) },
    create: { id: "pilot-kigali-2027", key: "pilot-kigali-2027", name: "Kigali pilot (Gate 2 → Gate 3)", startsAt: start, endsAt: new Date(now + DAY) },
  });

  // Seeded (fictional) member pages join the cohort; membership rows are flagged synthetic.
  const pages = await prisma.page.findMany({ where: { status: { not: "CLOSED" } }, include: { subscription: true } });
  await prisma.pilotMember.createMany({
    data: pages.map((p) => ({ cohortId: cohort.id, kind: "PAGE", subjectId: p.id, source: "SEED", synthetic: true, joinedAt: start })),
    skipDuplicates: true,
  });

  const exps = await prisma.experiment.findMany();
  for (const e of exps) await prisma.experiment.update({ where: { key: e.key }, data: { status: "RUNNING", startsAt: start, endsAt: null } });
  const arms = (key: string) => (exps.find((e) => e.key === key)?.variants ?? []) as unknown as Variant[];

  const variants = await prisma.variant.findMany({
    where: { cutoutPath: { not: null }, product: { status: "PUBLISHED", page: { status: "PUBLISHED" } } },
    include: { product: { include: { page: { include: { subscription: true } } } } },
  });
  if (!variants.length) throw new Error("No try-on-ready variants: run the main seed first");
  const models = await prisma.modelVersion.findMany({ where: { status: "ACTIVE" } });
  const preview = models.find((m) => m.tier === "PREVIEW") ?? { id: "local-compositor@1.0-preview", costRwf: 40 };
  const twinFiles = personaTwinFiles();

  const users: Prisma.UserCreateManyInput[] = [];
  const members: Prisma.PilotMemberCreateManyInput[] = [];
  const exposures: Prisma.ExperimentExposureCreateManyInput[] = [];
  const consents: Prisma.ConsentRecordCreateManyInput[] = [];
  const twins: Prisma.TwinCreateManyInput[] = [];
  const sessions: Prisma.IntentSessionCreateManyInput[] = [];
  const gens: Prisma.GenerationCreateManyInput[] = [];
  const looks: Prisma.LookCreateManyInput[] = [];
  const usage: Prisma.UsageEventCreateManyInput[] = [];
  const orders: Prisma.OrderCreateManyInput[] = [];
  const items: Prisma.OrderItemCreateManyInput[] = [];
  const orderEvents: Prisma.OrderEventCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const surveys: Prisma.SurveyResponseCreateManyInput[] = [];
  const ev = (name: string, pseudoId: string, at: number, props: Record<string, string | number | boolean> = {}, authed = true) =>
    events.push({ name, pseudoId, authed, props, synthetic: true, occurredAt: new Date(Math.min(at, now - 60_000)) });

  const consent = (userId: string, purpose: string, at: Date, prev: string) => {
    const hash = createHash("sha256").update([prev, userId, purpose, true, NOTICE_VERSION, "rw", at.toISOString()].join("|")).digest("hex");
    consents.push({ userId, purpose, granted: true, noticeVersion: NOTICE_VERSION, locale: "rw", prevHash: prev, hash, createdAt: at });
    return hash;
  };

  for (let i = 0; i < SHOPPERS; i++) {
    const userId = id();
    const pseudo = pseudonymise(userId);
    // Recruitment front-loaded: launch event in week 1, creators in weeks 2–3.
    const joinDay = Math.min(DAYS - 1, Math.floor(Math.pow(rnd(), 1.6) * DAYS));
    const joined = start.getTime() + joinDay * DAY + between(7, 21) * 3_600_000;
    const locale = chance(0.5) ? "rw" : chance(0.8) ? "en" : "fr";
    users.push({ id: userId, phone: `${PHONE_PREFIX}${String(i).padStart(4, "0")}`, name: `Synthetic shopper ${String(i).padStart(4, "0")}`, locale, createdAt: new Date(joined) });
    members.push({ cohortId: cohort.id, kind: "SHOPPER", subjectId: userId, source: "SEED", inviteCode: "SYNTHETIC", synthetic: true, joinedAt: new Date(joined) });

    const nudge = assign(userId, "twin.nudge", arms("twin.nudge"));
    const initialArm = assign(userId, "looks.initial_count", arms("looks.initial_count"));
    const voiceArm = assign(userId, "muse.voice", arms("muse.voice"));
    const initial = Number(initialArm) || 3;
    exposures.push(
      { experimentKey: "twin.nudge", userId, variant: nudge, synthetic: true, createdAt: new Date(joined) },
      { experimentKey: "muse.voice", userId, variant: voiceArm, synthetic: true, createdAt: new Date(joined) },
    );
    ev("twin_nudge_shown", pseudo, joined + 20_000, { place: nudge === "twin_first" ? "home" : "stream", arm: nudge });

    // Twin: the strong pre-look prompt converts more (control 58%) than the soft in-stream prompt (44%).
    const makeTwin = chance(nudge === "twin_first" ? 0.58 : 0.44);
    const twinAt = makeTwin ? joined + (nudge === "twin_first" ? between(1, 6) * 60_000 : between(0.3, 30) * 3_600_000) : null;
    if (twinAt && twinAt < now) {
      const persona = 1 + Math.floor(rnd() * 5);
      const f = twinFiles[persona - 1];
      const c1 = consent(userId, "TWIN_PROCESSING", new Date(twinAt), "GENESIS");
      consent(userId, "TRYON_GENERATION", new Date(twinAt + 1), c1);
      twins.push({ id: id(), userId, version: 1, ...f, mime: "image/png", size: pick(["S", "M", "M", "L", "XL"]), checks: { synthetic: { pass: true, note: `persona-${persona}` } }, consentId: "synthetic", createdAt: new Date(twinAt) });
      ev("twin_nudge_clicked", pseudo, twinAt - 30_000, { arm: nudge });
      ev("twin_created", pseudo, twinAt, { count: 1 });
    }

    const nSessions = geometric(1.8, 6);
    let viewedTotal = 0;
    let paidAny = false;
    let firstAsk = true;
    for (let s = 0; s < nSessions; s++) {
      const at = joined + (s === 0 ? between(2, 40) * 60_000 : between(0.5, DAYS - joinDay) * DAY);
      if (at >= now - 3_600_000) continue;
      if (firstAsk) {
        exposures.push({ experimentKey: "looks.initial_count", userId, variant: initialArm, synthetic: true, createdAt: new Date(at) });
        firstAsk = false;
      }
      const source = voiceArm === "voice" && chance(0.7) ? "voice" : "text";
      const onTwin = Boolean(twinAt && twinAt < at);
      ev("muse_ask", pseudo, at, { source, locale });
      ev("intent_parsed", pseudo, at + 900, { source, parser: chance(0.8) ? "llm" : "rules", hasOccasion: chance(0.85) });
      const sessionId = id();
      sessions.push({ id: sessionId, userId, input: "[synthetic pilot ask]", source, intent: { synthetic: true, source }, createdAt: new Date(at) });
      const viewed = geometric(3.0, 9);
      viewedTotal += viewed;
      const rendered = Math.min(9, Math.max(initial, viewed + 1));
      let cursor = at + 1500;
      const picked = Array.from({ length: 9 }, () => pick(variants));
      let lastLook: { lookId: string; v: (typeof variants)[number] } | null = null;
      for (let r = 0; r < 9; r++) {
        const v = picked[r];
        const lookId = id();
        let generationId: string | null = null;
        if (r < rendered) {
          generationId = id();
          const latency = r === 0 ? Math.max(4_000, lognormal(onTwin ? 11_500 : 10_000, 0.35)) : Math.max(3_000, lognormal(8_000, 0.4));
          const withheld = chance(onTwin ? 0.017 : 0.012);
          const created = new Date(cursor);
          gens.push({
            id: generationId,
            userId,
            variantId: v.id,
            twinVersion: onTwin ? 1 : 0,
            modelVersion: preview.id,
            tier: "PREVIEW",
            cacheKey: `synthetic:${generationId}`,
            status: withheld ? "WITHHELD" : "DELIVERED",
            guard: { synthetic: true, passed: !withheld },
            costRwf: withheld ? 0 : preview.costRwf,
            latencyMs: Math.round(latency * 0.8),
            createdAt: created,
            deliveredAt: withheld ? null : new Date(cursor + latency),
          });
          if (!withheld) {
            const allowance = v.product.page.allowanceOn && v.product.page.subscription && chance(0.18);
            usage.push({ kind: "TRYON", source: allowance ? "PAGE_ALLOWANCE" : chance(0.97) ? "FREE_QUOTA" : "CREDITS", costRwf: preview.costRwf, userId, pageId: allowance ? v.product.pageId : null, refId: generationId, createdAt: new Date(cursor + latency) });
          }
          cursor += 2_000;
        }
        const seen = r < viewed;
        const saved = seen && chance(0.14);
        looks.push({ id: lookId, userId, intentSessionId: sessionId, productId: v.productId, variantId: v.id, rank: r, score: 1 - r / 10, generationId, savedAt: saved ? new Date(at + (r + 1) * 9_000) : null, createdAt: new Date(at) });
        if (seen) {
          ev("look_viewed", pseudo, at + (r + 1) * 8_000, { lookId, index: r, onTwin });
          if (saved) ev("look_saved", pseudo, at + (r + 1) * 9_000, { lookId });
          lastLook = { lookId, v };
        }
      }
      if (!lastLook) continue;
      const t = at + viewed * 8_000 + 20_000;
      if (chance(0.38)) ev("maker_space_viewed", pseudo, t, { pageId: lastLook.v.product.pageId });
      if (chance(0.07)) ev("maker_contacted", pseudo, t + 30_000, { pageId: lastLook.v.product.pageId, channel: "whatsapp" });
      if (chance(0.05)) ev("circle_poll_created", pseudo, t + 40_000, { count: 2 });
      // Twin shoppers decide more often (fit confidence); voice adds a little engagement.
      const pSheet = (onTwin ? 0.5 : 0.38) + (source === "voice" ? 0.03 : 0);
      if (!chance(pSheet)) continue;
      ev("buy_sheet_opened", pseudo, t + 50_000, { lookId: lastLook.lookId });
      if (!chance(0.66)) continue;
      const orderAt = t + 80_000;
      ev("hold_started", pseudo, orderAt, { lookId: lastLook.lookId });
      const p = lastLook.v.product;
      const paid = chance(0.76) && orderAt < now - 600_000;
      const status: OrderStatus = paid ? pick(PAID_STATES) : orderAt > now - DAY ? "AWAITING_PAYMENT" : "CANCELLED";
      const orderId = id();
      const delivery = chance(0.7);
      const total = p.priceRwf + (delivery ? 2000 : 0);
      orders.push({
        id: orderId,
        code: `SY-${randomBytes(4).toString("hex").toUpperCase()}`,
        pageId: p.pageId,
        shopperId: userId,
        status,
        totalRwf: total,
        deliveryMode: delivery ? "DELIVERY" : "PICKUP",
        deliveryFeeRwf: delivery ? 2000 : 0,
        address: delivery ? "Synthetic address, Kigali" : "",
        wallet: chance(0.8) ? "MTN_MOMO" : "AIRTEL_MONEY",
        payerPhone: users[users.length - 1].phone,
        payoutMsisdn: p.page.momoMerchant || "0780000000",
        payoutLabel: p.page.name,
        idempotencyKey: `synthetic-${orderId}`,
        lookId: lastLook.lookId,
        createdAt: new Date(orderAt),
      });
      items.push({ orderId, productId: p.id, variantId: lastLook.v.id, title: p.title, colourName: lastLook.v.colourName, size: lastLook.v.sizes[0] ?? "M", unitPriceRwf: p.priceRwf });
      orderEvents.push({ orderId, status: "NEW", note: "Synthetic pilot order (seed-pilot)", createdAt: new Date(orderAt) });
      if (paid) {
        paidAny = true;
        orderEvents.push({ orderId, status: "PAID", note: "Synthetic: paid directly to the maker", createdAt: new Date(orderAt + 90_000) });
        ev("order_paid", pseudo, orderAt + 90_000, { orderId, pageId: p.pageId });
      }
    }

    // Micro-survey: once after a paid order, once after 5 looks viewed.
    if (paidAny) {
      const answered = chance(0.68);
      surveys.push({ userId, trigger: "ORDER_PAID", synthetic: true, dismissed: !answered, helped: answered ? chance(0.8) : null, nps: answered ? Math.min(10, Math.max(0, Math.round(between(5.5, 11)))) : null, createdAt: new Date(Math.min(now - 60_000, joined + 2 * DAY)) });
    }
    if (viewedTotal >= 5) {
      const answered = chance(0.55);
      surveys.push({ userId, trigger: "LOOKS_5", synthetic: true, dismissed: !answered, helped: answered ? chance(0.68) : null, nps: answered && chance(0.6) ? Math.min(10, Math.max(0, Math.round(between(4, 11)))) : null, createdAt: new Date(Math.min(now - 60_000, joined + DAY)) });
    }
  }

  // Signed-out Muse traffic (anonymous device ids) at the top of the funnel.
  for (let a = 0; a < Math.round(SHOPPERS * 0.6); a++) {
    const pseudo = pseudonymise(`anon:synthetic-${a}-${randomUUID()}`);
    const at = start.getTime() + rnd() * (now - start.getTime());
    ev("muse_ask", pseudo, at, { source: "text" }, false);
    if (chance(0.92)) ev("intent_parsed", pseudo, at + 900, { source: "text" }, false);
  }

  await chunked(users, 500, (d) => prisma.user.createMany({ data: d }));
  await chunked(members, 1000, (d) => prisma.pilotMember.createMany({ data: d, skipDuplicates: true }));
  await chunked(exposures, 1000, (d) => prisma.experimentExposure.createMany({ data: d, skipDuplicates: true }));
  await chunked(consents, 1000, (d) => prisma.consentRecord.createMany({ data: d }));
  await chunked(twins, 1000, (d) => prisma.twin.createMany({ data: d }));
  await chunked(sessions, 1000, (d) => prisma.intentSession.createMany({ data: d }));
  await chunked(gens, 1000, (d) => prisma.generation.createMany({ data: d }));
  await chunked(looks, 1000, (d) => prisma.look.createMany({ data: d }));
  await chunked(usage, 1000, (d) => prisma.usageEvent.createMany({ data: d }));
  await chunked(orders, 500, (d) => prisma.order.createMany({ data: d }));
  await chunked(items, 1000, (d) => prisma.orderItem.createMany({ data: d }));
  await chunked(orderEvents, 1000, (d) => prisma.orderEvent.createMany({ data: d }));
  await chunked(events, 2000, (d) => prisma.event.createMany({ data: d }));
  await chunked(surveys, 1000, (d) => prisma.surveyResponse.createMany({ data: d, skipDuplicates: true }));
  await prisma.pilotIncident.create({
    data: { kind: "P1", summary: "[synthetic] Day 3: generation queue backlog (p95 41 s) for 25 min; mitigated by scaling workers.", createdAt: new Date(start.getTime() + 2.5 * DAY), resolvedAt: new Date(start.getTime() + 2.52 * DAY) },
  });

  const paid = orders.filter((o) => (PAID_STATES as string[]).includes(o.status as string)).length;
  console.log(
    `Synthetic pilot: removed ${removed} old synthetic shoppers; created ${users.length} shoppers, ${twins.length} twins, ${sessions.length} asks, ` +
      `${gens.length} generations, ${orders.length} holds (${paid} paid), ${events.length} events, ${surveys.length} survey rows over ${DAYS} days.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
