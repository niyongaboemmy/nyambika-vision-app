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
