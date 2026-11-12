/*
 * Looks stream tokens and the stream skeleton, with no "use client" (JS budget pass 2): `loading.tsx` renders the
 * skeleton on the server with zero client JS, and the client pages share one copy of it instead of shipping
 * look-rail twice (once as the loading segment's client reference with all its exports, once in the page).
 * look-rail.tsx re-exports everything here, so existing imports keep working.
 */

/** iOS-like spring (≈ stiffness 260 / damping 20) as a CSS/WAAPI `linear()` easing. */
export const SPRING =
  "linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.6%, 0.588 5.6%, 0.8 7.6%, 0.944 9.7%, 1.034 11.9%, 1.08 14.3%, 1.092 16.4%, 1.084 19.2%, 1.043 25.1%, 1.016 30.7%, 0.999 37.5%, 0.995 46.2%, 1.001 63.1%, 1)";

/** Dark material for chrome floating over photos (stays legible on any garment, both themes: media is dark). */
export const MAT_BASE = "border border-white/15 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_24px_-12px_rgba(0,0,0,.6)]";
export const MATERIAL = `${MAT_BASE} bg-black/35`;

/** Full-bleed loading state for the stream and try-on (same anatomy as the final screen). */
export function LooksSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="theme-media relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-black">
      <div data-skeleton aria-hidden className="skeleton absolute inset-0 rounded-none" />
      <div aria-hidden className="absolute inset-x-0 top-0 grid grid-cols-[44px_1fr_44px] items-center px-3 pt-[max(env(safe-area-inset-top),12px)]">
        <span className={`size-10 rounded-full ${MATERIAL}`} />
        <span className={`mx-auto h-7 w-24 rounded-full ${MATERIAL}`} />
      </div>
      <div aria-hidden className={`absolute inset-x-0 bottom-0 rounded-t-[28px] ${MAT_BASE} bg-black/55`} style={{ height: "max(13dvh, 128px)" }} />
    </div>
  );
}
