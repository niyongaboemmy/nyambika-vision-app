// Return-to links (lib/nav.ts): only same-site paths survive, so `?next=` can't bounce a shopper off-site.
// Run: `pnpm --filter @nyambika/web test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturn, withReturn } from "./nav.ts";

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
