// Return-to links (lib/nav.ts): only same-site paths survive, so `?next=` can't bounce a shopper off-site.
// Navigation pass: the tab trail, parents for deep links, return labels and the Looks index in the URL.
// Run: `pnpm --filter @nyambika/web test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parentOf, previousInTrail, returnLabel, routeKey, safeReturn, trailStep, withLookIndex, withReturn } from "./nav.ts";

test("keeps in-app paths with their query", () => {
  assert.equal(safeReturn("/looks/abc?i=3"), "/looks/abc?i=3");
  assert.equal(safeReturn("/m/kigali-kitenge-house/showroom"), "/m/kigali-kitenge-house/showroom");
});

test("rejects other origins and tricks", () => {
  for (const bad of ["https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "looks/abc", "", null, undefined]) {
    assert.equal(safeReturn(bad as string | null | undefined), null, String(bad));
  }
});

test("withReturn appends an encoded next, never to itself", () => {
  assert.equal(withReturn("/mirror", "/looks/abc?i=3"), "/mirror?next=%2Flooks%2Fabc%3Fi%3D3");
  assert.equal(withReturn("/mirror?step=camera", "/trust"), "/mirror?step=camera&next=%2Ftrust");
  assert.equal(withReturn("/mirror", "https://evil.example"), "/mirror");
  assert.equal(withReturn("/mirror", "/mirror"), "/mirror");
});

test("trail: push, pop back to the previous screen, replace on a query change", () => {
  let t: string[] = [];
  ({ trail: t } = trailStep(t, "/"));
  ({ trail: t } = trailStep(t, "/looks/s1"));
  const toTwin = trailStep(t, "/mirror?next=%2Flooks%2Fs1%3Fi%3D3");
  assert.equal(toTwin.dir, "push");
  const back = trailStep(toTwin.trail, "/looks/s1");
  assert.equal(back.dir, "pop");
  assert.deepEqual(back.trail, ["/", "/looks/s1"]);
  const q = trailStep(back.trail, "/looks/s1?i=3");
  assert.equal(q.dir, "replace");
  assert.deepEqual(q.trail, ["/", "/looks/s1?i=3"]);
  assert.equal(previousInTrail(q.trail), "/");
  assert.equal(previousInTrail(["/orders/1"]), null);
});

test("trail: a browser back (popstate) drops the top even with a different query", () => {
  const r = trailStep(["/", "/looks/s1", "/m/a"], "/looks/s1?i=3", true);
  assert.equal(r.dir, "pop");
  assert.deepEqual(r.trail, ["/", "/looks/s1?i=3"]);
  assert.deepEqual(trailStep(["/m/a"], "/", true).trail, ["/"]);
});

test("trail is bounded", () => {
  let t: string[] = [];
  for (let i = 0; i < 50; i++) t = trailStep(t, `/p/${i}`).trail;
  assert.equal(t.length, 30);
  assert.equal(t.at(-1), "/p/49");
});

test("deep links fall back to a sensible parent", () => {
  assert.equal(parentOf("/orders/o1?fresh=1"), "/orders");
  assert.equal(parentOf("/orders"), "/");
  assert.equal(parentOf("/custom/c1"), "/custom");
  assert.equal(parentOf("/circle/p1"), "/circle");
  assert.equal(parentOf("/circle"), "/wardrobe");
  assert.equal(parentOf("/wardrobe/events/e1"), "/wardrobe");
  assert.equal(parentOf("/mirror/mr?product=x"), "/mirror/ar");
  assert.equal(parentOf("/mirror/ar"), "/mirror/3d");
  assert.equal(parentOf("/mirror/3d"), "/mirror");
  assert.equal(parentOf("/m/kigali/showroom?item=1"), "/m/kigali");
  assert.equal(parentOf("/m/kigali"), "/makers");
  assert.equal(parentOf("/studio/p1/products/x"), "/studio/p1/products");
  assert.equal(parentOf("/studio/p1/training"), "/studio/p1/settings");
  assert.equal(parentOf("/studio/p1/orders"), "/studio/p1");
  assert.equal(parentOf("/admin/pilot"), "/admin");
  assert.equal(parentOf("/looks/s1?i=2"), "/");
  assert.equal(parentOf("/"), "/");
});

test("route keys ignore the query", () => {
  assert.equal(routeKey("/m/a/showroom?item=1", "scroll"), "nv-route:/m/a/showroom:scroll");
});

test("return labels", () => {
  assert.equal(returnLabel("/looks/s1?i=3"), "Back to your looks");
  assert.equal(returnLabel("/m/a/showroom?item=1"), "Back to the showroom");
  assert.equal(returnLabel("/m/a"), "Back to the Maker Space");
  assert.equal(returnLabel("/trust"), "Back to Trust centre");
  assert.equal(returnLabel("/x"), "Back to where you were");
});

test("look index lives in ?i= and keeps other params", () => {
  assert.equal(withLookIndex("/looks/s1", 3), "/looks/s1?i=3");
  assert.equal(withLookIndex("/looks/s1?snap=4&i=3", 0), "/looks/s1?snap=4");
  assert.equal(withLookIndex("/looks/s1?snap=4", 2), "/looks/s1?snap=4&i=2");
});
