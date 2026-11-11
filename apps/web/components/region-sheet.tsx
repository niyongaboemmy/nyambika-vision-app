"use client";

/** Country / display-currency / cross-border sheet opened from <RegionPill> (E41), loaded after first paint. */

import { CURRENCY_CODES } from "@nyambika/contracts/money";
import { REGIONS, REGION_CODES } from "@nyambika/contracts/region-data";
import { useRouter } from "next/navigation";
import { Button, Chip, Sheet } from "@/components/ui";
import { useRegion } from "@/lib/region";
import { useSession } from "@/lib/session";

export function RegionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useSession();
  const { prefs, fx, update } = useRegion();
  const router = useRouter();
  const set = async (p: Parameters<typeof update>[0]) => {
    navigator.vibrate?.(8);
    await update(p);
    router.refresh();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h2 className="font-display text-2xl font-black">{t("region.showPricesIn")}</h2>
      <fieldset className="mt-3">
        <legend className="sr-only">{t("region.showPricesIn")}</legend>
        <div className="flex flex-wrap gap-2">
          {CURRENCY_CODES.map((c) => (
            <Chip key={c} active={prefs.displayCurrency === c} onClick={() => void set({ displayCurrency: c })}>{c}</Chip>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 text-xs text-mut">{t("region.approxNote")}{fx ? ` Rates: ${fx.source === "dev-fixed-synthetic" ? "synthetic dev rates" : fx.source}, ${new Date(fx.fetchedAt).toLocaleDateString("en-GB")}.` : ""}</p>

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-mut">{t("region.country")}</legend>
        <div className="flex flex-wrap gap-2">
          {REGION_CODES.map((c) => (
            <Chip key={c} active={prefs.country === c} onClick={() => void set({ country: c })}>{REGIONS[c].flag} {REGIONS[c].name}</Chip>
          ))}
        </div>
      </fieldset>

      <label className="glass mt-5 flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4">
        <span>
          <span className="block font-semibold">{t("region.crossBorder")}</span>
          <span className="block text-xs text-mut">{t("region.crossBorderHint")}</span>
        </span>
        <input type="checkbox" role="switch" className="size-6 accent-[#F2B84B]" checked={prefs.crossBorder} onChange={(e) => void set({ crossBorder: e.target.checked })} />
      </label>
      <Button variant="glass" className="mt-5 w-full" onClick={onClose}>Done</Button>
    </Sheet>
  );
}
