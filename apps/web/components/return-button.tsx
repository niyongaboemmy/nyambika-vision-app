"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import { returnLabel, returnTarget } from "@/lib/nav";
import { haptic } from "@/lib/native";
import { useReturn } from "@/lib/use-nav";

/**
 * On a terminal screen (order placed, request sent, poll live): when it was opened with `?next=`, a way back to
 * where the shopper was. Renders nothing otherwise (or for a `next` pointing at this same screen).
 */
export function NextReturn({ className = "" }: { className?: string }) {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    const n = returnTarget();
    setTo(n && n.split("?")[0] !== window.location.pathname ? n : null);
  }, []);
  if (!to) return null;
  return <div className={className}><ReturnButton to={to} quiet /></div>;
}

/**
 * "Back to your looks" at the end of a detour (twin made, measurements saved, consent given). With `auto`, a short
 * draining countdown returns the shopper by itself (Stay here cancels). Reduced motion skips the drain animation
 * but keeps the countdown text and the button. Returning uses history when the origin is the previous screen,
 * so the Looks index, selected piece and scroll come back as they were.
 */
export function ReturnButton({ to, auto = false, seconds = 3, label, quiet = false }: { to: string; auto?: boolean; seconds?: number; label?: string; /** Secondary (glass) style, for screens whose main action is something else. */ quiet?: boolean }) {
  const back = useReturn();
  const [left, setLeft] = useState(auto ? seconds : 0);
  const [stayed, setStayed] = useState(false);
  const go = () => {
    haptic("success");
    back(to);
  };
  useEffect(() => {
    if (!auto || stayed) return;
    if (left <= 0) return go();
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, stayed, left]);
  const counting = auto && !stayed && left > 0;
  return (
    <div className="space-y-2" data-return={to}>
      <Button variant={quiet ? "glass" : undefined} className="relative w-full overflow-hidden" onClick={go}>
        {counting && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-full bg-white/20 motion-reduce:hidden"
            style={{ animation: `nv-drain ${seconds}s linear forwards` }}
          />
        )}
        <span className="relative inline-flex items-center gap-2">
          <Icon name="back" className="size-5" /> {label ?? returnLabel(to)}
          {counting && <span className="tabular-nums opacity-80">· {left}</span>}
        </span>
      </Button>
      {counting && (
        <button type="button" onClick={() => setStayed(true)} className="min-h-11 w-full text-sm text-mut">
          Stay here
        </button>
      )}
      <style>{`@keyframes nv-drain { from { transform: translateX(0) } to { transform: translateX(-100%) } }`}</style>
    </div>
  );
}
