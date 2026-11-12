// Per-locale catalogues (JS budget pass 2): English is bundled, rw/fr/sw load on demand. Run: `pnpm --filter @nyambika/web test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogues, isLocaleLoaded, loadLocale, LOCALES, translate } from "@nyambika/i18n";
import { en } from "../../../packages/i18n/src/en.ts";

describe("lazy locale catalogues", () => {
  it("English is there synchronously; other locales fall back to it until loaded", () => {
    assert.equal(isLocaleLoaded("en"), true);
    assert.equal(translate("en", "auth.sendCode"), "Send code");
    if (!isLocaleLoaded("rw")) assert.equal(translate("rw", "auth.sendCode"), "Send code");
  });

  it("loadLocale is idempotent and fills the catalogue", async () => {
    const a = loadLocale("fr");
    assert.equal(loadLocale("fr"), a);
    await a;
    assert.equal(isLocaleLoaded("fr"), true);
    assert.notEqual(translate("fr", "auth.sendCode"), "Send code");
  });

  it("rw and fr cover every English key; sw stays a partial draft", async () => {
    await Promise.all(LOCALES.map(loadLocale));
    const keys = Object.keys(en).sort();
    assert.deepEqual(Object.keys(catalogues.rw).sort(), keys);
    assert.deepEqual(Object.keys(catalogues.fr).sort(), keys);
    assert.ok(Object.keys(catalogues.sw).every((k) => k in en));
  });
});
