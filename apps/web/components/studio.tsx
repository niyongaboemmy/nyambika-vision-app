"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/** Light-theme primitives for the member Page Manager. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function SButton({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost" }) {
  const v = {
    primary: "bg-stone-900 text-white hover:bg-stone-800",
    outline: "border border-stone-300 bg-white hover:bg-stone-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-stone-700 hover:bg-stone-100",
  }[variant];
  return <button {...p} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 ${v} ${className}`} />;
}

/** Single control: a wrapping <label>. Groups of buttons/checkboxes: pass `group` for <fieldset>/<legend>. */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  if (group) {
    return (
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-semibold text-stone-800">{label}</legend>
        {children}
        {hint && <span className="block text-xs text-stone-500">{hint}</span>}
      </fieldset>
    );
  }
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-stone-800">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-stone-900";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} min-h-24 ${p.className ?? ""}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ""}`} />;

const BADGE: Record<string, string> = {
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  READY: "bg-emerald-100 text-emerald-800",
  PAID: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-stone-200 text-stone-700",
  NOT_ASSESSED: "bg-stone-200 text-stone-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  PENDING_VERIFICATION: "bg-amber-100 text-amber-800",
  AWAITING_PAYMENT: "bg-amber-100 text-amber-800",
  NEEDS_BETTER_PHOTO: "bg-amber-100 text-amber-800",
  PAUSED: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-sky-100 text-sky-800",
  IN_PREPARATION: "bg-sky-100 text-sky-800",
  READY_FOR_PICKUP: "bg-sky-100 text-sky-800",
  SHIPPED: "bg-sky-100 text-sky-800",
  NOT_SUPPORTED: "bg-red-100 text-red-800",
  SUSPENDED: "bg-red-100 text-red-800",
  CANCELLED: "bg-red-100 text-red-800",
  DECLINED: "bg-red-100 text-red-800",
  DISPUTED: "bg-red-100 text-red-800",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[value] ?? "bg-stone-200 text-stone-700"}`}>{label ?? value.replace(/_/g, " ").toLowerCase()}</span>;
}

export function PageTabs({ pageId, isCoop, member }: { pageId: string; isCoop: boolean; member?: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: `/studio/${pageId}`, label: "Overview" },
    { href: `/studio/${pageId}/products`, label: member ? "My products" : "Products" },
    ...(member ? [] : [{ href: `/studio/${pageId}/orders`, label: "Orders" }]),
    ...(isCoop && !member ? [{ href: `/studio/${pageId}/makers`, label: "Makers" }] : []),
    ...(member ? [] : [{ href: `/studio/${pageId}/settings`, label: "Settings" }]),
  ];
  return (
    <nav className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-4">
      {tabs.map((t) => {
        const active = path === t.href || (t.href !== `/studio/${pageId}` && path.startsWith(t.href));
        return (
          <Link key={t.href} href={t.href} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold ${active ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-600">{children}</div>;
}

export function Note({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (ok) return <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{ok}</p>;
  return null;
}
