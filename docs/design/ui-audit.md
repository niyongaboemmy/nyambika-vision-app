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
| Desktop 1280 | `before-desktop.jpg` | `after-desktop-light.jpg` | |

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

## 5. Accessibility

AXE_SUMMARY

## 6. Known gaps

KNOWN_GAPS
