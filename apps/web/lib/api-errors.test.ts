// Unit tests for the API error mapping (error sweep). Run: `pnpm --filter @nyambika/web test` (node --test, type stripping).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeError, errorText, formatCountdown, nextKigaliMidnight, recallFriendly, rememberFriendly } from "./api-errors.ts";

const apiErr = (status: number, body: unknown, message = (body as { message?: string })?.message ?? "") => Object.assign(new Error(message), { status, body });

describe("describeError", () => {
  it("DAILY_CAP → calm daily-cap card with resetsAt, never the raw server sentence", () => {
    const body = { message: "Daily look limit reached (15). New looks unlock tomorrow; saved looks stay free to view.", code: "DAILY_CAP", resetsAt: "2026-11-11T22:00:00.000Z" };
    const d = describeError(apiErr(429, body), "en");
    assert.equal(d.kind, "daily-cap");
    assert.equal(d.expected, true);
    assert.equal(d.resetsAt, "2026-11-11T22:00:00.000Z");
    assert.match(d.title, /today's new looks/);
    assert.doesNotMatch(errorText(apiErr(429, body), "en"), /limit reached/);
  });

  it("DAILY_CAP without resetsAt falls back to the next Kigali midnight", () => {
    const d = describeError(apiErr(429, { code: "DAILY_CAP", message: "x" }), "en");
    assert.equal(new Date(d.resetsAt!).getUTCHours(), 22);
  });

  it("3D twin build cap gets its own copy", () => {
    const d = describeError(apiErr(429, { code: "DAILY_CAP", scope: "AVATAR_3D", message: "You can build your 3D twin 3 times a day." }), "en");
    assert.equal(d.scope, "AVATAR_3D");
    assert.match(d.title, /3D twin/);
  });

  it("localises RW / FR and falls back to EN for SW", () => {
    const e = apiErr(503, { code: "KILL_SWITCH", message: "Looks are paused for a moment." });
    assert.match(describeError(e, "en").title, /resting/);
    assert.match(describeError(e, "fr").title, /reposent/);
    assert.match(describeError(e, "rw").title, /ruhutse/);
    assert.equal(describeError(e, "sw").title, describeError(e, "en").title);
  });

  it("consent codes carry the purpose the inline action grants", () => {
    assert.equal(describeError(apiErr(403, { code: "VOICE_CONSENT", message: "Allow voice" }), "en").purpose, "VOICE_PROCESSING");
    assert.equal(describeError(apiErr(403, { code: "CONSENT_WITHDRAWN", message: "paused" }), "en").purpose, "TRYON_GENERATION");
    const d = describeError(apiErr(403, { code: "CONSENT_REQUIRED", purpose: "AVATAR_3D", message: "Turn on" }), "en");
    assert.equal(d.kind, "consent");
    assert.equal(d.purpose, "AVATAR_3D");
    // a consent code without a known purpose keeps the API's own guidance
    assert.equal(describeError(apiErr(403, { code: "CONSENT_REQUIRED", message: "Please agree to how we use your clip first." }), "en").body, "Please agree to how we use your clip first.");
  });

  it("429s without DAILY_CAP are rate limits (OTP gets its own sentence); retry-after is kept", () => {
    const votes = describeError(Object.assign(apiErr(429, { code: "RATE_LIMITED", message: "Too many votes" }), { retryAfterSec: 30 }), "en");
    assert.equal(votes.kind, "rate");
    assert.equal(votes.retryAfterSec, 30);
    assert.match(describeError(apiErr(429, "Too many codes requested. Try again in 15 minutes.", "Too many codes requested. Try again in 15 minutes."), "en").body, /codes/);
    assert.equal(describeError(apiErr(429, "Lots of voice requests.", "Lots of voice requests."), "en").kind, "rate");
  });

  it("PILOT_ONLY, NLB_GATE, payment and auth map to designed states", () => {
    assert.equal(describeError(apiErr(403, { code: "PILOT_ONLY", message: "closed pilot" }), "en").kind, "pilot");
    const gate = describeError(apiErr(409, { code: "NLB_GATE", message: "Evaluation EVAL_STALE" }), "en");
    assert.equal(gate.kind, "gate");
    assert.equal(gate.body, "Evaluation EVAL_STALE");
    assert.equal(describeError(apiErr(402, { code: "PAYMENT_DECLINED", message: "no" }), "en").kind, "payment");
    assert.equal(describeError(apiErr(401, { message: "Unauthorized" }), "en").kind, "auth");
  });

  it("network failures are offline, not raw 'Failed to fetch'", () => {
    const d = describeError(Object.assign(new TypeError("Failed to fetch"), { status: 0, body: { code: "OFFLINE" } }), "en");
    assert.equal(d.kind, "offline");
    assert.doesNotMatch(errorText(d as never, "en"), /Failed to fetch/);
  });

  it("5xx and HTML gateway pages become one human sentence", () => {
    assert.equal(describeError(apiErr(500, { message: "Internal server error", statusCode: 500 }), "en").kind, "server");
    assert.equal(describeError(apiErr(404, "<!DOCTYPE html><html>…", "Not Found"), "en").kind, "server");
  });

  it("validation lists the fields instead of 'Validation failed'", () => {
    const d = describeError(apiErr(400, { message: "Validation failed", issues: [{ path: "address", message: "Too short" }, { path: "items.0.size", message: "Required" }] }), "en");
    assert.equal(d.kind, "validation");
    assert.equal(d.body, "address, size");
  });

  it("plain 4xx text written for people is kept", () => {
    const d = describeError(apiErr(404, { message: "This item isn't available" }), "en");
    assert.equal(d.kind, "error");
    assert.equal(errorText(apiErr(404, { message: "This item isn't available" }), "en"), "This item isn't available");
  });

  it("programming errors never leak", () => {
    assert.equal(describeError(new TypeError("Cannot read properties of undefined (reading 'x')"), "en").kind, "server");
    assert.equal(describeError(new Error("VR could not start on this device."), "en").title, "VR could not start on this device.");
  });
});

describe("helpers", () => {
  it("registry lets string call sites recognise a designed limit", () => {
    const d = describeError(apiErr(429, { code: "DAILY_CAP", message: "x" }), "en");
    rememberFriendly("friendly cap", d);
    assert.equal(recallFriendly("friendly cap")?.kind, "daily-cap");
    assert.equal(recallFriendly("something else"), null);
  });

  it("Kigali midnight and countdown", () => {
    assert.equal(nextKigaliMidnight(new Date("2026-11-11T21:59:59Z")).toISOString(), "2026-11-11T22:00:00.000Z");
    assert.equal(nextKigaliMidnight(new Date("2026-11-11T22:00:00Z")).toISOString(), "2026-11-12T22:00:00.000Z");
    assert.equal(formatCountdown(3 * 3600_000 + 5 * 60_000 + 9000), "3:05:09");
    assert.equal(formatCountdown(65_000), "1:05");
    assert.equal(formatCountdown(-5), "0:00");
  });
});
