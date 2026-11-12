"use client";

/*
 * Sign in without leaving the screen (navigation pass). `askSignIn()` opens the sign-in sheet over the current
 * screen (mounted lazily by DeferredGlobals) and resolves true once signed in, false if dismissed, so the caller
 * resumes the original action: tap Buy → sheet → back on the same look with the buy sheet open.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "./session";

export interface SignInAsk {
  id: number;
  /** One short line for why (e.g. "Sign in to buy"). */
  reason?: string;
}

let ask: SignInAsk | null = null;
let settle: ((ok: boolean) => void) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function askSignIn(reason?: string): Promise<boolean> {
  settle?.(false); // a second ask replaces the first
  return new Promise<boolean>((resolve) => {
    ask = { id: Date.now(), reason };
    settle = resolve;
    emit();
  });
}

/** Called by the sheet: signed in (true) or dismissed (false). */
export function finishSignIn(ok: boolean) {
  const s = settle;
  ask = null;
  settle = null;
  emit();
  s?.(ok);
}

export function useSignInAsk(): SignInAsk | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => ask,
    () => null,
  );
}

/** `await needSignIn("Sign in to buy")` → true when signed in (already, or via the sheet). */
export function useNeedSignIn() {
  const { me } = useSession();
  return useCallback((reason?: string) => (me ? Promise.resolve(true) : askSignIn(reason)), [me]);
}
