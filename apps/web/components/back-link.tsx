"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { useBack } from "@/lib/use-nav";

/** A back control: plain link semantics (modifier clicks open the href), smart back on a normal click. */
export function BackLink({ href, onBack, className, label = "Back", children }: { href: string; onBack: () => void; className?: string; label?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onBack();
      }}
    >
      {children ?? <Icon name="back" className="size-5" />}
    </a>
  );
}

/**
 * Back to the previous screen when it is ours (filters, scroll and tab kept), else `?next=`, else `fallback`
 * (navigation pass). For studio / admin headers that draw their own round back control.
 */
export function BackButton({ fallback, className, label = "Back" }: { fallback: string; className?: string; label?: string }) {
  const back = useBack(fallback);
  return <BackLink href={fallback} onBack={back} className={className} label={label} />;
}
