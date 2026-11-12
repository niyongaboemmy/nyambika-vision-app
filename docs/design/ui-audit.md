# UI/UX audit and modernisation (web, Nov 2026)

Scope: the whole web app (`apps/web`): shopper screens (Muse, Looks, Maker Space, mirror/twin, 3D/VR, wardrobe,
circle, bag, orders, trust centre) and member screens (studio, host admin, migrate review). UI only: no API or
schema changes. Branch `worktree-agent-a3207c57440e12340`, slot 4.

How it was measured

- `scripts/crawl-uiux.mjs`: 49 screens (shopper, studio, admin) × light/dark × 390/1280 px (360 px for the
  overflow check), axe-core WCAG 2.0/2.1/2.2 A+AA at 390 px, fails on console errors, 5xx, horizontal overflow, a
  missing `data-theme` at DOMContentLoaded (theme flash) and any serious/critical axe violation.
- `scripts/perf-uiux.mjs`: production build (`NEXT_DIST_DIR=.next-build next build` + `next start`), cold context
  per route, Pixel 7, 4× CPU slowdown, "slow 4G" (150 ms RTT, 1.6 Mbps). First-load JS = gzip bytes of every
  script downloaded until network idle; LCP and CLS from `PerformanceObserver`; INP is a proxy (slowest
  event-timing entry after one tap on an in-page control), not field data.
- `scripts/crawl-all.sh`: every existing crawl, in sequence, on the slot.

Contact sheets (390 px, the screens in crawl order) live in `docs/design/screens/`:

| | Before (dark only for shoppers, light only for studio) | After, light | After, dark |
|---|---|---|---|
| Shopper | `before-shopper-dark.jpg` | `after-shopper-light.jpg` | `after-shopper-dark.jpg` |
| Studio + admin | `before-studio-light.jpg` | `after-studio-light.jpg` | `after-studio-dark.jpg` |
| Desktop 1280 | `before-desktop.jpg` | `after-desktop-light.jpg` | `after-desktop-dark.jpg` |

## 1. Findings by screen (before)

Global

- **One theme per audience, hard-coded.** Shopper screens were dark-only, studio/admin light-only. Colours were
  literal (`text-white`, `bg-white/10`, `#fff` cards, `rgb(255 255 255 / .09)` glass), so a theme switch was not
  possible without touching ~1,500 class usages.
- **Every route shipped ~250 KB gz of JS** (budget 170). 80 KB of it was zod + all of its locales, pulled into
  the client by the CommonJS build of `@nyambika/contracts` (a single constant import such as `EXPERIMENTS` in the
  twin nudge was enough). Pilot survey and native bridge were in the root layout's critical path.
- No route-level `loading.tsx` anywhere; client pages showed a centred spinner (looks, try-on) or nothing.
- Emoji used as control icons (mic, keyboard, camera, menu, mute) — inconsistent rendering across Android/iOS,
  and not themable.
- Desktop (1280): the 480 px shopper column floated on flat black; nothing tied it to the aurora.
- axe at 390 (dark): 14 screens with serious/critical violations — white on terracotta avatars (3.2:1), AR badge
  (4.1:1), accessible names not matching visible text (Maker Space carousel, showroom rail, studio order cards ×121,
  Grow and Showroom piece pickers), buttons inside the 3D-shelf `listbox`, a `tel:` link with no text, unlabelled
  scrollable regions (fashion show, pilot table), `<span>` children of a `<ul>` (pilot invites), dimmed 60 % rows
  in Agents (4.2:1).

Shopper

| Screen | Issue | After |
|---|---|---|
| Muse | Emoji controls; menu sheet, twin nudge, wardrobe ambient all in the first bundle | SVG icons with press states; those three load on demand (menu prefetches on hover) |
| Menu sheet | Emoji grid; no theme control; language chips wrap into a ragged block | SVG icon grid, **Display: Auto / Light / Dark** segmented control, one scrollable language row |
| Sign in | Language chips overflowed at 360 | Wraps cleanly (with the hardening merge's country selector) |
| Looks / try-on | Centred spinner while loading | Look-shaped skeleton; the stream stays a dark "cinema" in both themes |
| Maker Space | Name ≠ visible text on product cards; 3D shelf listbox contained buttons | Names come from visible content; controls moved beside the listbox; shelf pinned to the dark stage |
| 3D twin intro | Four sentences of policy before the consent switch | Four icon fact chips + Learn more (full wording kept) |
| AR / MR pilots | Two-sentence explanations | One short line each |
| Measurements | Paragraph + tip paragraph; black wells unreadable in light | Two fact chips, ⓘ popover for the ±3 cm note; wells become soft ink tints in light |
| Wardrobe / item | Hard-coded dark fade behind the CTA | Theme-aware `fade-bottom` |
| Orders | Price truncated inside a one-line meta string | Maker · code line + its own tabular price line; skeleton rows; designed empty state |
| Circle / Custom / Bag | Three different empty-state designs (emoji, orb, text link) | One `EmptyState` (icon tile, short title, one line, one action) |
| Trust centre | Five-bullet wall; long consent descriptions | Five icon tiles (AI label, C2PA, "paid directly to the maker", encryption, voice) + Learn more; stat tiles for looks / saved / orders; 2–4 word consent sub-labels; consent titles unchanged |

Members

| Screen | Issue | After |
|---|---|---|
| Shell, sheets, dock | Light only | Warm-charcoal dark variant; Auto/Light/Dark in sidebar, More sheet and admin header |
| Home | Growth + trends charts in the first bundle | Lazy with card skeletons |
| Product detail | 3D garment card, passport editor eager | Lazy with skeletons; "live preview" card pinned dark (it shows the shopper view) |
| Share sheet | QR library eager; paragraph of instructions | QR lazy (and always dark-on-white for scanning); three chips |
| Orders | 121 cards with mismatching names | Visible text + a screen-reader "Open order CODE:" prefix |
| Admin agents / regions / network / migration | Paragraph intros | Fact chips + Learn more |
| Admin pilot | Invite list markup, scroll region not keyboard reachable | `<li>` per invite, focusable labelled region |

## 2. Design decisions (my recommendation, applied)

1. **Tokens re-point the legacy palette instead of a codemod.** `globals.css` defines semantic tokens on
   `:root` / `[data-theme]` (surface, surface-2/3, fg, fg-muted, border, accent, focus, glass, scrim, skeleton,
   elevation 1–3, gradients, 3D backdrop) mapped into Tailwind (`bg-surface`, `text-fg`, `text-fg-muted`,
   `border-border`, `text-accent`, `shadow-e1..e3`). The existing names (`ink`, `txt`, `mut`, `paper`, `cocoa`,
   `white`, `stone-*`, tint shades) are re-pointed per mode, so every existing screen follows the theme with a
   tiny, merge-friendly diff. New code should use the semantic utilities.
2. **"White" means foreground on shopper screens.** In shopper-light, `--color-white` becomes ink, so
   `text-white`, `bg-white/10` and `border-white/15` read as "foreground", "subtle tint" and "hairline" — which is
   what they meant on the dark aurora. Solid colour fills (gradient CTA, terracotta, red, photo scrims ≥ 40 %)
   restore true white for their subtree.
3. **Immersive media stays dark in both themes** (`.theme-media`): the look stream, AR/MR stages, VR showroom,
   fashion shows, the 3D shelf and the studio's shopper preview. Like a camera or a cinema, garments read truest
   on a dark stage and the overlay chrome stays legible over photos. Everything around them follows the theme.
4. **System preference by default**, user override in a cookie (`nv-theme`), applied by an 8-line inline head
   script before first paint (Next guide "preventing flash"), so pages stay statically prerendered and there is
   no flash. Theme switches cross-fade with `document.startViewTransition` (skipped with reduced motion).
5. **Studio dark = warm charcoal, not grey.** Cards lift by lightness (#1c1815 on #13100e), accents are re-inked
   (terra #f0936a, violet #c4b1ff, mint #6ee0ae) for AA on dark; inverted pills (`bg-cocoa text-white`) stay
   inverted, so active tabs and dock items keep their shape language.
6. **CTA gradient deepened** to `#c0562b → #a24a8f → #7347e0` so white labels pass 4.5:1 end to end (was 3.2:1 at
   the terracotta end). Avatars use fixed `#b4532a` (5.0:1).
7. **QR codes stay dark-on-white** in both themes inside a white frame (`.keep-white`): scanners need contrast,
   not theming.
8. **Fewer words pattern:** sentence → icon + 2–5 word label (`Fact` chip); secondary explanation → `InfoTip` (ⓘ,
   Escape/click-outside closes); legal/privacy detail → `LearnMore` (native `<details>`). Trust copy that must be
   visible stays visible but short: "AI looks labelled · C2PA", "Paid directly to the maker", "Never shared with
   makers". Accessible names used by crawls were kept.
9. **Spacing/radii/elevation:** a named 4/8-pt scale (`--space-1..8`), radii 12/16/22/28 and three elevations;
   headers are one 56 px `TopBar` anatomy (40 px round controls, centred 15 px title); sheets share one anatomy
   (grabber · optional title row with close · scrollable body capped at 92 dvh · safe-area padding · focus in and
   back · body scroll lock).
10. **Route-level view transitions were tried and dropped**: wrapping the root in React `<ViewTransition>` remounted
    client pages during hydration in dev (a filled phone field was reset). Theme switches use View Transitions;
    route changes rely on skeletons. Revisit when the Next/React integration is stable for client-heavy routes.

## 3. Loading and perceived performance

- `loading.tsx` for 21 segments, each shaped like its final layout (maker banner + identity + rail; media
  skeleton for looks; list/grid/detail for the rest; studio/admin `ScreenSkeleton`).
- `next/dynamic` (client-only) for: pilot survey, native bridge, Muse menu / twin nudge / wardrobe ambient, 3D
  capture, WebGL twin viewer, drape panel, growth + trends charts, inference panel, passport editor, 3D garment
  card, share-sheet QR. three.js, `<model-viewer>` and the VR engines were already loaded on demand.
- Native `loading="lazy" decoding="async"` on list/grid images (19 tags); hero/LCP images stay eager. `next/image`
  was not adopted: images come from the API's signed storage URLs with per-request tokens, which the Next image
  optimiser would have to proxy (cache keys per token); explicit sizes on list thumbnails prevent layout shift.
- Prefetch: Next `<Link>` prefetches in-viewport routes in production; the Muse menu chunk prefetches on hover.
- Toasts (`toast()` + `<Toaster/>`, polite live region, haptic via `lib/native.ts`) for confirmations.
- `prefers-reduced-motion` already zeroes animations globally; view transitions are disabled too.

## 4. Performance budget (before → after)

Production build, Pixel 7, 4× CPU, slow 4G, cold cache, signed-in shopper (`scripts/perf-uiux.mjs`). "Until idle"
counts every script fetched until the network is idle, including chunks deferred past hydration and the route
prefetches Next starts for visible links (the metric the before run used). "At load" is the critical JS fetched
before the `load` event, which is what the plan's budget describes.

| Route | JS until idle, before (KB gz) | JS until idle, after | JS at load, after | LCP before → after (ms) | CLS before → after | INP proxy before → after (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Muse (home) | 249.8 | 184.6 | 175.5 | 1068 → 828 | 0.059 → 0.056 | 16 → 48 |
| Looks | 277.9 | 254.8 | 237.6 | 3908 → 3180 | 0.006 → 0.014 | 32 → 16 |
| Try one look | 276.8 | 253.3 | 236.1 | 3512 → 3048 | 0.006 → 0.015 | 24 → 0 |
| Maker page | 260.8 | 228.8 | 222.9 | 1260 → 1080 | 0 → 0 | 32 → 0 |
| Bag | 250.0 | 187.9 | 170.7 | 2188 → 2276 | 0 → 0 | 40 → 0 |
| Orders | 246.8 | 184.8 | 167.6 | 2004 → 2036 | 0 → 0 | 24 → 0 |
| Wardrobe | 256.0 | 191.5 | 170.6 | 2016 → 2096 | 0 → 0 | 0 → 0 |
| Circle | 256.0 | 191.5 | 167.8 | 2012 → 2044 | 0 → 0 | 16 → 0 |
| Trust centre | 258.8 | 198.1 | 175.0 | 1048 → 2132 | 0 → 0 | 48 → 24 |
| Mirror | 264.8 | 197.6 | 170.1 | 1300 → 868 | 0.024 → 0.021 | 48 → 24 |
| Sign in | 252.0 | 219.3 | 202.1 | 1924 → 2180 | 0.015 → 0.017 | 64 → 56 |

Reading it

- **−8 % to −27 % JS until idle on every shopper route; −34 % at load on core routes.** The biggest cut is zod:
  `@nyambika/contracts` is now compiled from its ESM source for the browser (`turbopack.resolveAlias`,
  `transpilePackages`, `"sideEffects": false`), so zod tree-shakes and its locale bundles are gone (80 KB → 0 on
  routes that need only types/constants, ~27 KB of zod core where runtime helpers such as `displayPrice` or
  `normalizePhone` are used). Pilot survey, native bridge, menu, twin nudge, wardrobe ambient and checkout on the
  wardrobe load after first paint.
- **Budget (≤ 170 KB gz at load):** Orders and Circle are under it; Mirror, Wardrobe and Bag are within 1 KB; Muse and
  Trust are 5 KB over. Over budget: Sign in (202 KB: the hardening merge's country selector imports `REGIONS` and
  `signInPhone` from the contracts, which pulls zod), Maker page (223 KB: region pricing + 3D shelf), Looks/try-on
  (236–238 KB: hold-to-buy, morph, region pricing). The framework floor (React DOM 72 KB + Next runtime 47 KB +
  Turbopack runtime 4 KB) is ~125 KB, so the remaining lever is zod on commerce routes (see Known gaps).
- **CLS < 0.1 everywhere** (max 0.056: the Muse orb settling as the display font swaps in). Skeletons reserve each
  final box.
- **LCP** improved on Muse, Looks, try-on, Maker page and Mirror. Trust centre got slower (1.0 → 2.1 s) by design:
  its LCP element used to be the static promise text; now the route streams a skeleton and the largest element is
  the data card that follows. Sign in moved with the merged country selector.
- INP is a synthetic proxy (one tap) and is within noise (all < 60 ms on a 4× slowed CPU).

### 4.1 JS budget pass (sign in, Maker Space, Looks)

Branch `worktree-agent-a4245d923d09830a0`, slot 2. Before = `main` at `ec09f8d`, after = this branch, both built with
`NEXT_DIST_DIR=… next build` on the same machine and measured the same way.

How it was measured

- **First-load JS (the budget):** the gzip size of every script a route's HTML loads (`rootMainFiles` plus each
  segment's `entryJSFiles` in `page_client-reference-manifest.js`). Those are exactly the scripts Chrome fetches before
  `load` (checked per file against the network log). Async chunks (`next/dynamic`, `import()`) are not counted.
- **Module graph:** `next analyze --output` + `next analyze export --route <route>` (Turbopack's offline analyzer, JSON
  lines of modules, chunk parts and compressed sizes) to see which module pulled what into which chunk.
- **Wire:** `scripts/perf-uiux.mjs` (unchanged; Pixel 7, 4× CPU, slow 4G, cold). Its "at load" is
  `encodedDataLength`, i.e. gzip body **plus ~0.5 KB of response headers per script** (9–12 scripts per route), so it
  reads ~5 KB above the first-load JS on every route.

What pulled zod in (before)

- `@nyambika/contracts` is compiled from source for the browser with `sideEffects: false`, so unused *modules* drop
  out, but a module that is imported at all keeps its top-level `z.enum(...)` / `z.object(...)` calls. `region.ts`
  (imported for `REGIONS`, `signInPhone`, `normalizePhone`, `formatMoney`, `displayPrice`, `WALLET_LABEL`) and
  `tailor.ts` (`morphPrice`, `quantizeHue`, `MEASUREMENT_FIELDS`) therefore brought zod core + classic (25.5 KB gz) to
  sign in (`app/signin/page.tsx`), Maker Space (`lib/region.ts`, `components/region.tsx`), Looks / try-on (those plus
  `hold-to-buy.tsx`, `morph-sheet.tsx`) and ~15 other routes. `ambient.ts` did the same for order pages.
- Other weight on these routes: `@simplewebauthn/browser` on sign in (~8 KB, only needed after a tap), the whole
  look card (gesture library, rails, circle-ask, morph, 3D, video, region pricing) and hold-to-buy on Looks before the
  data had even arrived, the entire `studio.tsx` kit in every route's shared chunk (shopper screens only needed
  `<Icon>`), `@use-gesture/react` (~7 KB) for three horizontal swipes, and `"use client"` modules that are client
  references keep **all** their exports (so `region.tsx` shipped checkout + Stripe card step + order money on every
  page that only showed a price).

What changed (no visual change)

- **Contracts split (zod-free subpaths):** `src/money.ts` (currencies, integer money, FX, `displayPrice`),
  `src/region-data.ts` (EAC defaults, wallets, `normalizePhone` / `signInPhone`, ranking, zones),
  `src/tailor-data.ts` (morph pricing, measurements, size recommendation, custom-order steps) and
  `src/ambient-model.ts` (ambient order model + copy), exposed as `@nyambika/contracts/money`, `/region-data`,
  `/tailor-data`, `/ambient-model` (`package.json` `exports`; `next.config.ts` browser aliases to the sources). The zod
  schemas stay in `region.ts` / `tailor.ts` / `ambient.ts`, which `export *` the new modules, so the root export (API,
  native validator, existing imports) is unchanged; a spec (`apps/api/src/common/contracts-subpaths.spec.ts`) keeps
  the subpaths zod-free and identical to the root. Client components import the subpaths.
- **Deferred until needed:** look card + hold-to-buy + twin nudge on Looks / try-on (`next/dynamic`, `ssr: false`,
  same skeleton as the loading state; their chunks are requested in parallel with the session / try-on fetch), the
  WebAuthn library (loaded in parallel with the passkey options request), the Maker Space product sheet, checkout
  (`components/region-buy.tsx`), 3D section / viewer, region sheet (`components/region-sheet.tsx`), WhatsApp opt-in
  and tailor services (`components/maker-lazy.tsx`, both render nothing until their request answers), ask-a-tailor
  sheet, and push code (sign-out only).
- **Smaller shared modules:** `components/icons.tsx` (icon set), `components/skeletons.tsx` (studio skeletons,
  server-rendered from `loading.tsx` with no client JS), `components/button.tsx`, `components/region-pay.tsx` (wallet
  entry, order money); `studio.tsx`, `ui.tsx` and `region.tsx` re-export them so every existing import still works.
- **`lib/drag.ts`:** a 0.5 KB `useDrag` with the slice of the use-gesture API the app uses (x-axis lock, tap filter,
  movement on release, pointer-cancel = page scroll) replaces `@use-gesture/react` on the coverflow, 3D shelf and look
  card. (`@use-gesture/react` is still in `package.json`, now unused; drop it in a lockfile-owning change.)
- Checked and not worth it: date libraries (none; `Intl` / `toLocaleDateString`), icon fonts (none; inline SVG),
  duplicated code (none found by the analyzer beyond the `studio.tsx` copy in admin loading, now fixed).

First-load JS per route (KB gz, `next build`)

| Route | Before | After | Δ |
|---|---:|---:|---:|
| **Sign in** `/signin` | 202.6 | **168.3** | −34.3 |
| **Maker Space** `/m/[handle]` | 222.3 | **169.5** | −52.8 |
| **Looks** `/looks/[sessionId]` | 236.1 | **164.4** | −71.7 |
| **Try one look** `/looks/try` | 234.7 | **163.3** | −71.4 |
| Muse (home) `/` | 176.5 | 171.1 | −5.4 |
| Bag / Orders / Wardrobe / Circle | 171.7 / 168.6 / 171.6 / 168.8 | 166.3 / 163.2 / 166.2 / 163.4 | −5.4 each |
| Makers `/makers` | 202.3 | 163.8 | −38.5 |
| Order `/orders/[id]` · Circle poll `/circle/[id]` | 209.0 · 211.0 | 172.3 · 175.1 | −36.7 · −35.9 |
| Measurements · Trust · Mirror | 196.8 · 176.0 · 171.1 | 165.3 · 169.1 · 165.7 | −31.5 · −6.9 · −5.4 |
| Showroom · Fashion show (`/m/[handle]/…`) | 222.0 · 214.2 | 211.9 · 204.5 | −10.1 · −9.7 |
| Studio routes (20) · Admin routes (5) | 172.9–206.9 · 173.4–200.8 | 172.6–180.5 · 172.4–175.2 | −0.1 to −27.4 |

Every one of the 57 routes is smaller or equal except Next's own `/_global-error` (+0.3, a framework chunk). The
framework floor (React DOM + Next runtime + Turbopack runtime) is 128.5 KB; the app's shared layout is now 31.7 KB
(was 37.2), so a route has ~10 KB of its own before it reaches 170.

Wire, `scripts/perf-uiux.mjs` (KB incl. response headers; before → after)

| Route | JS at load | JS until idle | LCP (ms) | CLS | INP proxy (ms) |
|---|---:|---:|---:|---:|---:|
| Sign in | 208 → 173.2 | 225.2 → 191.5 | 2260 → 1996 | 0.017 → 0.017 | 32 → 40 |
| Maker page | 234.7 → 174.5 | 234.7 → 193 | 1120 → 1116 | 0 → 0 | 16 → 0 |
| Looks | 243.7 → 169.4 | 260.9 → 222.3 | 3264 → 2976 | 0.006 → 0.005 | 32 → 40 |
| Try one look | 242.3 → 168.2 | 259.5 → 220.4 | 3312 → 2796 | 0.006 → 0.006 | 0 → 0 |
| Muse (home) | 181.4 → 176 | 190.4 → 186 | 880 → 872 | 0.056 → 0.041 | 32 → 40 |
| Bag | 176.6 → 171.2 | 193.8 → 189.4 | 2324 → 2280 | 0 → 0 | 0 → 0 |
| Orders | 173.5 → 168.1 | 190.7 → 186.3 | 2100 → 2088 | 0 → 0 | 0 → 16 |
| Wardrobe | 176.5 → 171.1 | 197.4 → 193 | 3144 → 2128 | 0 → 0 | 16 → 0 |
| Circle | 173.7 → 168.3 | 197.4 → 193 | 2088 → 2072 | 0 → 0 | 0 → 0 |
| Trust centre | 180.9 → 174 | 204.1 → 201.9 | 2208 → 2180 | 0 → 0 | 32 → 32 |
| Mirror | 176 → 170.6 | 203.5 → 199.2 | 876 → 884 | 0.021 → 0.021 | 24 → 40 |

Reading it: the budget (≤ 170 KB gz first-load JS) is now met on sign in, Maker Space and Looks / try-on, and on
every other shopper route except Muse (171.1). On the wire meter, which adds headers, Looks / try-on are under 170
and sign in / Maker Space are 3–5 KB above it. LCP improved on Looks (−0.3 s) and try-on (−0.5 s) because the look
card's code now downloads alongside the session fetch instead of ahead of it; it is flat elsewhere (INP and CLS are
within noise). The earlier §4 table came from a different build (before the hardening merge), so compare these two
tables with each other, not with that one.

Next levers (not done here)

- **i18n catalogues: 13 KB gz of the shared chunk.** All four locales ship on every route. Loading only `en` (the
  fallback) plus the active locale would save ~8 KB everywhere, but it means splitting `packages/i18n/src/index.ts`
  into per-locale files, which every feature branch appends keys to, so it should be its own change once the parallel
  copy pass has merged.
- VR showroom / fashion show (205–212 KB) still pull zod through `vr.ts` / `presence.ts` (same split would apply);
  they also need three.js for the scene anyway.

#### JS budget pass 2 (after the iOS pass)

Branch `worktree-agent-a51f6cc1264b6d420`, slot 1. Before = `main` at `a111c77`, after = this branch. Both were built
with `NEXT_DIST_DIR=.next-build next build` and measured with `scripts/perf-uiux.mjs` on the same machine in the same
session. "Wire at load" is the budget metric (gzip body plus response headers, before `load`). "Build" is the
first-load JS from the build manifests (`rootMainFiles` plus every segment's `entryJSFiles`).

| Route | Wire at load, before | Wire at load, after | Build first-load, before | Build first-load, after |
|---|---:|---:|---:|---:|
| **Sign in** | 173.0 | **163.1** (−9.9) | 167.6 | **157.9** (−9.7) |
| **Maker Space** | 173.8 | **163.9** (−9.9) | 168.0 | **158.4** (−9.6) |
| **Looks** | 171.9 | **159.0** (−12.9) | 166.4 | **154.2** (−12.2) |
| Try one look | 170.5 | 157.6 (−12.9) | 165.1 | 152.9 (−12.2) |
| Muse (home) | 175.9 | 166.0 (−9.9) | 170.2 | 160.5 (−9.7) |
| Trust centre | 175.3 | 165.6 (−9.7) | 169.8 | 160.3 (−9.5) |
| Bag · Orders | 170.5 · 167.3 | 161.7 · 157.5 | 165.5 · 162.3 | 157.0 · 152.7 |
| Wardrobe · Circle · Mirror | 171.0 · 167.7 · 169.9 | 161.1 · 157.7 · 161.0 | 165.6 · 162.7 · 164.9 | 155.9 · 152.9 · 156.3 |
| Studio routes (20) · Admin (5) | – | – | 173.6–183.8 · 174.4–179.3 | 165.0–175.3 · 165.9–170.9 |

Every shopper route is now under 170 on both meters, Muse and Trust included. The app's shared layout chunk went
from 27.1 to 17.5 KB gz. LCP, CLS and the INP proxy did not change beyond noise (Looks LCP 2760 → 2656 ms, sign in
1832 → 1752 ms). JS until idle fell by 4 to 24 KB, because the Looks gesture extras and the three other catalogues
are now fetched only when needed.

What changed (no visual or behaviour change)

- **One i18n file per locale.** `packages/i18n/src/{en,rw,fr,sw}.ts`. `index.ts` keeps `Locale`, `LOCALES`,
  `MessageKey`, `translate()` (still synchronous), `catalogues` and `SW_MACHINE_DRAFTED`. It adds `loadLocale()`
  (idempotent dynamic import) and `isLocaleLoaded()`. English is always bundled because it is the key source and
  the fallback, so the catalogue in the shared chunk fell from 13.8 to 5.9 KB gz.
  - `SessionProvider` starts loading a stored locale while the module evaluates, before hydration.
  - On a switch it changes `locale` only after the catalogue arrives, so text, the active chip and `<html lang>` change
    together, with no English flash.
  - **Merge note for feature branches:** new keys go into `en.ts`, then at the end of `rw.ts` / `fr.ts` (and `sw.ts`).
- **Looks gesture extras in a post-load chunk.** The coach mark / swipe peek, the rail's long-press bubble and the
  double-tap heart burst moved to `components/look-extras.tsx`. look-view and look-rail load it with `next/dynamic` /
  `import()` and prefetch it on idle once the card is up, so the first gesture finds it ready. The heart markup stays in
  the DOM, so only the animation code moved.
- **Duplicate removed.** `look-rail.tsx` shipped twice on Looks and try-on (1.6 KB): once as the `loading.tsx` client
  reference, with all its exports, and once in the page. `LooksSkeleton` and the material tokens now live in
  `components/look-material.tsx` with no `"use client"`. The loading state renders on the server with no client JS.
  After this, no module ships in two first-load chunks of any route (checked per route over the build's chunks).
- **Kit split.** `components/toast.tsx` (toasts, the only part the root layout needs) and `components/kit-static.tsx`
  (Skel, ShopperSkeleton, LearnMore, Fact; hook-free). `kit.tsx` / `ui.tsx` re-export both, so imports are unchanged.
  All 15 `loading.tsx` files and the Maker Space server page import the static half, so they ship no kit JS.
- **`"sideEffects": ["*.css"]` in `apps/web/package.json`.** Unused re-exports (`ui.tsx` → kit) now drop out of route
  chunks, saving 1.0–1.4 KB on most shopper routes. No app module is imported for its side effects only, apart from
  `globals.css`. `server-only` is a package with its own flag.
- **Icons checked, left as is.** The core set has 73 glyphs (2.9 KB gz). Sign in, Muse, Looks, Maker Space, bag,
  orders, wardrobe, circle, trust, mirror, makers, saved and measurements draw 37 of them at load. The other 36 are
  drawn at load by the studio/admin chrome (dock, nav, theme toggle) or by states on the core routes: the Looks
  occasion chip (store/gift/crown/bell), sheet close `x` and error `alert`. Moving them would make those pop in for
  about 0.7 KB, so they stay core.

Verification

- **Typechecks:** `apps/web`, `apps/api` and `packages/i18n` are clean.
- **Tests:** web unit tests 19/19, including the new `lib/i18n-lazy.test.ts`; API 33 files, 383 tests.
- **Crawls:**
  - s1–s5 green on the production build.
  - harden-commerce and region green on `next dev`, because their simulated wallet prompt is dev-only.
  - crawl-uiux green on the 26 touched screens, light and dark, 390 px plus the 360 overflow pass: 0 console errors,
    0 overflow, 0 theme flashes and 0 serious/critical axe violations (label `perf2`).
- **Behaviour (scripted, production build):** these all work, with no console errors:
  - RW / FR switch, and the stored locale restored on reload;
  - coach mark on the first visit;
  - long-press bubble;
  - double-tap heart, which also saves the look;
  - drag peek.

## 5. Accessibility

`@axe-core/playwright` 4.14.0, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, all 49 screens at 390 px,
`<canvas>` excluded (WebGL/QR pixels are not text).

| | Screens with serious/critical violations | Notes |
|---|---:|---|
| Before, dark (shopper) / light (studio) | 14 of 49 | colour contrast ×4 screens, name ≠ visible text ×5, ARIA children ×1, link name ×1, scrollable region ×2, list markup ×1 |
| After, light | **0 of 49** | |
| After, dark | **0 of 49** | |

What changed to get there: AA-safe CTA gradient and avatar fill; accessible names come from visible content (or a
visible-text-first `sr-only` prefix) for carousel options, piece pickers and order cards; the 3D shelf's buttons
moved out of its `listbox`; scrollable regions are focusable and labelled; invites are `<li>`; dimmed rows use a
fill instead of 60 % opacity; studio-dark re-inks every tint (`emerald/amber/sky/red/violet/rose/teal/fuchsia/
orange/stone` 50–300 and 700–950) and keeps white type only on true colour fills; shopper-light maps light text
tints written for the dark canvas to their deep counterparts. Focus rings are tokens (gold on the dark aurora,
violet on light and on studio), 2.5 px with 2 px offset.

Beyond axe: every control keeps an accessible name (icon-only buttons have `aria-label`, the theme toggle is a
labelled group of `aria-pressed` buttons, ⓘ tips are `aria-expanded` buttons with `role="note"` popovers), sheets
move focus in and back and lock page scroll, `prefers-reduced-motion` disables motion and view transitions.

## 6. Known gaps

- ~~JS budget not met on commerce routes~~ **Resolved by the JS budget pass (§4.1):** sign in 168.3, Maker Space
  169.5, Looks 164.4 KB gz first-load JS. Original note: move the contracts' pure money/phone/region helpers (`REGIONS`, `displayPrice`, `normalizePhone`,
  `formatMoney`, `signInPhone`, `morphPrice`) into a zod-free module that `index.ts` re-exports, so the browser
  never evaluates zod schemas; and split hold-to-buy so the sheet body loads on first press. I did not restructure
  `packages/contracts` while the commerce/platform hardening branches were editing it.
- **Route view transitions** are off (see decision 10); only theme switches cross-fade.
- **`next/image` not adopted** (signed, per-request storage URLs); thumbnails use explicit sizes + native lazy loading.
  No blur placeholders: the API does not expose a low-res preview; skeleton tiles fill the box instead.
- **Field data**: LCP/CLS/INP are lab numbers from Playwright on one machine with throttling; INP is a one-tap proxy.
  `web-vitals` field reporting (RUM) is not wired.
- ~~**Not every screen was rewritten for "fewer words"**~~ (done screen by screen in §7): done for trust centre, 3D twin, measurements, AR/MR pilots,
  share sheet, empty states and admin intros. Hold-to-buy, sign-in and region screens were kept as merged from the
  hardening branches apart from the pinned hold ring (visual only). Studio forms (product editor, settings) keep
  their helper text; it is short and task-relevant.
- ~~**Emoji** remain as expressive content~~ **Resolved by the copy & iOS pass (§7):** no emoji anywhere in the UI; a unit test and the crawl enforce it.
- **Studio dark** is token-driven; one-off hard-coded light gradients inside a few spike components (drape heatmap
  legend, studio-3d preview tiles) read fine but are not re-tuned for dark.
- Crawl robustness fixes in older crawls (s1, s2, e05, xr, tailor, growth, social, pilot, region) were needed because
  the E35 3D shelf added a second `listbox` with a selected `option` on Maker Space and because slot databases are
  reused between runs; `crawl-infer` needs its own gateway with the fake inference pool (documented in the crawl).

## 7. Copy & alignment pass, no emoji, iOS design language (Nov 2026)

The user asked for this, in their words: "do not use more words, summarize texts, and let interactive elements work, and work on proper alignment, spacing".
They later added: "remove all available emojis … use modern icons … iphone ios style … make the UI style refer to modern IOS
design" and asked for "the image [on Looks] should be full screen … tools continue to look floating over". This was a UI-only
change: no API or schema changes. Branch `worktree-agent-af84dce4929f1829b` (slot 1). The work was split by area (shopper
discover, shopper personal, studio core, studio craft, admin, Looks) on top of shared primitives landed first.

### How it was measured

`scripts/crawl-uiux.mjs` gained per-screen metrics at 390 px (written to `metrics.json`) and a hard emoji check:

- **Visible words:** `innerText` word count.
- **Paragraphs taller than 2 lines:** text blocks with ≥ 40 characters of their own text, counting content lines and
  not padding. Closed `<details>` and `[data-allow-prose]` are excluded.
- **Tap targets under 44 px:** a control's box, its wrapping `<label>`, or a `.hit` ::after expansion. Inline text
  links are exempt, as in WCAG. `STRICT_TARGETS=1` makes these failures.
- **Emoji:** rendered text, `aria-label`, `title`, `placeholder` and `alt` containing `\p{Extended_Pictographic}`, U+FE0F or
  regional-indicator flags fail the crawl. © ® ™ are allowed.

`apps/web/lib/no-emoji.test.ts` runs the same check over the source of `apps/web/{app,components,lib}` and
`packages/i18n`. A counting note: three metric refinements landed after the "before" run (padding is not counted as
lines, closed `<details>` are ignored, and a label's `.hit` counts). These make a few "before" paragraph and target
counts slightly high. The large changes below do not depend on them.

Contact sheets (390 px viewport, crawl order; desktop 1280) are in `docs/design/screens/`:
`copy-before-{shopper,studio,desktop}-{light,dark}.jpg` and `copy-after-{shopper,studio,desktop}-{light,dark}.jpg`.

### Result per screen (light, 390 px; dark identical in structure)

| Screen | Words (light 390) | Paragraphs > 2 lines | Tap targets < 44 px | Emoji (after) |
|---|---:|---:|---:|---:|
| muse-signed-out | 13 → 13 | 0 → 0 | 1 → 0 | 0 |
| signin | 39 → 43 | 0 → 0 | 6 → 0 | 0 |
| muse | 13 → 13 | 0 → 0 | 3 → 0 | 0 |
| muse-menu | 46 → 49 | 0 → 0 | 10 → 0 | 0 |
| muse-typing | 20 → 20 | 0 → 0 | 4 → 0 | 0 |
| looks | 336 → 186 | 0 → 0 | 68 → 0 | 0 |
| look-try | 32 → 15 | 0 → 0 | 10 → 0 | 0 |
| maker-space | 175 → 151 | 2 → 1 | 2 → 0 | 0 |
| maker-showroom | 73 → 75 | 0 → 0 | 1 → 0 | 0 |
| maker-show | 103 → 95 | 0 → 0 | 0 → 0 | 0 |
| makers | 418 → 379 | 0 → 0 | 6 → 0 | 0 |
| passport | 198 → 195 | 3 → 1 | 2 → 0 | 0 |
| mirror | 37 → 29 | 0 → 0 | 3 → 0 | 0 |
| mirror-3d | 44 → 31 | 2 → 0 | 2 → 0 | 0 |
| mirror-ar | 32 → 23 | 0 → 0 | 2 → 0 | 0 |
| mirror-mr | 25 → 17 | 0 → 0 | 1 → 0 | 0 |
| measurements | 68 → 59 | 0 → 0 | 4 → 0 | 0 |
| wardrobe | 49 → 39 | 0 → 0 | 10 → 0 | 0 |
| wardrobe-item | 40 → 28 | 0 → 0 | 1 → 0 | 0 |
| circle | 17 → 17 | 0 → 0 | 1 → 0 | 0 |
| bag | 21 → 13 | 0 → 0 | 1 → 0 | 0 |
| orders | 43 → 76 | 0 → 0 | 1 → 0 | 0 |
| order | 130 → 123 | 1 → 0 | 2 → 0 | 0 |
| saved | 18 → 18 | 0 → 0 | 1 → 0 | 0 |
| custom | 15 → 15 | 0 → 0 | 1 → 0 | 0 |
| trust | 201 → 162 | 1 → 0 | 3 → 0 | 0 |
| join | 44 → 19 | 1 → 0 | 1 → 0 | 0 |
| studio-pages | 18 → 18 | 0 → 0 | 0 → 0 | 0 |
| studio-home | 262 → 247 | 3 → 0 | 5 → 0 | 0 |
| studio-products | 146 → 194 | 0 → 0 | 5 → 0 | 0 |
| studio-product-new | 172 → 117 | 0 → 0 | 23 → 0 | 0 |
| studio-product | 340 → 182 | 5 → 0 | 8 → 0 | 0 |
| studio-orders | 2372 → 2448 | 0 → 0 | 5 → 0 | 0 |
| studio-tailor | 282 → 327 | 0 → 0 | 4 → 0 | 0 |
| studio-tailor-order | 252 → 98 | 0 → 0 | 1 → 0 | 0 |
| studio-tailor-services | 62 → 59 | 0 → 0 | 0 → 0 | 0 |
| studio-tailor-slots | 265 → 130 | 0 → 0 | 0 → 0 | 0 |
| studio-grow | 149 → 193 | 1 → 0 | 9 → 0 | 0 |
| studio-showroom | 224 → 320 | 1 → 0 | 0 → 0 | 0 |
| studio-settings | 284 → 191 | 2 → 0 | 11 → 0 | 0 |
| studio-share-sheet | 289 → 274 | 3 → 0 | 6 → 0 | 0 |
| coop-makers | 192 → 158 | 0 → 0 | 0 → 0 | 0 |
| coop-easy | 25 → 25 | 0 → 0 | 1 → 0 | 0 |
| admin | 105 → 100 | 0 → 0 | 13 → 0 | 0 |
| admin-migration | 10142 → 8173 | 198 → 0 | 297 → 0 | 0 |
| admin-agents | 2564 → 2653 | 1 → 0 | 25 → 0 | 0 |
| admin-network | 341 → 302 | 1 → 0 | 18 → 0 | 0 |
| admin-pilot | 2702 → 2842 | 5 → 0 | 401 → 0 | 0 |
| admin-regions | 329 → 285 | 2 → 0 | 20 → 0 | 0 |
| **Total** | 23767 → 21239 | 232 → 2 | 999 → 0 | |

Words went **up** on six screens:

- studio-products and studio-grow now show each piece's colour name and swatch, so identical "Umushanana" cards can
  be told apart.
- studio-tailor, studio-showroom, orders and admin-pilot/agents contain data that grew between runs: crawls add
  orders, shows, calls and invites on the reused slot database.

On data screens (orders, migration, agents, pilot) the word count is mostly data. The two paragraphs left are maker
content: the Maker Space service description and the passport's origin line.

### What became interactive (per area)

| Area | Before (prose / decorative) | After (interaction) |
|---|---|---|
| Studio → Grow → Share kit | 3-line paragraph under "Make my card"; three identical truncated "Umushanana …" picker cards | Chips **Price · QR · Try it on you**, with the analytics hint in an ⓘ InfoTip. Picker cards are 128 px with a 2-line title, colour swatches + colour name, and **No. n** on same-title pieces. Tagged-links, offers and broadcast-limit prose became chips + ⓘ. Broadcast templates are 44 px chips. Suggestions clamp to 2 lines with an animated More/Less. |
| Looks stream | Letterboxed render in a dark frame, "Look 1/9", "swipe for Maker Space · hold to buy" and "↑ swipe up" sentences, 64 px rail with captions | **Full-bleed** render under the status bar, shifted so the head clears the bar. One top line: back · capsule "Wedding · Sat · 1/9" · "AI · C2PA" chip (always visible). 44 px glass rail with a 12 px gap on the 16 px gutter, label on long-press. Glass maker sheet covers the gateway's baked AI tag. Snap paging with parallax, **double-tap heart**, press-scale + haptics. **Hold-to-buy progress pill**. Swipe-left to Maker Space with a live peek; a one-time coach mark replaces every sentence. |
| Muse menu, trust centre, notifications, studio settings, admin flags / pilot | Chip walls, bullet lists, paragraphs | **iOS inset grouped lists** (`Group`/`GroupRow`): coloured icon tiles, value, chevron or switch accessory, hairline separators, footers of one line. |
| Secondary actions (order cards, product archive, staff, tailor order, showroom shows, agent clients, migration roll-back, network outreach, coop makers) | Rows of 3–5 inline buttons | One primary button + **`MoreActions` → iOS action sheet** (destructive in red). |
| Numbers (lead time, slot length, ready-in days) | Selects / free inputs | **Stepper** (− value +, spinbutton semantics, spring count, haptic). |
| Lists (tailor slots, agent keys) | Inline delete buttons only | **Swipe left to reveal** Remove / Revoke (`lib/drag.ts`, spring snap, haptic). The visible button stays for keyboard and mouse. |
| Circle + fashion-show + shared-room reactions | Emoji buttons, emoji counters, emoji 3D sprites | **Animated SF icon buttons** (spring pop, `aria-pressed`, names "React: Love", "React: Fire"). Counts read "Fire 3". The 3D room draws icon sprites (Path2D on a glass disc). Wire values are unchanged (`lib/social.ts`, `lib/vr-reactions.ts`). |
| Field hints (studio forms) | 1–3 line helper text under inputs | Hints over 28 characters become an ⓘ beside the label (the `<label>` still wraps only the control); short hints stay inline. |
| Consent / legal wording | Long switch descriptions | Short switch label; the exact wording is unchanged behind LearnMore / ⓘ next to it. |
| Limit states, checkout, wallets, region pill | Emoji icons (sunrise, lock, phone, flags, coloured circles) | SF glyphs in a tinted disc; brand-colour dots for MTN / Airtel / M-Pesa; country code instead of flags. |

### Interactive elements that work

- Every chip, tab, toggle and popover now has a real action, keyboard focus and an accessible name.
- The shopper `Chip` renders a plain `<span>` when it has no action, so it is never a decorative button.
- `.hit` (globals.css, utilities layer) grows any control's hit area to ≥ 44×44 px without changing layout.
- These are ≥ 44 px: Segmented, ThemeToggle, InfoTip, LearnMore, TopBar, Switch rows, inputs, TogglePills,
  AdminShell tabs, RegionPill, and every fork's controls.
- Result: **999 → 0** tap targets under 44 px across the 49 screens. 0 serious/critical axe violations in both themes.

### Alignment and spacing

- **One spacing scale:** Tailwind's 4-pt steps plus `--space-*`. Card padding is `p-4`; studio sections use `space-y-5`.
- **Studio main area** pads for the dock and the safe area: `pb-[calc(env(safe-area-inset-bottom)+124px)]`.
- **Dock and bars never cover content:**
  - The unsaved-settings bar clears the dock.
  - The Maker Space Follow/Chat bar no longer covers the "1/13" control or the 3D-shelf heading.
  - KPI values wrap and scale instead of clipping. Studio home revenue shows compact "RWF 4.51M" with the full amount in a title.
- **Titles on one rhythm:**
  - Studio `SectionTitle` h1 is an iOS large title (28/34 px bold, -0.02em). Once it scrolls under the material
    header, the header shows it in compact form.
  - Shopper `TopBar large` does the same.
- **Looks:** back, rail and Buy share the 16 px gutters.
- **Desktop:** the showroom rail no longer spills out of its card (`Field group` is `min-w-0`).

### iOS design language (my recommendations, applied)

1. **One icon set, no dependency:**
   - The existing SVG `Icon` (moved to `components/icons.tsx` by the JS budget pass) is redrawn SF Symbols-like:
     rounded caps and joins, **1.75 px** stroke, `filled` ".fill" variants.
   - 45 new glyphs replace every emoji (play, pause, phone, bell, chat, calendar, pin, key, hand, headset, dress,
     trash, fire, star, clap, crown, sunrise, signal, moto, …).
   - lucide-react was not adopted: it adds a second system and bytes on the 170 KB core routes.
2. **Typography:**
   - UI text uses the system SF stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", Inter, "Segoe UI", Roboto…`),
     with SF Pro Display for titles. Plus Jakarta is no longer downloaded.
   - Nunito stays as `font-brand`, for the wordmark and the Muse hero only.
3. **Materials:** `.material` is blur 24 px + saturate 1.8 over a token surface, with a hairline edge. It is used on the
   studio and admin headers, collapsed TopBars, action sheets and the Looks chrome (fork-local material). Studio
   dark gets a dark material.
4. **Springs without a library:** `--spring` and `--spring-bouncy` are CSS `linear()` curves. They drive `.spring`
   (segmented thumb, switch knob, sheet snap-back) and `.spring-pop` (reaction pops, stepper count, crown, heart).
   All of it is off under `prefers-reduced-motion`.
5. **Controls:**
   - Switch: 51×31 track, 27 px knob on a spring, `--ios-green`, haptic tick. Shopper screens use the same geometry
     in `components/shopper-switch.tsx`.
   - Segmented: one sliding thumb measured from the DOM.
   - Stepper and ActionSheet: described in the table above.
6. **Sheets:**
   - Grabber + title row are a drag handle (`lib/sheet-drag.ts`). Drag down to dismiss (past 96 px or a flick);
     otherwise the sheet springs back.
   - `Sheet detent="medium"` opens at about 56 dvh and a drag up of 56 px expands it to the large detent.
   - Focus trap, Escape, scroll lock and safe-area padding are unchanged.
7. **Module boundaries for the JS budget:**
   - The iOS components live in `components/ios.tsx`. They are imported only by on-demand sheets, studio, admin,
     makers and showroom; not by sign in, Maker Space or Looks.
   - `lib/sheet-drag.ts` is about 0.6 KB.
   - `kit.tsx`, which the root layout loads, did not grow.
8. **Destructive red** is `#d70015` in light and `#ff6961` in dark (iOS system red, AA on both surfaces).

### Interaction and motion inventory

- Press-scale on every control (`press` / `st-press`).
- Spring thumbs and knobs.
- Pops on reactions, stepper counts, the double-tap heart and the poll crown.
- Swipe actions on slots and keys; swipe-to-Maker-Space on Looks.
- Long-press labels on the Looks rail.
- Drag-to-dismiss sheets.
- Haptics through `lib/native.ts` (`haptic`) on toggles, segment changes, steppers, sheet actions, rail buttons,
  hold-to-buy ticks and swipe commits.
- All motion respects `prefers-reduced-motion`; haptics are skipped under it except for success/error.

### i18n

Changed strings were shortened in RW, EN and FR together. Swahili falls back to English, apart from the one existing
override, which was shortened. Examples:

- `push.denied` → "Notifications off · WhatsApp still works"
- `push.none`, `push.unsupported`, `push.circleBody`, `push.askBody`, `bag.emptyBody`, `bag.splitNote`, `passkey.otpFallback`
- `err.consent.tryon`

✨/✓/🌙 were removed from every locale.

### Crawls updated (names followed, not weakened)

- **voice:** `/audio (is )?never stored/`; send and buy names without emoji.
- **social:** "No votes yet", "React: Yes".
- **s5:** consent copy "paused|off".
- **mig:** "Imported: handle".
- **studio-ui and growth:** exact "More" (the expandable suggestion cards contain "More").
- **growth:** opt-in line "reply STOP anytime".
- **agentic:** `/nothing is (ordered or )?paid/`.
- **harden-commerce:** `/^Buy$/`.
- **tailor:** `/recommended/`, `/your measurements ·/`.
- **mlspike:** fairness copy.
- **vr / mrvr:** "React: Fire", "Fire 1", "reacted: Fire".
- **s3:** occasion chip `/office|any occasion/` (emoji dropped from its name).
- **growth:** Rehearse cadence via the "More outreach actions" sheet.
- **mrvr:** `/a moderator will look/`, first privacy note.

### Bugs found on the way

- **Swipe-to-Maker-Space hijack.** React portals bubble synthetic events through the component tree. Dragging
  the colour ring inside the portalled morph sheet therefore also drove the Looks swipe, which navigated to the
  Maker Space mid-drag (caught by crawl-tailor). `look-view` now swipes only on real DOM descendants.
- **Header contrast in dark.** The studio and admin material headers fell back to a light surface in dark mode.
  The `.material` override now uses `--surface-2`.

### JS budget (core routes)

Measured with a production build (`NEXT_DIST_DIR=.next-build next build && next start`) and `scripts/perf-uiux.mjs`
(Pixel 7, 4× CPU, slow 4G, cold, signed-in shopper). Values are JS at the load event, in KB gz including response
headers. The main column is the same commit as `main` (460d0b9), built and measured **on the same machine in the
same session**. It does not match §4.1's 168.3 / 169.5 / 164.4, which were measured in another session.

| Route | main, same machine | this branch, first build | this branch, final |
|---|---:|---:|---:|
| Sign in | 171.4 | 174.1 | **173.0** (+1.6) |
| Maker Space | 172.6 | 174.6 | **173.8** (+1.2) |
| Looks | 167.5 | 173.6 | **171.9** (+4.4) |
| Try one look | 166.4 | 176.8 | **170.5** (+4.1) |
| Muse | 174.1 | 176.8 | 175.9 |

What moved, and what was cut:

- **New critical bytes:**
  - The icon set grew 2.2 KB gz (45 glyphs).
  - Sheet drag and large-title code added about 0.9 KB.
  - The full-bleed Looks stream (gestures, rail, coach mark, hold pill) grew look-view's chunk from 3.1 to 7.9 KB.
- **Cuts made:**
  - **Icon split.** 32 glyphs that no core route draws at load moved to `components/icons-extra.ts`.
    `<LazyIcon>` draws a same-size empty svg until they arrive, and `DeferredGlobals` prefetches them after
    `load`.
  - **LimitState on demand.** It now loads only when an error renders: in the root `ErrorToaster`, `ErrorNote`,
    growth offer and the Looks pages. It used to sit in every route's first-load JS through the error toaster.
  - **Icon imports.** `Icon` is now imported from `icons.tsx` instead of the studio kit. This cut 11 KB from
    "until idle" on Looks.
  - The i18n catalogue shrank 0.8 KB with the shorter strings.
- **Gap:**
  - The coordinator's "≤ 170 KB at load" is **not met on this machine** for sign in, Maker Space and Looks.
  - Main itself measures 171.4 / 172.6 here, so the remaining real regression versus main is +1.2 to +1.6 KB on
    sign in and Maker Space, and +4.4 KB on Looks.
  - Next step: split the Looks chrome (coach mark, swipe peek, long-press bubble, double-tap heart) into a
    post-load chunk, and load the sheet drag handler on the first pointerdown.
  - I stopped there rather than restructure fork L's component late in the pass.
  - **Closed by JS budget pass 2 (§4.1):** sign in 163.1, Maker Space 163.9 and Looks 159.0 KB at load.

### Verification

- **Typechecks:** `apps/web` and `apps/api` `tsc --noEmit` are clean.
- **Tests:**
  - Web unit tests: 16/16, including `no-emoji.test.ts`.
  - API: 33 files, 383 tests green.
- **crawl-uiux:** 49 screens × light/dark × 390/1280, with a 360 overflow pass. 0 console errors, 0 5xx,
  0 overflow, 0 theme flashes, 0 serious/critical axe violations and 0 emoji in both themes. Final run: label
  `final`.
- **Every other crawl on slot 1** (all except `crawl-infer`, which needs its own gateway with the fake pool):
  all 25 green (23 on the first final run; crawl-growth after its broadcast assertion followed the shorter toast;
  crawl-sweep after a transient proxy 500 and a pre-existing 3D-shelf countdown hydration race, fixed with
  `suppressHydrationWarning` on that ticking text).
- **mlspike** depends on database state: each run permanently withdraws a uniquely titled shared piece. After
  many reruns it needs a fresh copy of the slot DB, `createdb -T nyambika_tpl`.
- **Screenshot review:** light, dark and desktop contact sheets for every screen. Looks was checked at 360, 390
  and 430 in both themes.

## 8. Polish pass: wrapping, alignment, light surfaces (Nov 2026)

The user asked, in their words: "For some texts, they wrap themselves and make it not professionally aligned … go
through the whole app and enhance proper alignment and spacing … do not use much border style because they look more
solid, while i need it to be light and professional." UI only, no API or schema changes. Branch
`worktree-agent-ae727930387ee6321` (slot 1, label `polish`).

### How it was measured

`scripts/crawl-uiux.mjs` gained two per-screen metrics (in `metrics.json`, written after every screen so an interrupted
run keeps them) and one new failure:

- **Wraps (fails the crawl, at 360 and 390 px, both themes).** An element that should sit on one line but whose text
  breaks over two or more line boxes (`Range.getClientRects()`). It checks pill-shaped filled controls and chips (radius
  about half the height), tabs and options, `.tabular` / `tabular-nums` numbers, `[data-nowrap]`, and buttons or links of
  up to three words. Stacked title + subtitle buttons are skipped because only one-run text counts.
  `[data-allow-wrap]` opts a subtree out, and `WRAP=warn` reports wraps without failing.
- **Outlines (reported).** Visible boxes with a border on all four sides or a ring (`0 0 0 Npx` shadow, N ≥ 1) in a
  non-transparent colour. One-sided separators and 0.5 px hairlines don't count. Media stages (`.theme-media`) are
  excluded.
- **`LOCALE=rw|fr|sw`** renders every screen in that locale, as a stored choice. The Muse typing action now matches the
  RW/FR/SW button names.

| | Before (light / dark) | After (light / dark) |
|---|---:|---:|
| Outlines, 49 screens at 390 px | 683 / 911 | **19 / 19** |
| One-line elements that wrap, 390 px | 14 / 14 | **0 / 0** |
| One-line elements that wrap, 360 px | 33 / 33 | **0 / 0** |
| RW locale, light, 390 + 360 | 3 | **0** |

The 19 outlines left are deliberate:

- selected states: `ring-2` on the chosen piece, plan, staff role or picker;
- colour swatches, which need an edge so white and cream read on white;
- dashed drop zones for upload;
- the maker monogram ring on Maker Space.

Contact sheets: `docs/design/screens/polish-{before,after}-{shopper,studio,desktop}-{light,dark}.jpg`. Phone sheets are
390 px in crawl order. Desktop sheets are 1280 px: sign in, menu, makers, trust, studio home/orders/settings and admin
regions.

### Wraps found and fixed

| Where | Before | After |
|---|---|---|
| Studio orders, "Making" lane | "Ready for pickup" next to "Send out" broke onto two lines in every card | Action label "Ready"; `SButton` / `SLink` / shopper `Button` are `whitespace-nowrap` |
| Custom orders bento | "RWF 1,023,000" split after "RWF" | `rwfCompact()` (moved to `lib/api.ts`): "RWF 1.02M", exact amount in `title`; bento values `truncate` |
| Host admin hero (360) | "RWF 10,449,198" wrapped | One line with `clamp()` sizing |
| Studio product grid (360) | Prices wrapped | Inline `tabular-nums` / `.tabular` numbers never wrap (global rule) |
| Looks rendering pill (360) | "Rendering on you…" on 3 lines (shrink-to-fit on an absolutely centred pill) | `whitespace-nowrap` |
| Product 3D card (360) | "Preview in 3D" on 3 lines | Button nowrap |
| Tailor services | "on your page" status pill wrapped | "Live" / "Hidden", nowrap |
| Admin pilot arms | "51.8% n=276 · 5.7 gens/user" wrapped | "…/user", shrink-0 |
| Studio dock | "Custom orders" truncated at 360 | Optional `short` label on `StudioNavItem` ("Custom", "Products"). The full label stays the accessible name (label-in-name holds) |
| Studio home to-do | "Try-on allowance used / up" | "Try-ons used up"; to-do titles `truncate` |
| Product editor steps | "2. Colours & …" | "Colours" (the section title keeps "Colours & sizes") |
| Sign in | "Sign in with your / phone" orphan; language chips 3 + 1 | Titles balance globally; languages in an equal 2 × 2 grid |
| RW: 3D / AR mirror mode pill (360) | "Impanga ya 3D · Indorerwamo ya AR" wrapped | Pill capped at the gutter, labels nowrap + truncate |
| RW: Page manager header | "Shopper view" on 3 lines next to the RW title | Brand title truncates; action nowrap, shrink-0 |

Global text rules (`globals.css`, polish block):

- `h1–h4, legend, figcaption` use `text-wrap-style: balance`.
- `p, li, dd, blockquote, small` use `text-wrap-style: pretty`.
- Inline `tabular-nums` and `.tabular` are `nowrap`.
- **The longhand matters.** The `text-wrap` shorthand resets `text-wrap-mode` and silently undid Tailwind's `truncate`
  on paragraphs. This was caught on Browse makers, where descriptions grew to three lines.

### Light surfaces (my recommendations, applied)

1. **Hierarchy by fill, not by line.** There are three levels:
   - grouped background (`--surface`; studio `paper` is now #f6f1eb, a touch deeper);
   - elevated card (`--surface-2` / `st-card`: white, or lifted charcoal in dark);
   - filled control (`--fill` / `--fill-2`, new `bg-fill` / `bg-fill-2` utilities: ink at 5.5–6 % on light, white at
     6–8 % on dark).
   Cards carry `--elev-1`, now very soft (`0 0.5px 1px` + `0 4px 14px -8px` at 10 %), plus `--edge`, a 0.5 px inner
   hairline that keeps white-on-cream cards crisp without reading as a border.
2. **Outlines removed systemically.**
   - `.glass`, `.st-card` and `.st-dock` lost their 1 px borders. Glass on the dark aurora keeps a 0.5 px top sheen.
   - `--border`, `--color-line` and `--color-hairline` are now low-alpha inks (8–10 %), so any line left is soft.
   - A codemod removed 1 px neutral or tint borders and rings (`ring-hairline`, `ring-stone-200`, `ring-amber-200`,
     `border-white/15`, …) from 245 class strings in about 80 files when the element already had a fill. Where the
     width lived in another ternary branch it substituted `*-transparent`. Swatches and selected states were left alone.
   - The primitives were redone by hand (below).
3. **Inputs are filled fields (iOS).** `Input` / `Textarea` / `Select` use `bg-fill`, with no border and no inset shadow.
   On focus the field lifts to the card colour with a 2 px violet ring. The fill is the affordance; it shows on white
   and on paper in both themes. The Stripe-mock card inputs use a focus-visible gold ring instead of a border.
4. **Chips and filters.**
   - Unselected is `bg-fill`.
   - Selected inverts (`bg-fg text-surface`) in both themes. The gold borders are gone from the shopper `Chip`, the
     makers filter, the drape options and sign in.
   - Where an inverted pill would hurt a coloured inline label, the selected state is a gold tint plus a 0.5 px inner
     edge instead: the 3D size picker ("your size" in mint) and the pilot survey tiles.
   - Status `Badge`, `Chip` and `Fact` are fills only, `whitespace-nowrap`.
5. **Grouped lists and sheets (iOS).**
   - Shopper sheets use `--sheet-bg`: cream in light, #15131b in dark.
   - `Group` rows sit on `--group-bg`: white in light, a lifted #221f2a in dark. Before, a white group sat on a white
     sheet with a border.
   - Rows keep only 0.5 px hairline separators.
   - Action sheets, the stepper and the theme toggle lost their borders.
   - Material headers trade `border-b` for a 0.5 px inset hairline, and `divide-hairline` lists are 0.5 px.
6. **Kept on purpose:**
   - Focus rings: `:focus-visible` outline 2.5 px; inputs get a ring on focus.
   - Dashed drop zones for upload, where the dash is the affordance.
   - Capture guides (face oval, scan ring) and the media stages.
   - One-sided separators (passport section rules, timeline rails, desktop sidebar edge), now on the softer hairline
     token.

### Alignment and spacing

- **One leading edge.** The 16 px gutter is unchanged. Chips, inputs and cards no longer add a 1 px border, so a filled
  chip, an input and a borderless card share the same edge.
- **Equal heights.**
  - The language grid is 2 × 2 with equal cells.
  - Bento and KPI values stay on one line, so tiles in a row keep one height.
  - Dock labels are one line.
- **Two-part rows** (label + price, name + count) were already `justify-between` on a baseline. The fixes above keep the
  value on one line (`shrink-0`, nowrap), so it stays right-aligned on the shared baseline.

### Verification

- **crawl-uiux, label `polish`:** 49 screens × light/dark × 390/1280, plus the 360 overflow and wrap pass, with axe.
  Results: 0 console errors, 0 5xx, 0 overflow, 0 theme flashes, 0 serious/critical axe violations, 0 emoji and 0
  wraps. RW run (light, 390 + 360): 0 wraps after the fixes.
- **Typechecks:** `apps/web` and `apps/api` are clean.
- **Tests:** web 19/19; API 33 files, 383 tests.
- **JS budget:** production build, `perf-uiux` label `polish`, JS at load in KB gz including headers. Every core route
  is ≤ 170 and within ±0.2 of pass 2:

  | Muse | Looks | Try | Maker Space | Bag | Orders | Wardrobe | Circle | Trust | Mirror | Sign in |
  |---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
  | 166.1 | 159.0 | 157.7 | 163.9 | 161.8 | 157.5 | 161.2 | 157.7 | 165.6 | 161.0 | 163.2 |

  The pass was CSS-first. The only new JS is `rwfCompact` (moved to `lib/api.ts`) and the dock's `short` label.

### Known gaps

- The wrap check covers one-line elements, not every paragraph. Ragged body copy is handled by `pretty` / `balance` and
  was reviewed by eye on the contact sheets.
- The parallel reseed branch's credits ⓘ sheet and `/credits` page were not on this branch. They should use the same
  primitives (`Group`, `bg-fill`, no outlines) when they merge.
- The other crawls (s1–s5, studio-ui, …) were not re-run here. The change is class-only, and accessible names are
  unchanged apart from the order action "Ready" (s4 clicks Accept / Start making / Send out / Mark delivered, not
  Ready). The dock keeps its full labels as accessible names, so s1's "My products" still resolves.

## 9. Maker Space redesign: showroom-first, one 3D representation (Nov 2026)

The user asked, in their words: "now, redesign this page, and make it more modern, and guiding to 3D VR". After a
first pass they added: "seems to be duplicated content. make sure have one modern 3d vr representation to orient a
user to go in the showroom. thus, make it short page not too long. thus, keep it modern." UI only (web), no API or
schema change. Branch `worktree-agent-aa85d1173a41e98ee` (slot 3, `makerspace`, seed: 8 fictional Kigali makers).

Contact sheets: `docs/design/screens/makerspace-before.jpg` (light and dark at 390, desktop 1280) and
`makerspace-after-{phone,desktop,flows}.jpg`.

### What was wrong (before)

- The maker name wrapped over two lines next to a 96 px monogram ring.
- A loud diagonal-lattice banner in the theme colours took the top 300 px and said nothing.
- The coverflow overlapped its cards and clipped the side labels ("Plain c…tton tee").
- "The 3D shelf" listed the same pieces a second time, below the fold, so the way into 3D/VR was buried.
- The Follow/Chat bar was fixed over the content and covered the shelf heading.

### What it is now

| Area | After |
|---|---|
| **Hero (the one 3D representation)** | The maker's real showroom, rendered by the same `ShowroomEngine` in a new **preview mode** (no input, no XR, a slow ±24° look-around, pausable). It is poster-first: a composed stage of the top three pieces, 3D first, as fanned rounded cards, in the page palette. The live room fades in over it only when the hero is on screen, after `load` and on idle. It stops rendering off screen or in a hidden tab. Tapping the stage enters the showroom. |
| **Guided path** | One primary action, **Enter showroom**. **View in VR** appears beside it only when `navigator.xr.isSessionSupported("immersive-vr")`; it opens `/showroom?vr=1`, where the Enter VR button takes focus (WebXR still needs that tap). |
| **Collection** | No second section. The hero chip **"7 pieces · 3D ›"** opens a sheet: an image-first 2-column grid (3 from 640 px), equal 4:5 cards, one-line titles, tabular prices, a **3D** badge on pieces with a model. A piece opens the existing product sheet, and closing it returns to the grid. This is also the list for keyboards, screen readers and devices without WebGL. |
| **Product sheet** | Order changed to: **View in 3D** card, then **Buy**, then Try on me + WhatsApp. The 3D card was dark text on a dark card in light mode; it is now pinned to `theme-media`. |
| **Identity** | Monogram tile (palette gradient, no ring) beside compact chips: type, pin + sector, star icon + rating (count), **Managed by the maker** (trust tint). The name is always one line: its size scales to the column with container units (`(100cqi − 2rem) / (0.6 × length)`, 20–36 px), and truncation (full name in `title`) is only the safety net. Verified is an icon tick. The story is one line with **more** to expand in place (native `<details>`, no script). |
| **Fashion show** | One slim dark row: cover, LIVE or "Fashion show", title, Kigali time and a ticking `d hh:mm:ss` countdown (`role="timer"`). **RSVP** works in place (sign in first if needed) and flips to **Going**; when live it says **Watch**. |
| **Follow / Chat** | In the identity block. A compact floating material bar (Enter showroom + Follow and Chat icons) slides in only once the hero CTA has scrolled away. It is `inert` while hidden, and the page pads its bottom so it never covers content. The page is now about 1.2–1.5 phone screens, so on most phones the bar never needs to show. |
| **Removed** | The coverflow, the 3D shelf (`components/vr-shelf.tsx`), the lattice banner and the reviews list (the rating chip carries it; the JSON-LD keeps the aggregate rating). |

### Design decisions (my recommendations, applied)

1. **The live preview is the real engine, not a video or a GIF.** It reuses the showroom code and its GLB streaming,
   so what the shopper sees is what they walk into, and the files are warm in the HTTP cache when they enter.
   Bytes stay small: the seeded rooms are 0.5–2 MB of GLB, under the room's 25 MB budget.
2. **Poster-first, then lazy.** No live preview on data saver, with `deviceMemory ≤ 2`, or without WebGL2. These keep
   the composed poster. Low-end devices get the engine's `lowEnd` settings (no shadows, lower pixel ratio). Under
   reduced motion the room holds still and stops rendering 2.5 s after the pieces are in.
3. **One accent, calm.** The page theme gives a palette (from the showroom, or a fallback per theme). It tints the
   hero background with radial glows and colours the monogram, and nothing else. No pattern.
4. **The hero stays dark in both themes** (`theme-media`, like every 3D stage). The rest of the page follows the
   light or dark theme on borderless fills (`bg-fill`, `material`).
5. **Desktop:** the hero (7 of 12 columns, 520 px) sits beside the identity block (5 columns); the show row and the
   tailor's services follow at full width. Max width 1120 px.

### Crawls

- New `scripts/crawl-makerspace.mjs`: hero + live preview, one-line name, no listbox left, pieces sheet (all
  pieces, 3D badge), product sheet with View in 3D and Try on me, the floating bar (hidden at the top, shown after
  scrolling at a 600 px tall viewport, not covering Follow/Chat), Enter showroom from the bar, the show row
  countdown and RSVP → sign in → Going → RSVP, Follow/Following, View in VR → showroom with Enter VR (mocked
  WebXR), data saver keeps the poster, and 360 px with no overflow and one-line names for the longest seeded name.
- `crawl-lib.mjs` gained `openMakerPiece(page, name?)`. s1, s2, e05, xr, region, s5, tryonq and reseed open
  pieces through it instead of stepping the coverflow. mig waits for the heading. vr checks the hero (live
  preview, View in VR, show row) and enters the showroom from it instead of the shelf. growth needed no change.
