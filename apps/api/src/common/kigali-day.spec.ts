import { describe, expect, it } from "vitest";
import { dailyCapBody, kigaliDayStart, nextKigaliMidnight } from "./kigali-day";

describe("Kigali day boundaries (daily look cap)", () => {
  it("starts the day at 22:00 UTC of the previous UTC date", () => {
    // 2026-11-11 08:30 Kigali = 06:30 UTC
    expect(kigaliDayStart(new Date("2026-11-11T06:30:00Z")).toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(nextKigaliMidnight(new Date("2026-11-11T06:30:00Z")).toISOString()).toBe("2026-11-11T22:00:00.000Z");
  });

  it("rolls over at Kigali midnight, not UTC midnight", () => {
    // 23:30 UTC is already 01:30 the next day in Kigali
    expect(kigaliDayStart(new Date("2026-11-11T23:30:00Z")).toISOString()).toBe("2026-11-11T22:00:00.000Z");
    // 21:59 UTC is still 23:59 the same Kigali day
    expect(nextKigaliMidnight(new Date("2026-11-11T21:59:00Z")).toISOString()).toBe("2026-11-11T22:00:00.000Z");
    // exactly midnight Kigali belongs to the new day
    expect(kigaliDayStart(new Date("2026-11-11T22:00:00Z")).toISOString()).toBe("2026-11-11T22:00:00.000Z");
  });

  it("DAILY_CAP body carries resetsAt and retryAfterSec for the calm card", () => {
    const b = dailyCapBody(15, 15, new Date("2026-11-11T21:00:00Z"));
    expect(b).toMatchObject({ code: "DAILY_CAP", cap: 15, used: 15, resetsAt: "2026-11-11T22:00:00.000Z", retryAfterSec: 3600 });
    expect(b.message).toMatch(/Daily look limit/);
  });
});
