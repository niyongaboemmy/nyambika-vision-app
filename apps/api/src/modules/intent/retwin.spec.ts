import { describe, expect, it } from "vitest";
import { retwinOrder, twinKeyPrefix, type RetwinCandidate } from "./retwin";

const look = (index: number, o: Partial<RetwinCandidate> = {}): RetwinCandidate => ({ id: `l${index}`, index, rendered: true, onCurrentTwin: false, ...o });

describe("retwinOrder", () => {
  it("renders the visible look first, then the next, then the previous", () => {
    const looks = [0, 1, 2, 3, 4, 5].map((i) => look(i));
    expect(retwinOrder(looks, 3)).toEqual(["l3", "l4", "l2", "l5"]);
  });

  it("skips looks already on the twin and looks never rendered", () => {
    const looks = [look(0), look(1, { onCurrentTwin: true }), look(2, { rendered: false }), look(3)];
    expect(retwinOrder(looks, 1)).toEqual(["l0", "l3"]);
  });

  it("is empty when everything near is on the twin", () => {
    expect(retwinOrder([look(0, { onCurrentTwin: true }), look(1, { onCurrentTwin: true })], 0)).toEqual([]);
  });

  it("clamps a negative index to the first look", () => {
    expect(retwinOrder([look(0), look(1), look(2), look(3)], -4)).toEqual(["l0", "l1", "l2"]);
  });
});

describe("twinKeyPrefix", () => {
  it("matches the generation cache key format", () => {
    expect(twinKeyPrefix({ id: "tw1", version: 2 })).toBe("tw1:v2|");
    expect(twinKeyPrefix(null)).toBeNull();
  });
});
