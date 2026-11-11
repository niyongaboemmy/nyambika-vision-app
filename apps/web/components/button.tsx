import type { ButtonHTMLAttributes } from "react";

/** Primary shopper button (gradient CTA, glass, ghost, danger). Re-exported by ui.tsx. */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "glass" | "ghost" | "danger" }) {
  const styles = {
    primary: "grad-cta text-white shadow-[0_10px_30px_rgba(139,92,246,.35)]",
    glass: "glass text-white",
    ghost: "text-txt/80 hover:text-txt",
    danger: "bg-red-600 text-white",
  }[variant];
  return (
    <button
      {...props}
      className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-50 ${styles} ${className}`}
    />
  );
}
