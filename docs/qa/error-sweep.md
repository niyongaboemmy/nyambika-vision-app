# Error sweep (QA, 11 Nov 2026)

Goal: no user-facing raw error text anywhere in the app. Expected limits (plan §4.4 daily look cap, AI kill switch,
consent, rate limits, closed pilot, NLB gate, payment declines, offline) are product rules and now render as
designed, calm states. Unexpected failures get one short human sentence. Product rules are unchanged: the cap is still
`looks.daily_cap` (default 15 per day).

Trigger: a shopper saw *"Daily look limit reached (15). New looks unlock tomorrow; saved looks stay free to view."*
as a raw red error.

## How it was swept

- Every existing crawl (`scripts/crawl-*.mjs`, 26 scripts) run against slot 3 (web :3103, API :4103, DB
  `nyambika_errsweep`, own AI gateway :8103 with the fake GPU pool on :8143 so `crawl-infer` has the routed gateway it
  needs).
- New **`scripts/crawl-sweep.mjs`**: walks every route under `apps/web/app` (58 `page.tsx` and `route.ts`, found on
  disk; dynamic params come from seeded data per role) as anonymous, shopper, tailor, coop admin, coop maker and host,
  at 390 px and 1280 px (696 visits). It collects console errors, uncaught errors and unhandled rejections, failed
  requests (4xx except the intended 401/403/404/410 probes, every 5xx), React hydration warnings, raw API error text
  in the rendered page, broken images and horizontal overflow. A 429 counts as intended only when the page shows the
  designed `LimitState` card (`data-limit`), and the sweep screenshots each designed state it meets. Output:
  `scripts/crawl-output/sweep/findings.{md,json}`.

## Findings → root cause → fix

| # | Finding (where) | Root cause | Fix / status |
|---|---|---|---|
| 1 | Raw "Daily look limit reached (15)…" in red (Muse, looks stream, Try on me, colour switch, Hold to buy) | Pages showed `error.message`; the API sent no machine-friendly reset time | **Fixed.** `lib/api-errors.ts` maps `DAILY_CAP` → `LimitState` card "You've seen today's new looks ✨" with a live countdown to Kigali midnight, buttons Saved looks / Wardrobe / Browse makers, no red. The API adds `resetsAt`, `retryAfterSec`, `cap`, `used` (`common/kigali-day.ts`) |
| 2 | Cap reset at the server's local midnight, not Kigali's | `MeteringService.startOfDay()` and the 3D twin build gate used `setHours(0)` (server TZ) | **Fixed.** `kigaliDayStart()` / `nextKigaliMidnight()` (UTC+2, no DST) for looks and 3D twin builds; unit-tested |
| 3 | `KILL_SWITCH` shown as raw "Looks are paused…" | Same raw-message pattern | **Fixed.** "Looks are resting 🌙" card with Try again; API adds `retryAfterSec` |
| 4 | Consent codes (`VOICE_CONSENT`, `CONSENT_REQUIRED`, `CONSENT_WITHDRAWN`, `NO_CONSENT`) shown as text that points elsewhere | No machine-readable purpose on the error | **Fixed.** API adds `purpose` (TRYON_GENERATION, AVATAR_3D) where it was missing; the card offers an inline **Turn on** (POST `/privacy/consents` or `/twin3d/consent`) and a Trust centre link, then retries |
| 5 | 429s with no code (circle votes, voice, presence joins, OTP, VR reactions, video/motion allowances) shown raw | Only the status was meaningful | **Fixed.** Mapped to "Give it a moment" with countdown from `Retry-After` / `retryAfterSec`; OTP gets its own sentence; allowance codes keep their specific reason |
| 6 | Closed pilot detected by `error.includes("closed pilot")` on the Muse | String-sniffing the server text | **Fixed.** `PILOT_ONLY` → card with "Enter an invite code" |
| 7 | `NLB_GATE` refusal on the admin Inference card read "Activation refused: Waiting on a safety check…" after mapping | The card adds its own context | **Fixed.** The card shows the gate's own reason (`ApiError.raw`); elsewhere `NLB_GATE` maps to the calm gate state |
| 8 | "Failed to fetch" / "Load failed" when offline | `fetch` rejections passed straight through | **Fixed.** `api()` wraps network failures as `ApiError(0, OFFLINE)` → "You're offline" card that retries by itself on the `online` event |
| 9 | 5xx bodies, HTML gateway pages, "Validation failed", programming errors (`Cannot read properties…`) could reach the UI | No classification | **Fixed.** 5xx/HTML → "Something went wrong on our side"; validation → "Please check: address, size"; Type/Syntax errors never shown. Human 4xx text written by the API (e.g. "This item isn't available") is kept |
| 10 | Anonymous visits to /trust, /wardrobe, /circle, /orders/:id, /custom/:id… rendered "Unauthorized" | Raw 401 text | **Fixed.** "Sign in to continue" card with a Sign in link back to the page |
| 11 | Taps that failed silently: ~15 handlers `onClick={async () => await api(…)}` with no catch (order "I received it", review form, studio slot/service/zone deletes, admin moderation/model/agent/incident actions, measurement revoke, address delete…) → unhandled promise rejections | Missing error handling | **Fixed.** Global `components/error-toaster.tsx` (one line in `app/layout.tsx`) catches escaping `ApiError`s, shows them through `LimitState` (light on studio/admin) and marks them handled; the order page handlers were fixed directly |
| 12 | Order page polling: `setTimeout(async () => setData(await api(...)))` rejected into the void on a failed poll | Unhandled async in a timer | **Fixed.** Poll catches and retries next tick |
| 13 | Payment declined / timed out: order silently became "Cancelled" with no next step | No designed state | **Fixed.** "Payment didn't go through. No money was taken." card with Try again (back to the Maker Space). (Discount release on failed payment: covered by hardening pass) |
| 14 | `/looks/try` without `?variant=` spun forever | Effect returned early, spinner never replaced | **Fixed.** Empty state "Pick a piece in a Maker Space to try it on" + Browse makers |
| 15 | Rwandan shopper's Muse/Snap ranked a Kenyan maker (E41 seed); Hold to buy then failed with "hasn't set up Mobile Money" (found by `crawl-social`) | Look candidates ignored E41 region rules that the maker directory already applies | **Fixed.** `visibleForShopper()` (home country + cross-border-listed pages when the shopper opted in) in Muse and Snap ranking; unit-tested. Multi-currency buying of cross-border pieces: covered by hardening pass |
| 16 | Admin › Flags & models: 360 px horizontal overflow (Inference controls) | Grid children without `min-w-0` around a scrolling segmented control | **Fixed** (`min-w-0`) |
| 17 | Admin › Outbox: 360 px overflow | Web Push endpoint URLs (80 chars, unbreakable) in the "to" field | **Fixed** (`break-all`, `min-w-0`) |
| 18 | Inline error spots outside `ErrorNote`/`Note` (morph sheet, video/motion rails, MR mirror, fashion-show reactions, drape spike, discount field, AI writer, easy studio) | Custom `<p>{err}</p>` | **Fixed.** Expected limits there render `LimitState`; unexpected keep their compact text |
| 19 | `/[...legacy]` in `next dev`: "Failed to execute 'measure' on 'Performance': 'Legacy' cannot have a negative time stamp" | React's dev-only Server Components performance track mis-times an async page that ends in `notFound()` | **Intended / upstream.** Dev-only, absent from production builds; allow-listed in the sweep with this reason |
| 20 | `/confirm/<bad token>` → 400 | Sweep probes with a malformed mandate token | **Intended.** The page shows its invalid-link state |
| 21 | 429 on `/looks/try` and `/intent/:id/advance` for the seeded shopper | Seeded shopper is at the daily cap: the exact reported scenario | **Intended.** Rendered as the daily-cap card (screenshot `crawl-output/sweep/limit-_looks_try-daily-cap-390.png`) |

No hydration warnings, broken images or 5xx responses were found on any route or role.

### Crawls made robust (environmental flakiness, not skipped)

| Crawl | Problem | Fix |
|---|---|---|
| e05, s1, s2, xr | Strict-mode locators for `option` matched both the coverflow and the E35 3D shelf | Scoped to `listbox "Collection"` |
| s1 | "try-on cut-out" text also in the 3D panel; approval queue full of earlier runs' submissions | Exact locator; unique product name per run, approve that card, wait for the status response |
| s2 | `crawl-output/bad-twin.png` missing on fresh checkouts | Generated on demand (dark 320×240 PNG) |
| s5 | Asserted the old raw copy | Asserts the designed cards ("Looks are resting", "Looks on your twin are paused" + Turn on) |
| mig | `wave0.json` missing / re-imported pages never show "✓" | Fresh synthetic bundle every run (`MIG_BUNDLE_KEEP=1` to reuse) |
| agentic, mlspike, mrvr | Hard-coded agent ports / DB names | `crawl-lib` exports `API_BASE` (web 310N ↔ API 410N) and `CRAWL_DB` (env, else `apps/api/.env`) |
| mrvr | SwiftShader showroom load stalls on a busy machine; the pilot survey sheet (seeded accounts accumulate orders/looks) covered "Shared room" | One reload before failing; pre-answers the survey via API |
| growth | Outbox lists newest rows only; broadcast already sent today | Only expects the broadcast row when this run sent it |
| pilot | "Not now" closes the survey before the dismissal is stored | Polls `/survey/pending` briefly |
| social | Pilot survey sheet covered the restyle sheet after the paid order; hold-to-buy failure was silent | Pre-answers the survey via API; prints the on-screen reason on failure |
| tailor | 17:00 slot already published by earlier runs | Picks any free time |
| voice | `muse.voice` experiment puts half of fresh users in the text arm (no mic); shirt stock down to 1; address list sampled too early | Pre-registers numbers until one is in the voice arm; stock-safe third piece; waits for the address |
| region (and every `crawl-lib` crawl) | Under heavy machine load a screenshot taken mid-hydration made React report a mismatch on `caret-color` (Playwright hides the caret by injecting that style) | `isCrawlArtifact()` in `crawl-lib` ignores hydration diffs that touch only `caret-color`; any other mismatch still fails |
| infer | Needs a gateway with `INFERENCE_ROUTING=1`, `VTON_PROVIDER=routed`, `INFERENCE_POOL_URL` | Run the slot's own gateway + fake pool (documented here) |
| API `test/checkout.spec.ts` | Crawls on the shared DB had bought the test's pieces | Tops the variant up for the test and restores the original stock |

## Design of the error layer

- `apps/web/lib/api-errors.ts`: pure `describeError(e, locale)` → `{ kind, expected, title, body, resetsAt,
  retryAfterSec, purpose, raw }`; `errorText()` for one-line spots; Kigali-midnight and countdown helpers; RW/EN/FR
  copy (`err.*` keys in `packages/i18n`, SW falls back to EN). Tests: `apps/web/lib/api-errors.test.ts`
  (`pnpm --filter @nyambika/web test`, node:test).
- `apps/web/lib/api.ts`: `ApiError` now carries `code`, `raw`, `retryAfterSec`; its `message` is already friendly and
  localised, so every existing `setError(e.message)` call site improved without edits; the friendly text is
  registered so `ErrorNote` / studio `Note` recognise an expected limit from the string alone.
- `apps/web/components/limit-state.tsx`: one component for every designed state; `tone="dark"` (shopper aurora glass)
  or `"light"` (studio). `ErrorNote` and `Note` delegate to it (props widened, compatible).
- `apps/web/components/error-toaster.tsx`: safety net for escaped `ApiError`s.

## Open product decision (taken with a recommendation)

- **Kigali time for every shopper.** The cap resets at midnight Kigali time for all users, including the Kenya /
  Uganda / Tanzania pilots (UTC+3 → 01:00 local). Recommendation taken: keep one reset instant for now (simple,
  matches cost accounting); switch to the shopper's E41 country timezone if the EAC pilots grow.

## Final run (slot 3, after merging both hardening passes)

| Crawl | Result | | Crawl | Result |
|---|---|---|---|---|
| agentic | ✅ | | region | ✅ (rerun¹) |
| drape | ✅ | | s1 | ✅ |
| e05 | ✅ | | s2 | ✅ |
| growth | ✅ (rerun¹) | | s3 | ✅ |
| harden-commerce | ✅ (rerun¹) | | s4 | ✅ |
| infer | ✅ (rerun¹, own gateway :8103 + fake pool) | | s5 | ✅ |
| mig | ✅ | | social | ✅ |
| mlspike | ✅ | | studio-ui | ✅ |
| mrvr | ✅ (after the survey fix) | | **sweep** | ✅ 696 visits, 0 open findings |
| native | ✅ | | tailor | ✅ |
| phase0 | ✅ | | twin3d | ✅ |
| pilot | ✅ | | voice | ✅ |
| | | | vr | ✅ |
| | | | xr | ✅ |

¹ Failed in the sequential run while the API was recompiling after the main merge (and under machine load average
15–70 from parallel agents); green when rerun right after with no code change, except region, which needed the
`caret-color` artifact filter above.
