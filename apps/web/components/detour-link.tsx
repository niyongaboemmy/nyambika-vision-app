"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { withReturn } from "@/lib/nav";
import { go } from "@/lib/use-nav";

/**
 * A link into a detour (Trust centre, twin, measurements…) that carries `?next=<this screen>`, read at click time
 * so it includes the current look index / selected piece and stays hydration-safe. Pushes with the iOS motion;
 * `onBeforeGo` can stash something to resume on return (e.g. reopen the buy sheet).
 */
export function DetourLink({ href, onBeforeGo, onClick, ...rest }: ComponentProps<typeof Link> & { href: string; onBeforeGo?: () => void }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onBeforeGo?.();
        go(router, withReturn(href), "push");
      }}
    />
  );
}
