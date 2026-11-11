import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Role } from "@prisma/client";
import { AiClient } from "../../common/ai.client";
import { Access, MANAGE } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { assertActivationAllowed } from "../inference/nlb-gate";
import { pseudonymise } from "../pilot/privacy";
import {
  assertCatalogueImage,
  consentState,
  coopEligibility,
  MAKER_TRAINING_PURPOSE,
  makerConsents,
  makerPurpose,
  needsTombstone,
  normaliseCategory,
  normaliseColour,
  pagePurpose,
  patternFromStyles,
  PATTERNS,
  productEligibility,
  productPurpose,
  TRAINING_PURPOSE,
  type LedgerRow,
} from "./training-consent";
import { bootstrapStability, computeTrends, priceBand, privacyAudit, regionOf, stableView, weekOf, weeksBack, type Signal, type SupplyRow } from "./trends";
import { gapText, labelOf, priceText, risingText, type Locale } from "./trends-copy";
import { syntheticSignals } from "./trends-seed";

const CONTRIBUTORS: Role[] = [...MANAGE, "COOP_MEMBER"];
export const ATTR_TIER = "ATTR_SUGGEST";
export const ATTR_EVAL = "ATTR_SPIKE";
export const TRENDS_MODEL = "trends-spike@1";
export const TRENDS_EVAL = "TRENDS_PRIVACY";
const DISPLAY: Record<string, string> = {
  dress: "Dress", umushanana: "Umushanana", shirt: "Shirt", skirt: "Skirt", trousers: "Trousers",
  imigongo: "Imigongo", kitenge: "Kitenge", wax: "Wax print", solid: "Plain",
  terracotta: "Terracotta", indigo: "Indigo", gold: "Gold", teal: "Teal", crimson: "Crimson", "forest-green": "Forest green", "royal-purple": "Royal purple", black: "Black",
};
const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

interface Manifest {
  version: number;
  hash: string;
  parent_hash: string | null;
  items: { item_id: string; source: string; page_id: string; product_id: string; image_ref: string; labels: Record<string, string | null> }[];
  dropped: { item_id: string; reason: string }[];
  stats: Record<string, unknown>;
  diff: { added: string[]; removed: string[]; removed_by_withdrawal: string[] };
  build_ms?: number;
}
export interface HeadReport {
  accuracy: number;
  macro_f1: number;
  ece: number;
  coverage_at_threshold: number;
  accuracy_when_shown: number | null;
  marginal: Record<string, { gap: number; worst: string; accuracy: Record<string, number> }>;
  cell_worst?: { cell: string; accuracy: number };
}
interface TrainReport {
  model_version: string;
  passed: boolean;
  licence: string;
  commercial_use: boolean;
  dataset: { version: number; hash: string; items: number };
  heads: Record<string, HeadReport>;
  failing: string[];
  drift: unknown;
  screen: unknown;
  cells: unknown[];
  [k: string]: unknown;
}
interface SuggestOut {
  model_version: string;
  served_by: string;
  threshold: number;
  heads: Record<string, { label: string; p: number }[]>;
}

/**
 * R4 spike (plan §11, not committed): consented training data, the local attribute model behind
 * `ml.local_attr_spike`, and k-anonymous trend insights behind `insights.trends_spike`.
 */
@Injectable()
export class MlSpikeService {
  private trendCache = new Map<string, { at: number; value: ReturnType<typeof stableView> }>();

  constructor(
    private prisma: PrismaService,
    private access: Access,
    private consent: ConsentService,
    private storage: StorageService,
    private ai: AiClient,
  ) {}

  async flag(key: string) {
    return (await this.prisma.featureFlag.findUnique({ where: { key } }))?.enabled === true;
  }

  // ── consent: maker opt-in per page / product ────────────────────────────────
  private async ledger(pageId: string): Promise<LedgerRow[]> {
    return this.prisma.consentRecord.findMany({
      where: { purpose: { startsWith: pagePurpose(pageId) } },
      select: { id: true, userId: true, purpose: true, granted: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Maker ledger rows of one page (TRAINING_DATA_MAKER:<page>:<coopMember>). */
  private makerLedger(pageId: string): Promise<LedgerRow[]> {
    return this.prisma.consentRecord.findMany({
      where: { purpose: { startsWith: `${MAKER_TRAINING_PURPOSE}:${pageId}:` } },
      select: { id: true, userId: true, purpose: true, granted: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Credited makers per product, on cooperative pages only (elsewhere the page owner is the maker). */
  private async credits(pageId: string): Promise<Map<string, string[]>> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { memberType: true } });
    const out = new Map<string, string[]>();
    if (page?.memberType !== "COOPERATIVE") return out;
    for (const pm of await this.prisma.productMaker.findMany({ where: { product: { pageId } }, select: { productId: true, coopMemberId: true } })) {
      out.set(pm.productId, [...(out.get(pm.productId) ?? []), pm.coopMemberId]);
    }
    return out;
  }

  private async eligibility(pageId: string) {
    const [state, makers, credits] = await Promise.all([this.ledger(pageId).then((r) => consentState(pageId, r)), this.makerLedger(pageId).then((r) => makerConsents(pageId, r)), this.credits(pageId)]);
    return { state, makers, credits, of: (productId: string) => coopEligibility(state, productId, credits.get(productId) ?? [], makers) };
  }

  async trainingState(userId: string, pageId: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const elig = await this.eligibility(pageId);
    const state = elig.state;
    const members = elig.credits.size ? await this.prisma.coopMember.findMany({ where: { pageId }, select: { id: true, name: true } }) : [];
    const memberName = new Map(members.map((m) => [m.id, m.name]));
    const products = await this.prisma.product.findMany({
      where: { pageId, status: { not: "ARCHIVED" } },
      include: { variants: { select: { imagePath: true } } },
      orderBy: { createdAt: "desc" },
    });
    const latest = await this.prisma.trainingDataset.findFirst({ orderBy: { version: "desc" } });
    const latestItems = latest ? (latest.manifest as unknown as Manifest).items.filter((i) => i.page_id === pageId && i.source === "catalogue") : [];
    const inLatest = latestItems.length;
    const inDataset = new Set(latestItems.map((i) => i.product_id));
    return {
      optedIn: state.page?.granted ?? false,
      decidedAt: state.page?.at ?? null,
      consentRecordId: state.page?.recordId ?? null,
      products: products.map((p) => {
        const e = elig.of(p.id);
        const makers = (elig.credits.get(p.id) ?? []).map((id) => ({ name: memberName.get(id) ?? "Maker", consented: elig.makers[id]?.granted ?? false }));
        return {
          makers,
          waitingForMaker: !e.eligible && (e.reason === "MAKER_NOT_CONSENTED" || e.reason === "MAKER_WITHDRAWN"),
          id: p.id,
          title: p.title,
          category: p.category,
          image: this.storage.publicUrl(p.variants.find((v) => v.imagePath)?.imagePath),
          photos: p.variants.filter((v) => v.imagePath).length,
          included: e.eligible,
          override: state.products[p.id] ? (state.products[p.id].granted ? "IN" : "OUT") : null,
          inDataset: inDataset.has(p.id),
        };
      }),
      tombstones: await this.prisma.trainingTombstone.count({ where: { pageId } }),
      latestDataset: latest ? { version: latest.version, at: latest.createdAt, itemsFromThisPage: inLatest } : null,
    };
  }

  async setPageConsent(userId: string, pageId: string, granted: boolean, locale: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const before = consentState(pageId, await this.ledger(pageId)).page;
    const rec = await this.consent.record(userId, pagePurpose(pageId), granted, locale);
    if (needsTombstone(before, granted)) {
      await this.prisma.trainingTombstone.create({ data: { pageId, consentRecordId: rec.id, userId, reason: "page withdrawn" } });
    }
    await this.access.audit(userId, "training_data.page_consent", { pageId, granted, consentRecordId: rec.id }, pageId);
    return this.trainingState(userId, pageId);
  }

  async setProductConsent(userId: string, pageId: string, productId: string, included: boolean, locale: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const product = await this.prisma.product.findFirst({ where: { id: productId, pageId } });
    if (!product) throw new NotFoundException("Product not found on this page");
    const wasIn = (await this.eligibility(pageId)).of(productId).eligible;
    const rec = await this.consent.record(userId, productPurpose(pageId, productId), included, locale);
    if (wasIn && !included) {
      await this.prisma.trainingTombstone.create({ data: { pageId, productId, consentRecordId: rec.id, userId, reason: "product withdrawn" } });
    }
    await this.access.audit(userId, "training_data.product_consent", { pageId, productId, included, consentRecordId: rec.id }, pageId);
    return this.trainingState(userId, pageId);
  }

  // ── consent: the credited coop maker's own say (cooperative pages) ─────────
  private async makerOf(userId: string, pageId: string) {
    const m = await this.prisma.coopMember.findFirst({ where: { pageId, userId, active: true }, select: { id: true, name: true } });
    if (!m) throw new ForbiddenException("Only a maker of this cooperative can decide this");
    return m;
  }

  async makerTrainingState(userId: string, pageId: string) {
    const me = await this.makerOf(userId, pageId);
    const elig = await this.eligibility(pageId);
    const mine = await this.prisma.product.findMany({
      where: { pageId, status: { not: "ARCHIVED" }, makers: { some: { coopMemberId: me.id } } },
      include: { variants: { select: { imagePath: true } } },
      orderBy: { createdAt: "desc" },
    });
    const own = elig.makers[me.id];
    return {
      maker: me.name,
      consented: own?.granted ?? false,
      decidedAt: own?.at ?? null,
      pieces: mine.map((p) => ({
        id: p.id,
        title: p.title,
        image: this.storage.publicUrl(p.variants.find((v) => v.imagePath)?.imagePath),
        coopShares: productEligibility(elig.state, p.id).eligible, // the admin's side of the decision
        included: elig.of(p.id).eligible,
      })),
    };
  }

  async setMakerConsent(userId: string, pageId: string, granted: boolean, locale: string) {
    const me = await this.makerOf(userId, pageId);
    const elig = await this.eligibility(pageId);
    const wasIn = [...elig.credits.entries()].filter(([, ms]) => ms.includes(me.id)).map(([productId]) => productId).filter((id) => elig.of(id).eligible);
    const before = elig.makers[me.id];
    const rec = await this.consent.record(userId, makerPurpose(pageId, me.id), granted, locale);
    if (needsTombstone(before, granted)) {
      // Every piece of theirs leaves the next dataset version (and its pixels every later one), whatever the admin chose.
      for (const productId of wasIn) await this.prisma.trainingTombstone.create({ data: { pageId, productId, consentRecordId: rec.id, userId, reason: "maker withdrawn" } });
    }
    await this.access.audit(userId, "training_data.maker_consent", { pageId, coopMemberId: me.id, granted, consentRecordId: rec.id, withdrawnPieces: granted ? 0 : wasIn.length }, pageId);
    return this.makerTrainingState(userId, pageId);
  }

  // ── dataset versions ────────────────────────────────────────────────────────
  private async trainingPages() {
    const rows = await this.prisma.consentRecord.findMany({
      where: { purpose: { startsWith: `${TRAINING_PURPOSE}:` } },
      select: { id: true, userId: true, purpose: true, granted: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const byPage = new Map<string, LedgerRow[]>();
    for (const r of rows) {
      const pageId = r.purpose.split(":")[1];
      byPage.set(pageId, [...(byPage.get(pageId) ?? []), r]);
    }
    return [...byPage.entries()].map(([pageId, rs]) => ({ pageId, state: consentState(pageId, rs) }));
  }

  async buildDataset(userId: string, perCell = 16) {
    await this.access.requireHost(userId);
    const pages = await this.trainingPages();
    const contributors = pages.filter((p) => p.state.page?.granted).map((p) => ({ page_id: p.pageId, consent_record_id: p.state.page!.recordId, consented_at: p.state.page!.at.toISOString() }));
    if (!contributors.length) throw new BadRequestException("No page has opted in to training-data contribution yet");
    const catalogue = [];
    const tombRows = await this.prisma.trainingTombstone.findMany({ orderBy: { createdAt: "desc" } });
    for (const { pageId } of pages) {
      const elig = await this.eligibility(pageId); // admin consent + (coop) every credited maker's own
      const products = await this.prisma.product.findMany({ where: { pageId, status: { in: ["PUBLISHED", "OUT_OF_STOCK"] } }, include: { variants: true } });
      for (const p of products) {
        let e = elig.of(p.id);
        if (!e.eligible) {
          // Withdrawn pieces still go to the builder as *withdrawal references*: it only hashes them to drop the
          // same pixels wherever else they appear (another product reusing the photo), then forgets them.
          const t = tombRows.find((x) => x.pageId === pageId && (!x.productId || x.productId === p.id));
          if (!t) continue;
          e = { eligible: true, consentRecordId: t.consentRecordId, consentedAt: t.createdAt, scope: t.productId ? "product" : "page" };
        }
        for (const v of p.variants) {
          if (!v.imagePath) continue;
          const ref = assertCatalogueImage(v.imagePath); // shopper data can never get here
          const image = await this.storage.read(ref).catch(() => null);
          if (!image) continue;
          catalogue.push({
            item_id: `cat-${v.id}`,
            page_id: pageId,
            product_id: p.id,
            variant_id: v.id,
            consent_record_id: e.consentRecordId,
            consented_at: e.consentedAt.toISOString(),
            image_ref: ref,
            image_b64: image.toString("base64"),
            labels: { category: normaliseCategory(p.category), colour: normaliseColour(v.colourName), pattern: patternFromStyles(p.styles), quality: null },
          });
        }
      }
    }
    const tombstones = tombRows.map((t) => ({ id: t.id, page_id: t.pageId, product_id: t.productId, at: t.createdAt.toISOString() }));
    const previous = await this.prisma.trainingDataset.findFirst({ orderBy: { version: "desc" } });
    const m = await this.ai.post<Manifest>("/v1/ml/dataset/build", { contributors, catalogue, tombstones, previous: previous?.manifest ?? null, per_cell: perCell }, 300_000);
    const row = await this.prisma.trainingDataset.create({
      data: { version: m.version, hash: m.hash, parentHash: m.parent_hash, items: m.items.length, manifest: m as unknown as Prisma.InputJsonValue, stats: m.stats as Prisma.InputJsonValue, createdBy: userId },
    });
    await this.access.audit(userId, "mlspike.dataset_built", { version: m.version, hash: m.hash, items: m.items.length, dropped: m.dropped.length, removedByWithdrawal: m.diff.removed_by_withdrawal.length });
    return { id: row.id, version: m.version, hash: m.hash, items: m.items.length, stats: m.stats, diff: { added: m.diff.added.length, removed: m.diff.removed.length, removedByWithdrawal: m.diff.removed_by_withdrawal.length }, dropped: m.dropped.length, buildMs: m.build_ms };
  }

  async trainEval(userId: string) {
    await this.access.requireHost(userId);
    const [cur, prev] = await this.prisma.trainingDataset.findMany({ orderBy: { version: "desc" }, take: 2 });
    if (!cur) throw new BadRequestException("Build a dataset version first");
    const manifest = cur.manifest as unknown as Manifest;
    const catalogue_images: Record<string, string> = {};
    for (const it of manifest.items) {
      if (it.source !== "catalogue") continue;
      const img = await this.storage.read(assertCatalogueImage(it.image_ref)).catch(() => null);
      if (img) catalogue_images[it.item_id] = img.toString("base64");
    }
    const r = await this.ai.post<TrainReport>("/v1/ml/attr/train-eval", { manifest, previous: prev?.manifest ?? null, catalogue_images }, 600_000);
    const f1s = Object.values(r.heads).map((h) => h.macro_f1);
    await this.prisma.modelVersion.upsert({
      where: { id: r.model_version },
      create: { id: r.model_version, provider: "local-attr-spike", name: "Garment attribute spike (linear probe on CPU features)", version: `d${cur.version}`, tier: ATTR_TIER, status: "INACTIVE", costRwf: 0, nlbScore: f1s.length ? Math.min(...f1s) : 0 },
      update: { nlbScore: f1s.length ? Math.min(...f1s) : 0 },
    });
    const { cells: _cells, ...summary } = r;
    const ev = await this.prisma.modelEval.create({
      data: {
        modelId: r.model_version,
        kind: ATTR_EVAL,
        modelVersion: r.model_version,
        passed: r.passed,
        licence: r.licence,
        commercialUse: r.commercial_use,
        summary: { ...summary, failing_subgroups: r.failing } as unknown as Prisma.InputJsonValue,
        report: r as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
    await this.access.audit(userId, "mlspike.attr_eval", { modelId: r.model_version, passed: r.passed, failing: r.failing, dataset: cur.version });
    return { evalId: ev.id, modelId: r.model_version, passed: r.passed, failing: r.failing, heads: r.heads, drift: r.drift, screen: r.screen, dataset: r.dataset };
  }

  /** Activate an attribute model through the registry gate (passing ATTR_SPIKE eval ≤ 92 days, commercial licence). */
  async activate(userId: string, modelId: string) {
    await this.access.requireHost(userId);
    if (!(await this.prisma.modelVersion.findUnique({ where: { id: modelId } }))) throw new NotFoundException("Unknown model");
    try {
      await assertActivationAllowed(this.prisma, modelId);
    } catch (e) {
      await this.access.audit(userId, "admin.model_activation_refused", { id: modelId, reason: (e as Error).message });
      throw e;
    }
    await this.prisma.modelVersion.updateMany({ where: { tier: ATTR_TIER, status: "ACTIVE", id: { not: modelId } }, data: { status: "INACTIVE" } });
    await this.prisma.modelVersion.update({ where: { id: modelId }, data: { status: "ACTIVE" } });
    await this.access.audit(userId, "admin.model_status", { id: modelId, status: "ACTIVE" });
    return { id: modelId, status: "ACTIVE" };
  }

  async overview(userId: string) {
    await this.access.requireHost(userId);
    const [datasets, models, evals, tombstones, signals, flags] = await Promise.all([
      this.prisma.trainingDataset.findMany({ orderBy: { version: "desc" }, take: 5, select: { version: true, hash: true, items: true, stats: true, createdAt: true } }),
      this.prisma.modelVersion.findMany({ where: { tier: { in: [ATTR_TIER, "TRENDS_INSIGHT"] } }, orderBy: { createdAt: "desc" } }),
      this.prisma.modelEval.findMany({ where: { kind: { in: [ATTR_EVAL, TRENDS_EVAL] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, modelId: true, kind: true, passed: true, summary: true, createdAt: true } }),
      this.prisma.trainingTombstone.count(),
      this.prisma.trendSignal.count(),
      this.prisma.featureFlag.findMany({ where: { key: { in: ["ml.local_attr_spike", "insights.trends_spike"] } } }),
    ]);
    return { datasets, models, evals, tombstones, signals, flags };
  }

  // ── ✨ auto-fill suggestion in the product editor ───────────────────────────
  async suggest(userId: string, productId: string) {
    if (!(await this.flag("ml.local_attr_spike"))) return { enabled: false as const };
    const p = await this.prisma.product.findUnique({ where: { id: productId }, include: { variants: { orderBy: { id: "asc" } } } });
    if (!p) throw new NotFoundException();
    await this.access.requirePage(userId, p.pageId, CONTRIBUTORS);
    const model = await this.prisma.modelVersion.findFirst({ where: { tier: ATTR_TIER, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    const lastEval = model ? await this.prisma.modelEval.findFirst({ where: { modelId: model.id, kind: ATTR_EVAL }, orderBy: { createdAt: "desc" } }) : null;
    const v = p.variants.find((x) => x.imagePath);
    if (!model || !v) return { enabled: true as const, model: model ? { id: model.id } : null, reason: !model ? "NO_ACTIVE_MODEL" : "NO_PHOTO", suggestions: [] };
    const region = (await this.prisma.pageRegion.findUnique({ where: { pageId: p.pageId } }))?.region?.toLowerCase() ?? "rw";
    const img = await this.storage.read(assertCatalogueImage(v.imagePath));
    const r = await this.ai.post<SuggestOut>("/v1/ml/attr/suggest", { image_b64: img.toString("base64"), model_version: model.id, region }, 15_000);
    // Per-head release: only heads that passed every check of the latest eval (incl. out-of-distribution) are offered.
    const passedHeads = new Set(((lastEval?.summary ?? {}) as { heads_passed?: string[] }).heads_passed ?? []);
    const top = (h: string) => (passedHeads.has(h) ? r.heads[h]?.[0] : undefined);
    const suggestions = [];
    const cat = top("category");
    if (cat && cat.p >= r.threshold)
      suggestions.push({ field: "category", value: cat.label, label: DISPLAY[cat.label] ?? cat.label, confidence: cat.p, current: p.category, matches: normaliseCategory(p.category) === cat.label, apply: { path: `/products/${p.id}`, body: { category: cat.label } } });
    const pat = top("pattern");
    if (pat && pat.p >= r.threshold) {
      const styles = [...p.styles.filter((s) => !(PATTERNS as readonly string[]).includes(s.toLowerCase())), pat.label];
      suggestions.push({ field: "pattern", value: pat.label, label: DISPLAY[pat.label] ?? pat.label, confidence: pat.p, current: patternFromStyles(p.styles), matches: patternFromStyles(p.styles) === pat.label, apply: { path: `/products/${p.id}`, body: { styles } } });
    }
    const col = top("colour");
    if (col && col.p >= r.threshold) {
      const name = DISPLAY[col.label] ?? col.label;
      // Only correct a colour name that maps to a *different* palette colour (a likely slip); local names (e.g. Kinyarwanda) are kept.
      const known = normaliseColour(v.colourName);
      suggestions.push({ field: "colour", value: col.label, label: name, confidence: col.p, current: v.colourName, matches: known === col.label, apply: known && known !== col.label ? { path: `/variants/${v.id}`, body: { colourName: name } } : null });
    }
    return {
      enabled: true as const,
      model: { id: model.id, evalPassed: lastEval?.passed ?? false, evaluatedAt: lastEval?.createdAt ?? null },
      servedBy: r.served_by,
      threshold: r.threshold,
      photo: this.storage.publicUrl(v.imagePath),
      blocked: ["category", "pattern", "colour"].filter((h) => !passedHeads.has(h)),
      suggestions,
    };
  }

  // ── trend insights ──────────────────────────────────────────────────────────
  private async signalsAndSupply(): Promise<{ signals: Signal[]; supply: SupplyRow[]; stamp: string }> {
    const since = new Date(`${weeksBack(new Date(), 8)[0]}T00:00:00Z`);
    const rows = await this.prisma.trendSignal.findMany({ where: { week: { gte: since } }, select: { week: true, region: true, source: true, category: true, colour: true, pattern: true, occasion: true, priceBand: true, pseudoId: true, pageId: true } });
    const signals: Signal[] = rows.map((r) => ({ ...r, week: r.week.toISOString().slice(0, 10), source: r.source as Signal["source"] }));
    const products = await this.prisma.product.findMany({ where: { status: "PUBLISHED" }, select: { pageId: true, category: true, occasions: true, styles: true, variants: { select: { colourName: true } } } });
    const supply = products
      .map((p) => ({ pageId: p.pageId, category: normaliseCategory(p.category) ?? p.category, occasions: p.occasions, patterns: [patternFromStyles(p.styles)].filter(Boolean) as string[], colours: p.variants.map((v) => normaliseColour(v.colourName)).filter(Boolean) as string[] }))
      .filter((s) => s.colours.length);
    return { signals, supply, stamp: `${rows.length}:${products.length}` };
  }

  async trends(userId: string, pageId: string, locale: Locale) {
    if (!(await this.flag("insights.trends_spike"))) return { enabled: false as const };
    await this.access.requirePage(userId, pageId, MANAGE);
    const { signals, supply, stamp } = await this.signalsAndSupply();
    const key = `${pageId}:${stamp}`;
    let view = this.trendCache.get(key);
    if (!view || Date.now() - view.at > 10 * 60_000) {
      view = { at: Date.now(), value: stableView(bootstrapStability(signals, supply, { viewerPageId: pageId, B: 20, seed: 11 })) };
      this.trendCache.set(key, view);
      if (this.trendCache.size > 200) this.trendCache.delete(this.trendCache.keys().next().value!);
    }
    const v = view.value;
    const rising = v.rising.map((r) => ({ ...r, label: labelOf(r.dimension, r.value, locale), text: risingText(r, locale), stability: v.stability[r.key] }));
    const gaps = v.gaps.map((g) => ({ ...g, text: gapText(g, locale), stability: v.stability[g.key] }));
    const hints = v.priceHints.map((h) => ({ ...h, text: priceText(h, locale), stability: v.stability[h.key] }));
    const lines = [...rising.slice(0, 3).map((r) => r.text), ...gaps.map((g) => g.text), ...hints.map((h) => h.text)];
    let writer = "rules";
    if (lines.length) {
      try {
        // Same optional Claude / pool LLM path as insights v2; facts are aggregates that already passed k-anonymity.
        const facts = { k: v.k, rising: rising.slice(0, 3).map((r) => ({ what: r.label, growth: r.growth, region: r.region })), gaps: gaps.map((g) => ({ colour: g.colour, category: g.category, occasion: g.occasion, asks: g.asks, makers: g.makers })), price: hints };
        const r = await this.ai.post<{ texts: string[]; writer: string }>("/v1/insights/phrase", { locale, facts, suggestions: lines }, 8000);
        if (r.writer.startsWith("llm") && r.texts.length === lines.length) {
          let i = 0;
          for (const x of rising.slice(0, 3)) x.text = r.texts[i++] || x.text;
          for (const x of gaps) x.text = r.texts[i++] || x.text;
          for (const x of hints) x.text = r.texts[i++] || x.text;
          writer = r.writer;
        }
      } catch {
        /* rules stand */
      }
    }
    return { enabled: true as const, k: v.k, weeks: v.weeks, rising, gaps, priceHints: hints, suppressed: v.suppressed, unstableHidden: v.unstableHidden, writer, synthetic: signals.length > 0 && (await this.prisma.trendSignal.count({ where: { synthetic: false } })) === 0 };
  }

  async seedTrends(userId: string) {
    await this.access.requireHost(userId);
    if (process.env.NODE_ENV === "production") throw new ForbiddenException("Synthetic trend signals exist only outside production");
    const makers = (await this.prisma.product.findMany({ where: { status: "PUBLISHED" }, select: { pageId: true }, distinct: ["pageId"] })).map((p) => p.pageId);
    const rows = syntheticSignals({ makers });
    await this.prisma.trendSignal.deleteMany({ where: { synthetic: true } });
    for (let i = 0; i < rows.length; i += 2000) {
      await this.prisma.trendSignal.createMany({ data: rows.slice(i, i + 2000).map((s) => ({ ...s, week: new Date(`${s.week}T00:00:00Z`), synthetic: true })) });
    }
    this.trendCache.clear();
    await this.access.audit(userId, "mlspike.trends_seeded", { rows: rows.length });
    return { rows: rows.length };
  }

  /** Real data → pseudonymised signals (Muse asks + paid orders). Idempotent over the window. */
  async ingestTrends(userId: string, days = 56) {
    await this.access.requireHost(userId);
    const since = new Date(Date.now() - days * 86_400_000);
    const out: Signal[] = [];
    const asks = await this.prisma.intentSession.findMany({ where: { createdAt: { gte: since }, userId: { not: null } }, select: { userId: true, intent: true, createdAt: true } });
    for (const a of asks) {
      const it = a.intent as { occasion?: string | null; colours?: string[]; categories?: string[]; styles?: string[]; budgetMax?: number | null; location?: string | null };
      const colours = (it.colours ?? []).map(normaliseColour).filter(Boolean).slice(0, 2) as string[];
      const cats = (it.categories ?? []).map(normaliseCategory).filter(Boolean).slice(0, 2) as string[];
      for (const colour of colours.length ? colours : [null]) {
        for (const category of cats.length ? cats : [null]) {
          out.push({ week: weekOf(a.createdAt), region: regionOf(it.location), source: "ASK", colour, category, pattern: patternFromStyles(it.styles ?? []), occasion: it.occasion?.toLowerCase() ?? null, priceBand: it.budgetMax ? priceBand(it.budgetMax) : null, pseudoId: pseudonymise(a.userId!), pageId: null });
        }
      }
    }
    const orders = await this.prisma.order.findMany({ where: { createdAt: { gte: since }, status: { in: [...PAID] } }, select: { shopperId: true, pageId: true, createdAt: true, page: { select: { district: true } }, items: { select: { productId: true, colourName: true, unitPriceRwf: true } } } });
    const cats = new Map((await this.prisma.product.findMany({ where: { id: { in: orders.flatMap((o) => o.items.map((i) => i.productId)) } }, select: { id: true, category: true, styles: true, occasions: true } })).map((p) => [p.id, p]));
    for (const o of orders) {
      for (const i of o.items) {
        const p = cats.get(i.productId);
        out.push({ week: weekOf(o.createdAt), region: regionOf(o.page.district), source: "ORDER", colour: normaliseColour(i.colourName), category: normaliseCategory(p?.category), pattern: patternFromStyles(p?.styles ?? []), occasion: p?.occasions[0] ?? null, priceBand: priceBand(i.unitPriceRwf), pseudoId: pseudonymise(o.shopperId), pageId: o.pageId });
      }
    }
    await this.prisma.trendSignal.deleteMany({ where: { synthetic: false, week: { gte: new Date(`${weekOf(since)}T00:00:00Z`) } } });
    if (out.length) await this.prisma.trendSignal.createMany({ data: out.map((s) => ({ ...s, week: new Date(`${s.week}T00:00:00Z`) })) });
    this.trendCache.clear();
    await this.access.audit(userId, "mlspike.trends_ingested", { asks: asks.length, orders: orders.length, rows: out.length });
    return { rows: out.length, asks: asks.length, orders: orders.length };
  }

  /** Privacy (no cell < k, maker rule for every viewer) + bootstrap stability → ModelEval. */
  async trendsEval(userId: string) {
    await this.access.requireHost(userId);
    const { signals, supply } = await this.signalsAndSupply();
    if (!signals.length) throw new BadRequestException("No trend signals yet (seed or ingest first)");
    const viewers = [null, ...new Set(signals.filter((s) => s.pageId).map((s) => s.pageId!))].slice(0, 13);
    const audits = viewers.map((viewer) => ({ viewer: viewer ? "maker" : "none", ...privacyAudit(computeTrends(signals, supply, { viewerPageId: viewer }), signals, viewer) }));
    const stab = bootstrapStability(signals, supply, { B: 50, seed: 3 });
    const smallestPublished = Math.min(...stab.full.rising.flatMap((r) => r.series.filter((x): x is number => x !== null)), ...stab.full.gaps.map((g) => g.asks), Infinity);
    const violations = audits.flatMap((a) => a.violations);
    const passed = violations.length === 0 && stab.risingTopJaccard >= 0.6;
    const summary = {
      k: stab.full.k,
      viewersAudited: audits.length,
      cellsChecked: audits.reduce((a, b) => a + b.checked, 0),
      violations: violations.slice(0, 20),
      suppressed: stab.full.suppressed,
      published: { rising: stab.full.rising.length, gaps: stab.full.gaps.length, priceCells: stab.full.priceBands.filter((c) => c.conversion !== null).length, priceHints: stab.full.priceHints.length },
      smallestPublishedRounded: Number.isFinite(smallestPublished) ? smallestPublished : null,
      bootstrap: { B: stab.B, risingTopJaccard: stab.risingTopJaccard, gapTopJaccard: stab.gapTopJaccard, priceHintJaccard: stab.priceHintJaccard, stableItems: Object.values(stab.itemStability).filter((x) => x >= 0.7).length, items: Object.keys(stab.itemStability).length },
      signals: signals.length,
      synthetic: (await this.prisma.trendSignal.count({ where: { synthetic: false } })) === 0,
      failing_subgroups: [...(violations.length ? ["privacy"] : []), ...(stab.risingTopJaccard < 0.6 ? ["stability"] : [])],
    };
    const ev = await this.prisma.modelEval.create({
      data: { modelId: TRENDS_MODEL, kind: TRENDS_EVAL, modelVersion: TRENDS_MODEL, passed, licence: "n/a (rules)", commercialUse: true, summary: summary as unknown as Prisma.InputJsonValue, report: { summary, itemStability: stab.itemStability, priceBands: stab.full.priceBands } as unknown as Prisma.InputJsonValue, createdBy: userId },
    });
    await this.access.audit(userId, "mlspike.trends_eval", { passed, violations: violations.length, jaccard: stab.risingTopJaccard });
    return { evalId: ev.id, passed, summary };
  }
}
