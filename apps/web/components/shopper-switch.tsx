"use client";

import { haptic } from "@/lib/native";

/**
 * iOS switch for shopper screens (aurora tokens; the studio `Switch` is styled for paper). 51×31 track, 27 px knob on
 * the spring token, 44 px hit area, haptic tick. A real checkbox with role="switch", so labels, keyboard and
 * getByRole("switch") work. Use as a GroupRow `accessory` or inline next to a short label.
 */
export function ShopperSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`hit relative inline-flex shrink-0 cursor-pointer ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          haptic("light");
          onChange(e.target.checked);
        }}
        className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      <span aria-hidden className="h-[31px] w-[51px] rounded-full bg-white/20 transition-colors duration-200 peer-checked:bg-[var(--ios-green)] peer-focus-visible:outline peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]" />
      <span aria-hidden className="spring absolute left-0.5 top-0.5 size-[27px] rounded-full bg-[#fff] shadow-[0_3px_8px_rgba(0,0,0,.15),0_1px_1px_rgba(0,0,0,.16)] peer-checked:translate-x-5" />
    </label>
  );
}
