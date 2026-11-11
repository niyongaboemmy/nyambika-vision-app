/** Pure rules for the full-network migration runner (E21, FR-MIG-04/05). */

export interface JobState {
  index: number;
  status: string;
}

/** Sliding window: enqueue the next PENDING jobs (lowest index first) so at most `concurrency` are in flight. */
export function planDispatch(jobs: JobState[], concurrency: number): number[] {
  const inFlight = jobs.filter((j) => j.status === "ENQUEUED" || j.status === "RUNNING").length;
  const room = Math.max(0, concurrency - inFlight);
  return jobs
    .filter((j) => j.status === "PENDING")
    .sort((a, b) => a.index - b.index)
    .slice(0, room)
    .map((j) => j.index);
}

export const isFinished = (jobs: JobState[]) => jobs.every((j) => j.status === "DONE" || j.status === "FAILED" || j.status === "CANCELLED");

/**
 * Reminder cadence for unsigned pages: reminder n is due `cadenceDays[n-1]` days after the invite.
 * Returns the reminder number to send now (1-based), or null. Never sends two at once or more than the cadence.
 */
export function dueReminder(inviteAt: Date, remindersSent: number, cadenceDays: number[], now: Date): number | null {
  if (remindersSent >= cadenceDays.length) return null;
  const due = inviteAt.getTime() + cadenceDays[remindersSent] * 86_400_000;
  return now.getTime() >= due ? remindersSent + 1 : null;
}

/** Which items a wave rollback touches: everything not already rolled back. */
export function rollbackTargets<T extends { status: string }>(items: T[]): T[] {
  return items.filter((i) => i.status !== "ROLLED_BACK");
}

export type DefectCategory = "payments" | "photos" | "catalogue" | "story" | "other";

export function defectCategory(message: string): DefectCategory {
  if (/momo|merchant|payment/i.test(message)) return "payments";
  if (/no products/i.test(message)) return "catalogue";
  if (/story/i.test(message)) return "story";
  if (/image|photo|readiness|needs better|not supported|light|blur|background/i.test(message)) return "photos";
  return "other";
}

export interface ChecklistInput {
  total: number;
  done: number;
  failed: number;
  running: boolean;
  items: { status: string; invited: boolean; blockers: number }[];
  manual: Record<string, boolean>;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  auto: boolean;
  hint?: string;
}

/** Cut-over checklist (plan §16.3): automatic checks + manual sign-offs. */
export function cutoverChecklist(c: ChecklistInput): ChecklistItem[] {
  const live = c.items.filter((i) => i.status === "LIVE" || i.status === "SIGNED_OFF").length;
  const active = c.items.filter((i) => i.status !== "ROLLED_BACK");
  const share = c.total ? live / c.total : 0;
  return [
    { key: "imported", label: "Every legacy page imported", done: !c.running && c.done + c.failed >= c.total && c.total > 0, auto: true, hint: `${c.done}/${c.total} imported` },
    { key: "failures", label: "Failed imports fixed or re-run", done: c.failed === 0 || !!c.manual.failures, auto: c.failed === 0, hint: c.failed ? `${c.failed} failed` : undefined },
    { key: "invited", label: "Every owner has a review link", done: active.length > 0 && active.every((i) => i.invited), auto: true },
    { key: "blockers", label: "No blocker defects open", done: active.every((i) => i.blockers === 0), auto: true },
    { key: "signoff", label: "≥ 95% of pages signed off (Gate 4)", done: share >= 0.95, auto: true, hint: `${Math.round(share * 100)}%` },
    { key: "redirect_map", label: "Legacy-domain redirect map exported", done: !!c.manual.redirect_map, auto: false },
    { key: "dns", label: "Legacy domain DNS points to the redirect service", done: !!c.manual.dns, auto: false },
    { key: "rollback_rehearsed", label: "Rollback rehearsed on a test wave", done: !!c.manual.rollback_rehearsed, auto: false },
    { key: "support", label: "Support desk briefed for cut-over day", done: !!c.manual.support, auto: false },
  ];
}
