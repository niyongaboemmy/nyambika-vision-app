import { nps as npsScore, percentile } from "./stats";

/** KPI maths for the Phase 2 pilot (plan §21) and the Gate 3 decision (feasibility §10/§11). Pure: no I/O. */

export type Rag = "green" | "amber" | "red" | "none";
export type Direction = "min" | "max" | "zero";
export type Unit = "pct" | "num" | "sec" | "rwf";

export interface KpiRow {
  key: string;
  label: string;
  target: number;
  targetLabel: string;
  direction: Direction;
  unit: Unit;
  actual: number | null;
  display: string;
  rag: Rag;
  /** Sample size the actual is computed from. */
  n: number;
  critical: boolean;
  detail?: string;
}

/** Raw pilot counts gathered from the database for the pilot window and cohort. */
export interface PilotRaw {
  cohortPages: number;
  activePages: number;
  activeCoops: number;
  paidPages: number;
  selfManagingPages: number;
  newShoppers: number;
  shoppersWithTwin: number;
  shoppersWithTryOn: number;
  firstLookLatenciesMs: number[];
  lookViewers: number;
  lookViewersWhoHeldOrContacted: number;
  billedGenerations: number;
  generationCostRwf: number;
  deliveredGenerations: number;
  withheldGenerations: number;
  holdOrders: number;
  paidOrders: number;
  paidOrderValueRwf: number;
  surveyAnswered: number;
  surveyHelped: number;
  npsScores: number[];
  privacyIncidents: number;
  /** For unit economics. */
  pageAllowanceGenerations: number;
  shopperPaidGenerations: number;
  pilotDays: number;
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Green meets target; amber is within 20% of it; red is further away; none = no data. */
export function rag(actual: number | null, target: number, direction: Direction): Rag {
  if (actual === null || Number.isNaN(actual)) return "none";
  if (direction === "zero") return actual <= 0 ? "green" : "red";
  if (direction === "min") {
    if (actual >= target) return "green";
    return actual >= target * 0.8 ? "amber" : "red";
  }
  if (actual <= target) return "green";
  return actual <= target * 1.2 ? "amber" : "red";
}

function row(r: Omit<KpiRow, "rag" | "display"> & { display?: string }): KpiRow {
  const display =
    r.display ??
    (r.actual === null
      ? "—"
      : r.unit === "pct"
        ? pct(r.actual)
        : r.unit === "sec"
          ? `${r.actual.toFixed(1)} s`
          : r.unit === "rwf"
            ? `RWF ${Math.round(r.actual).toLocaleString("en-US")}`
            : Number.isInteger(r.actual)
              ? String(r.actual)
              : r.actual.toFixed(1));
  return { ...r, display, rag: rag(r.actual, r.target, r.direction) };
}

export function buildKpis(raw: PilotRaw): KpiRow[] {
  const p50 = percentile(raw.firstLookLatenciesMs, 0.5);
  const gensPerOrder = ratio(raw.billedGenerations, raw.paidOrders);
  const guardBase = raw.deliveredGenerations + raw.withheldGenerations;
  const npsValue = npsScore(raw.npsScores);
  const rows: KpiRow[] = [
    row({ key: "active_pages", label: "Active member pages", target: 20, targetLabel: "≥ 20 (≥ 3 coops)", direction: "min", unit: "num", actual: raw.activePages, n: raw.cohortPages, critical: false, detail: `${raw.activeCoops} cooperatives live` }),
    row({ key: "twin_rate", label: "Twin creation rate", target: 0.5, targetLabel: "≥ 50% of new shoppers", direction: "min", unit: "pct", actual: ratio(raw.shoppersWithTwin, raw.newShoppers), n: raw.newShoppers, critical: false }),
    row({ key: "first_look_p50", label: "Time to first look (p50)", target: 15, targetLabel: "p50 ≤ 15 s", direction: "max", unit: "sec", actual: p50 === null ? null : p50 / 1000, n: raw.firstLookLatenciesMs.length, critical: false }),
    row({ key: "look_hold_contact", label: "Look → hold / contact maker", target: 0.25, targetLabel: "≥ 25% of shoppers who saw a look", direction: "min", unit: "pct", actual: ratio(raw.lookViewersWhoHeldOrContacted, raw.lookViewers), n: raw.lookViewers, critical: false }),
    row({ key: "gens_per_order", label: "Generations per completed order", target: 15, targetLabel: "≤ 15", direction: "max", unit: "num", actual: gensPerOrder === null ? null : +gensPerOrder.toFixed(1), n: raw.paidOrders, critical: true }),
    row({ key: "hold_to_buy", label: "Purchase completion via hold-to-buy", target: 0.6, targetLabel: "≥ 60% of held orders paid", direction: "min", unit: "pct", actual: ratio(raw.paidOrders, raw.holdOrders), n: raw.holdOrders, critical: false }),
    row({ key: "paid_pages", label: "Paid page conversion", target: 0.3, targetLabel: "≥ 30% of pilot members", direction: "min", unit: "pct", actual: ratio(raw.paidPages, raw.cohortPages), n: raw.cohortPages, critical: false }),
    row({ key: "self_managing", label: "Members self-managing their page", target: 0.7, targetLabel: "≥ 70% by pilot week 4", direction: "min", unit: "pct", actual: ratio(raw.selfManagingPages, raw.cohortPages), n: raw.cohortPages, critical: false }),
    row({ key: "helped_decide", label: "“Helped me decide”", target: 0.7, targetLabel: "≥ 70%", direction: "min", unit: "pct", actual: ratio(raw.surveyHelped, raw.surveyAnswered), n: raw.surveyAnswered, critical: false, detail: npsValue === null ? "NPS —" : `NPS ${npsValue} (${raw.npsScores.length} answers)` }),
    row({ key: "guard_failure", label: "Guard identity / skin-tone failure", target: 0.02, targetLabel: "≤ 2%", direction: "max", unit: "pct", actual: ratio(raw.withheldGenerations, guardBase), n: guardBase, critical: true }),
    row({ key: "cost_per_generation", label: "Cost per generation", target: 120, targetLabel: "≤ RWF 120", direction: "max", unit: "rwf", actual: ratio(raw.generationCostRwf, raw.billedGenerations), n: raw.billedGenerations, critical: true }),
    row({ key: "privacy_incidents", label: "Privacy incidents", target: 0, targetLabel: "0", direction: "zero", unit: "num", actual: raw.privacyIncidents, n: raw.pilotDays, critical: true }),
    row({ key: "shoppers_tried", label: "Shoppers with ≥ 1 try-on", target: 500, targetLabel: "≥ 500 (Gate 3)", direction: "min", unit: "num", actual: raw.shoppersWithTryOn, n: raw.newShoppers, critical: false }),
  ];
  // Active pages also needs ≥ 3 cooperatives: cap at amber when the coop share is missing.
  const ap = rows[0];
  if (ap.rag === "green" && raw.activeCoops < 3) ap.rag = "amber";
  return rows;
}

// ---------------------------------------------------------------- unit economics (feasibility §10.3/§10.5)

export interface EconInputs {
  costPerGenRwf: number;
  proPriceRwf: number;
  proGenerations: number;
  businessPriceRwf: number;
  businessGenerations: number;
  allowanceUse: number;
  aovRwf: number;
  commission: number;
  momoFeeRwf: number;
  uncoveredTriesPerOrder: number;
  proPages: number;
  businessPages: number;
  ordersPerMonth: number;
  shopperCreditsRwf: number;
  enterpriseRwf: number;
  fixedCostRwf: number;
}

/** Feasibility study §10 assumptions, verbatim. */
export const STUDY_ASSUMPTIONS: EconInputs = {
  costPerGenRwf: 111,
  proPriceRwf: 25_000,
  proGenerations: 180,
  businessPriceRwf: 60_000,
  businessGenerations: 500,
  allowanceUse: 0.5,
  aovRwf: 30_000,
  commission: 0.06,
  momoFeeRwf: 450,
  uncoveredTriesPerOrder: 4,
  proPages: 200,
  businessPages: 30,
  ordersPerMonth: 2_500,
  shopperCreditsRwf: 600_000,
  enterpriseRwf: 1_500_000,
  fixedCostRwf: 10_450_000,
};

export const STUDY_BASE_MONTHLY_RESULT = -2_132_500;

export interface Econ {
  inputs: EconInputs;
  proContribution: number;
  businessContribution: number;
  orderContribution: number;
  totalContribution: number;
  monthlyResult: number;
}

export function unitEconomics(i: EconInputs): Econ {
  const proContribution = i.proPriceRwf - i.allowanceUse * i.proGenerations * i.costPerGenRwf;
  const businessContribution = i.businessPriceRwf - i.allowanceUse * i.businessGenerations * i.costPerGenRwf;
  const orderContribution = i.aovRwf * i.commission - i.momoFeeRwf - i.uncoveredTriesPerOrder * i.costPerGenRwf;
  const totalContribution =
    i.proPages * proContribution + i.businessPages * businessContribution + i.ordersPerMonth * orderContribution + i.shopperCreditsRwf + i.enterpriseRwf;
  return {
    inputs: i,
    proContribution: Math.round(proContribution),
    businessContribution: Math.round(businessContribution),
    orderContribution: Math.round(orderContribution),
    totalContribution: Math.round(totalContribution),
    monthlyResult: Math.round(totalContribution - i.fixedCostRwf),
  };
}

export interface PilotEconActuals {
  costPerGenRwf: number | null;
  proPriceRwf: number | null;
  proAllowance: number | null;
  businessPriceRwf: number | null;
  businessAllowance: number | null;
  /** Page-allowance generations per paid page per 30 days ÷ the plan allowance. */
  allowanceUse: number | null;
  aovRwf: number | null;
  uncoveredTriesPerOrder: number | null;
  paidPageConversion: number | null;
}

/**
 * Recompute the base case with pilot actuals where measured and study assumptions elsewhere.
 * Paid page counts scale with measured conversion vs the 30% assumption (capped at ×1.5).
 */
export function recomputeEconomics(a: PilotEconActuals) {
  const s = STUDY_ASSUMPTIONS;
  const scale = a.paidPageConversion === null ? 1 : Math.min(1.5, a.paidPageConversion / 0.3);
  const inputs: EconInputs = {
    ...s,
    costPerGenRwf: a.costPerGenRwf ?? s.costPerGenRwf,
    proPriceRwf: a.proPriceRwf ?? s.proPriceRwf,
    proGenerations: a.proAllowance ?? s.proGenerations,
    businessPriceRwf: a.businessPriceRwf ?? s.businessPriceRwf,
    businessGenerations: a.businessAllowance ?? s.businessGenerations,
    allowanceUse: a.allowanceUse ?? s.allowanceUse,
    aovRwf: a.aovRwf ?? s.aovRwf,
    uncoveredTriesPerOrder: a.uncoveredTriesPerOrder ?? s.uncoveredTriesPerOrder,
    proPages: Math.round(s.proPages * scale),
    businessPages: Math.round(s.businessPages * scale),
  };
  const plan = unitEconomics(s);
  const pilot = unitEconomics(inputs);
  // Within the break-even path: base case no more than 10% of fixed cost worse than the study, and orders pay for themselves.
  const tolerance = s.fixedCostRwf * 0.1;
  const withinBreakEvenPath = pilot.monthlyResult >= STUDY_BASE_MONTHLY_RESULT - tolerance && pilot.orderContribution > 0;
  return { plan, pilot, scale: +scale.toFixed(2), withinBreakEvenPath, tolerance };
}

// ---------------------------------------------------------------- Gate 3 recommendation (plan §8.3)

export type Decision = "Scale" | "Iterate" | "Pivot";

const DEMAND = ["twin_rate", "look_hold_contact", "helped_decide", "paid_pages"];

/**
 * Rule-based Gate 3 call:
 * - Pivot (Option C member tools): ≥ 2 demand KPIs red and the economics are off the break-even path.
 * - Scale: zero privacy incidents, every critical KPI green, no red KPI, ≥ 75% of measured KPIs green, economics on path.
 * - Iterate: everything else (one more 4-week cycle).
 */
export function recommend(kpis: KpiRow[], withinBreakEvenPath: boolean): { decision: Decision; reasons: string[] } {
  const by = new Map(kpis.map((k) => [k.key, k]));
  const measured = kpis.filter((k) => k.rag !== "none");
  const green = measured.filter((k) => k.rag === "green");
  const red = measured.filter((k) => k.rag === "red");
  const demandRed = DEMAND.filter((k) => by.get(k)?.rag === "red");
  const criticalNotGreen = kpis.filter((k) => k.critical && k.rag !== "green");
  const privacy = by.get("privacy_incidents");
  const reasons: string[] = [];

  if (demandRed.length >= 2 && !withinBreakEvenPath) {
    reasons.push(`${demandRed.length} demand KPIs are red (${demandRed.map((k) => by.get(k)!.label).join(", ")}).`);
    reasons.push("Unit economics are off the break-even path.");
    return { decision: "Pivot", reasons };
  }
  const share = measured.length ? green.length / measured.length : 0;
  if (privacy && privacy.rag !== "green") reasons.push("Privacy incidents occurred: Gate 3 requires zero.");
  for (const k of criticalNotGreen) if (k.key !== "privacy_incidents") reasons.push(`Critical KPI not met: ${k.label} (${k.display} vs ${k.targetLabel}).`);
  for (const k of red) if (!k.critical) reasons.push(`Red: ${k.label} (${k.display} vs ${k.targetLabel}).`);
  if (share < 0.75) reasons.push(`Only ${green.length} of ${measured.length} measured KPIs are green (need ≥ 75%).`);
  if (!withinBreakEvenPath) reasons.push("Unit economics are off the break-even path.");
  if (reasons.length === 0) {
    return { decision: "Scale", reasons: [`${green.length} of ${measured.length} KPIs green, all critical KPIs met, economics on the break-even path.`] };
  }
  return { decision: "Iterate", reasons };
}
