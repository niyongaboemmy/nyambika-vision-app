import type { PilotReportService } from "./report.service";

type Summary = Awaited<ReturnType<PilotReportService["summary"]>>;

const RAG_LABEL = { green: "🟢 Met", amber: "🟠 Near", red: "🔴 Missed", none: "⚪ No data" } as const;
const rwf = (n: number) => `RWF ${Math.round(n).toLocaleString("en-US")}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Gate 3 report (plan §8.3) as Markdown: KPIs vs targets, unit economics, experiments, recommendation. */
export function gate3Markdown(s: Summary, synthetic: boolean): string {
  const L: string[] = [];
  L.push(`# Gate 3 report: pilot evaluation`);
  L.push("");
  L.push(`Generated ${s.generatedAt} · cohort **${s.cohort.name}** · ${day(s.cohort.start)} → ${day(s.cohort.end)} (${s.cohort.days} days) · ${s.cohort.pages} member pages · ${s.cohort.shoppers} shoppers`);
  if (synthetic) L.push("", "> ⚠️ This report contains **synthetic pilot data** (seed-pilot, phones +25078999xxxx). It is for rehearsing the Gate 3 review, not for a decision.");
  L.push("", `## Recommendation: **${s.recommendation.decision}**`, "");
  for (const r of s.recommendation.reasons) L.push(`- ${r}`);
  L.push("", "Rules: *Pivot* when ≥ 2 demand KPIs are red and economics are off the break-even path · *Scale* when there are zero privacy incidents, all critical KPIs are green, no KPI is red, ≥ 75% are green and economics are on path · otherwise *Iterate* (one more 4-week cycle).");

  L.push("", "## KPIs against plan §21 (Phase 2 targets)", "", "| KPI | Target | Actual | n | Status |", "|---|---|---|---|---|");
  for (const k of s.kpis) L.push(`| ${k.label}${k.critical ? " *" : ""} | ${k.targetLabel} | ${k.display}${k.detail ? ` (${k.detail})` : ""} | ${k.n} | ${RAG_LABEL[k.rag]} |`);
  L.push("", "\\* critical for unit economics / trust.");

  const e = s.economics;
  const row = (label: string, a: number, b: number, f: (n: number) => string) => `| ${label} | ${f(a)} | ${f(b)} |`;
  L.push("", "## Unit economics (feasibility study §10, recomputed)", "", "| Input / output | Study assumption | Pilot recomputed |", "|---|---|---|");
  const pi = e.pilot.inputs;
  const si = e.plan.inputs;
  L.push(row("Cost per generation", si.costPerGenRwf, pi.costPerGenRwf, rwf));
  L.push(row("Pro page price", si.proPriceRwf, pi.proPriceRwf, rwf));
  L.push(row("Pro generations included", si.proGenerations, pi.proGenerations, String));
  L.push(row("Business page price", si.businessPriceRwf, pi.businessPriceRwf, rwf));
  L.push(row("Allowance use", si.allowanceUse, pi.allowanceUse, pct));
  L.push(row("Average order value", si.aovRwf, pi.aovRwf, rwf));
  L.push(row("Uncovered try-ons per order", si.uncoveredTriesPerOrder, pi.uncoveredTriesPerOrder, (n) => n.toFixed(1)));
  L.push(row("Paid pages (base case: Pro + Business)", si.proPages + si.businessPages, pi.proPages + pi.businessPages, String));
  L.push(row("**Pro page contribution / month**", e.plan.proContribution, e.pilot.proContribution, rwf));
  L.push(row("**Business page contribution / month**", e.plan.businessContribution, e.pilot.businessContribution, rwf));
  L.push(row("**Contribution per checkout order**", e.plan.orderContribution, e.pilot.orderContribution, rwf));
  L.push(row("Total contribution (month 18 base)", e.plan.totalContribution, e.pilot.totalContribution, rwf));
  L.push(row("**Monthly result (month 18 base)**", e.plan.monthlyResult, e.pilot.monthlyResult, rwf));
  L.push(
    "",
    `Break-even path: **${e.withinBreakEvenPath ? "within" : "off"}** (pilot base case ≥ study base − ${rwf(e.tolerance)} and positive contribution per order). Commission (6%) and MoMo fee (RWF 450) stay study assumptions: the pilot pays makers directly. Paid page counts scale with measured conversion ÷ 30% (×${e.scale}).`,
  );

  L.push("", "## Experiments (plan §8.1)", "");
  for (const x of s.experiments) {
    L.push(`### ${x.name} (\`${x.key}\`, ${x.status.toLowerCase()})`, "", `Primary metric: **${x.primaryMetric.replace("_", " ")}** · ${x.exposed} exposed`, "", "| Arm | n | Twin | Hold | Paid | Saved | Gens / user |", "|---|---|---|---|---|---|---|");
    for (const a of x.arms) {
      const r = (m: number) => (a.n ? pct(m / a.n) : "—");
      L.push(`| ${a.key}${a === x.arms[0] ? " (control)" : ""} | ${a.n} | ${r(a.metrics.twin_created)} | ${r(a.metrics.hold_started)} | ${r(a.metrics.order_paid)} | ${r(a.metrics.look_saved)} | ${a.generationsPerUser.toFixed(1)} |`);
    }
    for (const t of x.tests) {
      L.push(
        "",
        t.z === null
          ? `- ${t.arm} vs control: not enough data for a z-test.`
          : `- ${t.arm} vs control on ${t.metric.replace("_", " ")}: ${pct(t.pA)} → ${pct(t.pB)} (${t.diff >= 0 ? "+" : ""}${(t.diff * 100).toFixed(1)} pts), z = ${t.z.toFixed(2)}, p = ${t.p!.toFixed(3)} → **${t.significant ? "significant at 5%" : "not significant"}**.`,
      );
    }
    L.push("");
  }

  const h = s.hypercare.days;
  L.push("## Hypercare (last 14 days)", "", "| Day | AI cost | Generations | Withheld | Guard failure | Incidents |", "|---|---|---|---|---|---|");
  for (const d of h) L.push(`| ${d.day} | ${rwf(d.costRwf)} | ${d.generations} | ${d.withheld} | ${pct(d.guardRate)} | ${d.incidents} |`);

  L.push("", "## Funnel (distinct pseudonymous shoppers)", "", "| Step | Shoppers | Events |", "|---|---|---|");
  for (const f of s.funnel.steps) L.push(`| ${f.name} | ${f.actors} | ${f.events} |`);
  L.push("", "_Qualitative synthesis (member and shopper interviews, weeks 2 and 4) is added by the product team before the Gate 3 meeting._", "");
  return L.join("\n");
}
