/**
 * Try-on as a Service metering (E37, FR-AGT-06). Pure: the service passes counts read from the database.
 * A contract's monthly fee covers `monthlyQuota` delivered looks; beyond that each delivered look costs
 * `overagePriceRwf`, or is refused when the contract has a hard cap. Withheld/failed jobs are never billed.
 */
export interface ContractTerms {
  status: string;
  monthlyQuota: number;
  monthlyFeeRwf: number;
  overagePriceRwf: number;
  hardCap: boolean;
  sandboxDailyCap: number;
  startsAt: Date;
  endsAt: Date | null;
}

export type Admission =
  | { allowed: true; sandbox: boolean; overage: boolean; priceRwf: number }
  | { allowed: false; code: "NO_CONTRACT" | "CONTRACT_INACTIVE" | "QUOTA_EXCEEDED" | "SANDBOX_DAILY_CAP"; message: string };

/** Decide whether a new job may start, and how it would be billed if delivered. */
export function admit(c: ContractTerms | null, sandbox: boolean, usedThisMonth: number, sandboxToday: number, now = new Date()): Admission {
  if (!c) return { allowed: false, code: "NO_CONTRACT", message: "No try-on contract for this partner yet." };
  if (sandbox) {
    // Sandbox works on DRAFT contracts too, so partners can integrate before signing.
    if (c.status === "SUSPENDED" || c.status === "ENDED") return { allowed: false, code: "CONTRACT_INACTIVE", message: `Contract is ${c.status.toLowerCase()}.` };
    if (sandboxToday >= c.sandboxDailyCap) return { allowed: false, code: "SANDBOX_DAILY_CAP", message: `Sandbox limit of ${c.sandboxDailyCap} calls a day reached.` };
    return { allowed: true, sandbox: true, overage: false, priceRwf: 0 };
  }
  const live = c.status === "ACTIVE" && c.startsAt <= now && (!c.endsAt || c.endsAt > now);
  if (!live) return { allowed: false, code: "CONTRACT_INACTIVE", message: "Contract is not active. Use a sandbox key or ask Nyambika to activate it." };
  if (usedThisMonth < c.monthlyQuota) return { allowed: true, sandbox: false, overage: false, priceRwf: 0 };
  if (c.hardCap) return { allowed: false, code: "QUOTA_EXCEEDED", message: `Monthly quota of ${c.monthlyQuota} looks reached.` };
  return { allowed: true, sandbox: false, overage: true, priceRwf: c.overagePriceRwf };
}

export interface StatementLine {
  id: string;
  createdAt: Date;
  clientReference: string | null;
  modelId: string;
  status: string;
  billable: boolean;
  overage: boolean;
  priceRwf: number;
  sandbox: boolean;
}

/** Monthly usage statement: one row per job + summary rows (fee, included, overage, total). */
export function statementCsv(partner: string, month: string, c: ContractTerms | null, lines: StatementLine[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const billed = lines.filter((l) => l.billable && !l.sandbox);
  const included = billed.filter((l) => !l.overage).length;
  const overage = billed.filter((l) => l.overage);
  const overageRwf = overage.reduce((s, l) => s + l.priceRwf, 0);
  const fee = c?.monthlyFeeRwf ?? 0;
  const rows = [
    ["job_id", "created_at", "client_reference", "model_id", "status", "environment", "billable", "band", "price_rwf"].join(","),
    ...lines.map((l) =>
      [l.id, l.createdAt.toISOString(), l.clientReference, l.modelId, l.status, l.sandbox ? "sandbox" : "live", l.billable ? "yes" : "no", l.billable ? (l.overage ? "overage" : "included") : "", l.billable ? l.priceRwf : 0]
        .map(esc)
        .join(","),
    ),
    "",
    ["summary", "value"].join(","),
    [esc("partner"), esc(partner)].join(","),
    [esc("month"), esc(month)].join(","),
    [esc("monthly_fee_rwf"), fee].join(","),
    [esc("included_looks"), `${included}/${c?.monthlyQuota ?? 0}`].join(","),
    [esc("overage_looks"), overage.length].join(","),
    [esc("overage_rwf"), overageRwf].join(","),
    [esc("total_due_rwf"), fee + overageRwf].join(","),
  ];
  return { csv: rows.join("\n"), totals: { fee, included, overage: overage.length, overageRwf, total: fee + overageRwf } };
}
