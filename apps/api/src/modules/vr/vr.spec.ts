import { describe, expect, it } from "vitest";
import {
  BoothInput,
  reminderDue,
  roomLayout,
  runwayCursor,
  scheduleProblems,
  shapeShelf,
  SHOW,
  showDurationSec,
  ShowInput,
  showPhase,
  SHOWROOM_BUDGET,
  walkPose,
  type ShelfSource,
} from "@nyambika/contracts";

const MB = 1024 * 1024;
const asset = (variantId: string, bytes = 0.35 * MB) => ({ variantId, glbPath: `g/${variantId}.glb`, posterPath: `g/${variantId}.webp`, heightM: 1.1, bytes, size: "M" });
const product = (id: string, variants: string[]) => ({ id, title: `T ${id}`, priceRwf: 1000, category: "dress", variants: variants.map((v) => ({ id: v, colourName: v, colourHex: "#000", imagePath: null })) });

describe("3D shelf data shaping (E35)", () => {
  const src = (over: Partial<ShelfSource> = {}): ShelfSource => ({
    products: [product("p1", ["a", "b"]), product("p2", ["c"]), product("p3", ["d"]), product("p4", ["e", "f"])],
    assets: new Map([["a", asset("a")], ["b", asset("b")], ["d", asset("d")], ["f", asset("f")]]),
    ...over,
  });

  it("keeps one entry per product with approved 3D, all its 3D colours, and skips products without 3D", () => {
    const out = shapeShelf(src());
    expect(out.map((i) => i.productId)).toEqual(["p1", "p3", "p4"]);
    expect(out[0].colours.map((c) => c.variantId)).toEqual(["a", "b"]);
    expect(out[2].variantId).toBe("f"); // first colour that has a model, not the first colour
  });

  it("puts featured pieces first in the maker's order", () => {
    const out = shapeShelf(src({ featured: ["p4", "p3"] }));
    expect(out.map((i) => i.productId)).toEqual(["p4", "p3", "p1"]);
    expect(out.map((i) => i.featured)).toEqual([true, true, false]);
  });

  it("caps the count and the 25 MB room budget (FR-VR-08)", () => {
    expect(shapeShelf(src(), 2)).toHaveLength(2);
    const heavy = src({ assets: new Map([["a", asset("a", 20 * MB)], ["d", asset("d", 6 * MB)], ["f", asset("f", 4 * MB)]]) });
    const out = shapeShelf(heavy);
    expect(out.map((i) => i.productId)).toEqual(["p1", "p4"]);
    expect(out.reduce((s, i) => s + i.bytes, 0)).toBeLessThanOrEqual(SHOWROOM_BUDGET.totalBytes);
  });

  it("empty when nothing has approved 3D", () => {
    expect(shapeShelf(src({ assets: new Map() }))).toEqual([]);
  });
});

describe("room layout", () => {
  it("puts up to five pieces on mannequins and the rest on side rails, all facing the centre", () => {
    const l = roomLayout(9);
    expect(l.filter((p) => p.kind === "mannequin")).toHaveLength(5);
    expect(l.filter((p) => p.kind === "rail")).toHaveLength(4);
    expect(new Set(l.filter((p) => p.kind === "rail").map((p) => Math.sign(p.x)))).toEqual(new Set([-1, 1]));
    for (const p of l) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(6.5);
      // Facing the centre: the yaw vector points back towards (0, 0).
      const fx = Math.sin(p.rotY);
      const fz = Math.cos(p.rotY);
      expect(fx * -p.x + fz * -p.z).toBeGreaterThan(0);
    }
    expect(roomLayout(1)[0]).toMatchObject({ kind: "mannequin", x: 0 });
  });
});

describe("show schedule and phases (FR-VR-05)", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  const base = { status: "SCHEDULED", items: 4, walkSec: 14 };

  it("validates the input and the time window", () => {
    expect(ShowInput.safeParse({ title: "Ok show", startsAt: at(60).toISOString(), items: [] }).success).toBe(false);
    expect(ShowInput.safeParse({ title: "Ok show", startsAt: at(60).toISOString(), items: Array.from({ length: 13 }, (_, i) => ({ productId: `p${i}` })) }).success).toBe(false);
    expect(ShowInput.parse({ title: "Ok show", startsAt: at(60).toISOString(), items: [{ productId: "p" }] })).toMatchObject({ walkSec: 14, modelSize: "M" });
    expect(scheduleProblems({ startsAt: at(-10).toISOString(), items: [{ productId: "a" }] }, now)[0]).toMatch(/passed/);
    expect(scheduleProblems({ startsAt: at(-1).toISOString(), items: [{ productId: "a" }] }, now)).toEqual([]); // "now" with grace
    expect(scheduleProblems({ startsAt: at(91 * 1440).toISOString(), items: [{ productId: "a" }] }, now)[0]).toMatch(/90 days/);
    expect(scheduleProblems({ startsAt: at(10).toISOString(), items: [{ productId: "a" }, { productId: "a" }] }, now)).toContain("Each piece can walk only once per show");
    expect(BoothInput.safeParse({ enabled: true, featured: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
  });

  it("derives upcoming → doors open → live → ended", () => {
    const dur = showDurationSec(4, 14);
    expect(dur).toBe(SHOW.introSec + 56 + SHOW.outroSec);
    expect(showPhase({ ...base, startsAt: at(30) }, now)).toBe("UPCOMING");
    expect(showPhase({ ...base, startsAt: at(10) }, now)).toBe("DOORS_OPEN");
    expect(showPhase({ ...base, startsAt: at(0) }, now)).toBe("LIVE");
    expect(showPhase({ ...base, startsAt: new Date(now.getTime() - (dur - 1) * 1000) }, now)).toBe("LIVE");
    expect(showPhase({ ...base, startsAt: new Date(now.getTime() - dur * 1000) }, now)).toBe("ENDED");
    expect(showPhase({ ...base, status: "CANCELLED", startsAt: at(0) }, now)).toBe("CANCELLED");
  });

  it("every viewer computes the same runway position from the clock", () => {
    expect(runwayCursor(-5, 3, 14).stage).toBe("before");
    expect(runwayCursor(2, 3, 14)).toMatchObject({ stage: "intro", index: 0 });
    expect(runwayCursor(SHOW.introSec + 15, 3, 14)).toMatchObject({ stage: "walk", index: 1 });
    expect(runwayCursor(SHOW.introSec + 15, 3, 14).t).toBeCloseTo(1 / 14);
    expect(runwayCursor(SHOW.introSec + 42 + 1, 3, 14)).toMatchObject({ stage: "outro", index: 2 });
    expect(runwayCursor(SHOW.introSec + 42 + SHOW.outroSec, 3, 14).stage).toBe("after");
  });

  it("a walk goes out, turns at the front and comes back, fading in and out", () => {
    expect(walkPose(0).opacity).toBe(0);
    expect(walkPose(0.2)).toMatchObject({ yaw: 0, moving: true });
    expect(walkPose(0.5).moving).toBe(false);
    expect(walkPose(0.8).yaw).toBeCloseTo(Math.PI);
    expect(walkPose(0.41).z).toBeGreaterThan(walkPose(0.1).z);
    expect(walkPose(1).opacity).toBe(0);
  });

  it("sends one reminder inside the lead window, never for cancelled or finished shows", () => {
    const show = (min: number, status = "SCHEDULED") => ({ status, startsAt: at(min), items: 4, walkSec: 14 });
    expect(reminderDue(show(90), { remindedAt: null }, now)).toBe(false);
    expect(reminderDue(show(60), { remindedAt: null }, now)).toBe(true);
    expect(reminderDue(show(5), { remindedAt: null }, now)).toBe(true);
    expect(reminderDue(show(-1), { remindedAt: null }, now)).toBe(true); // just started: still worth it
    expect(reminderDue(show(-10), { remindedAt: null }, now)).toBe(false); // over
    expect(reminderDue(show(30), { remindedAt: now }, now)).toBe(false);
    expect(reminderDue(show(30, "CANCELLED"), { remindedAt: null }, now)).toBe(false);
  });
});
