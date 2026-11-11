import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as root from "@nyambika/contracts";
import { describe, expect, it } from "vitest";

// JS budget pass: the browser imports these zod-free modules via `@nyambika/contracts/<name>`; the API keeps the root.
const SRC = resolve(__dirname, "../../../../packages/contracts/src");
const SUBPATHS = ["money", "region-data", "tailor-data", "ambient-model"] as const;

describe("contracts zod-free subpaths", () => {
  it.each(SUBPATHS)("%s imports no zod (directly or through another module)", (name) => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(resolve(SRC, `${file}.ts`), "utf8");
      expect(src, `${file}.ts`).not.toMatch(/from "zod"/);
      for (const m of src.matchAll(/^import(?! type)[^;]*from "\.\/([\w-]+)"/gm)) walk(m[1]);
    };
    walk(name);
  });

  it("are exported by package.json and re-exported unchanged by the root", () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, "../package.json"), "utf8"));
    for (const name of SUBPATHS) {
      expect(pkg.exports[`./${name}`]).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sub = require(resolve(SRC, `../dist/${name}.js`)) as Record<string, unknown>;
      for (const [k, v] of Object.entries(sub)) expect((root as Record<string, unknown>)[k], `${name}.${k}`).toBe(v);
    }
  });

  it("keeps the zod schemas and helpers on the root for the API", () => {
    expect(root.CurrencyCode.parse("KES")).toBe("KES");
    expect(root.RegionCode.safeParse("XX").success).toBe(false);
    expect(root.Wallet.options).toEqual(["MTN_MOMO", "AIRTEL_MONEY", "MPESA"]);
    expect(root.MorphSpec.parse({})).toEqual({ hue: null, length: null, sleeve: null });
    expect(root.NotificationPrefs.safeParse(root.DEFAULT_NOTIFICATION_PREFS).success).toBe(true);
    expect(root.LiveActivityContentState.safeParse(root.liveActivityState(root.orderAmbient({ orderId: "o", code: "NY-1", status: "PAID", makerName: "Uwase", itemTitle: "dress" } as Parameters<typeof root.orderAmbient>[0]), "rw")).success).toBe(true);
    expect(root.signInPhone("0712 345 678", "KE")).toEqual({ ok: true, e164: "+254712345678", country: "KE" });
    expect(root.displayPrice({ amountMinor: 450000, currency: "KES" }, "RWF", { KES: "129", RWF: "1300" }).primary).toBe("KES 4,500");
    expect(root.morphPrice(10000, root.MorphTemplateInput.parse({ lengths: { maxi: 2000 } }), { hue: null, length: "maxi", sleeve: null }).totalRwf).toBe(12000);
  });
});
