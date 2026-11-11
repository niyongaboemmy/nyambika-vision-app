import { describe, expect, it } from "vitest";
import { cutoverChecklist, defectCategory, dueReminder, isFinished, planDispatch, rollbackTargets, type JobState } from "./network-rules";

const jobs = (...s: string[]): JobState[] => s.map((status, index) => ({ index, status }));

describe("wave concurrency window (E21)", () => {
  it("fills the window with the lowest pending indexes", () => {
    expect(planDispatch(jobs("PENDING", "PENDING", "PENDING", "PENDING", "PENDING"), 2)).toEqual([0, 1]);
  });

  it("counts enqueued and running jobs as in flight and never overshoots", () => {
    expect(planDispatch(jobs("RUNNING", "ENQUEUED", "PENDING", "PENDING"), 2)).toEqual([]);
    expect(planDispatch(jobs("DONE", "RUNNING", "PENDING", "PENDING"), 2)).toEqual([2]);
    expect(planDispatch(jobs("DONE", "FAILED", "CANCELLED", "PENDING"), 4)).toEqual([3]);
  });

  it("simulated run never exceeds the window and finishes every job", () => {
    const state = jobs(...new Array(23).fill("PENDING"));
    let peak = 0;
    for (let tick = 0; tick < 100 && !isFinished(state); tick++) {
      for (const i of planDispatch(state, 4)) state[i].status = "ENQUEUED";
      for (const j of state) if (j.status === "ENQUEUED") j.status = "RUNNING";
      peak = Math.max(peak, state.filter((j) => j.status === "RUNNING").length);
      // finish one or two running jobs per tick, some fail
      state.filter((j) => j.status === "RUNNING").slice(0, 1 + (tick % 2)).forEach((j) => (j.status = j.index % 7 === 0 ? "FAILED" : "DONE"));
    }
    expect(isFinished(state)).toBe(true);
    expect(peak).toBe(4);
  });
});

describe("owner reminders (E21)", () => {
  const invite = new Date("2026-11-01T08:00:00Z");
  const at = (days: number) => new Date(invite.getTime() + days * 86400_000);
  it("follows the cadence one reminder at a time", () => {
    expect(dueReminder(invite, 0, [2, 5, 9], at(1.9))).toBeNull();
    expect(dueReminder(invite, 0, [2, 5, 9], at(2))).toBe(1);
    expect(dueReminder(invite, 1, [2, 5, 9], at(4))).toBeNull();
    expect(dueReminder(invite, 0, [2, 5, 9], at(30))).toBe(1); // a late sweep still sends only the next one
    expect(dueReminder(invite, 2, [2, 5, 9], at(9))).toBe(3);
    expect(dueReminder(invite, 3, [2, 5, 9], at(60))).toBeNull();
  });
});

describe("rollback-all and dashboard rules (E21)", () => {
  it("rolls back every item that is not already rolled back, including live pages", () => {
    const items = ["IMPORTED", "IN_REVIEW", "SIGNED_OFF", "LIVE", "ROLLED_BACK", "CHANGES_REQUESTED"].map((status, i) => ({ id: String(i), status }));
    expect(rollbackTargets(items).map((i) => i.status)).toEqual(["IMPORTED", "IN_REVIEW", "SIGNED_OFF", "LIVE", "CHANGES_REQUESTED"]);
  });

  it("classifies defects", () => {
    expect(defectCategory("No MoMo merchant number: hold-to-buy stays off")).toBe("payments");
    expect(defectCategory("Dress (Indigo): needs better photo · Background is busy")).toBe("photos");
    expect(defectCategory("Shirt (Teal): image could not be loaded (fetch failed).")).toBe("photos");
    expect(defectCategory("No products imported.")).toBe("catalogue");
    expect(defectCategory("Short page story: a few sentences")).toBe("story");
  });

  it("cut-over checklist needs 95% signed off and the manual sign-offs", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ status: i < 19 ? "LIVE" : "IN_REVIEW", invited: true, blockers: 0 }));
    const c = cutoverChecklist({ total: 20, done: 20, failed: 0, running: false, items, manual: { redirect_map: true } });
    const byKey = Object.fromEntries(c.map((x) => [x.key, x.done]));
    expect(byKey).toMatchObject({ imported: true, failures: true, invited: true, blockers: true, signoff: true, redirect_map: true, dns: false, rollback_rehearsed: false });
    const low = cutoverChecklist({ total: 20, done: 18, failed: 2, running: false, items: items.slice(0, 18).map((i, k) => ({ ...i, status: k < 10 ? "LIVE" : "IN_REVIEW" })), manual: {} });
    expect(Object.fromEntries(low.map((x) => [x.key, x.done]))).toMatchObject({ imported: true, failures: false, signoff: false });
  });
});
