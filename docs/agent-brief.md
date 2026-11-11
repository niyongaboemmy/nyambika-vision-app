# Parallel delivery brief (for implementation agents)

Read this fully before writing code. You work in your **own git worktree and branch**; several agents run at the same time on other epics. The lead merges branches afterwards, so keep your changes self-contained and easy to merge.

Main repo (read-only reference, do not edit it): `/Users/m2pro/dev/projects/nyambika-vision-app` (abbreviated `$MAIN` below). Read `docs/implementation-plan.md` (your epic rows), `docs/srs.md` (the FR ids named in your task), `docs/delivery-log.md` and the code you touch before designing.

## 1. Isolated environment (slot N is given in your task)

```bash
WT=$(git rev-parse --show-toplevel)            # your worktree
pnpm install --frozen-lockfile                 # or `pnpm install` if you add deps
pnpm --filter @nyambika/contracts build
cp -R $MAIN/apps/api/storage $WT/apps/api/storage          # seed images, personas, media
createdb -T nyambika_tpl nyambika_<slug>                   # seeded copy of the dev DB (never touch nyambika_dev / nyambika_tpl)
cp $MAIN/apps/api/.env $WT/apps/api/.env  # then override:
#   DATABASE_URL="postgresql://m2pro@localhost:5432/nyambika_<slug>?schema=public"
#   PORT=410N   SELF_URL=http://localhost:410N   REDIS_URL=redis://localhost:6379/N   PUBLIC_WEB_URL=http://localhost:310N
#   AI_GATEWAY_URL=http://localhost:8100 (shared)  or http://localhost:810N if you change apps/ai
export XDG_CACHE_HOME=$MAIN/.cache                       # Prisma engines (sandbox blocks ~/.cache)
export PLAYWRIGHT_BROWSERS_PATH=$MAIN/.cache/ms-playwright
```

- API: `cd apps/api && pnpm dev` (tsc-watch; tsx breaks Nest DI). Web: `cd apps/web && API_INTERNAL_URL=http://localhost:410N PUBLIC_WEB_URL=http://localhost:310N npx next dev --port 310N`. The web rewrite reads `API_INTERNAL_URL`.
- AI gateway: shared one at :8100 is running from main. If you change `apps/ai`, run your own: `cd apps/ai && $MAIN/apps/ai/.venv/bin/uvicorn app.main:app --port 810N --reload` and tests with `$MAIN/apps/ai/.venv/bin/pytest -q`.
- Run long-lived servers as background tasks; stop them when done. Never kill processes you didn't start (main stack runs on 3000/4000/8100).
- Docker is not available. Python is 3.12 via `$MAIN/apps/ai/.venv`.
- **Disk is tight (about 2 GB free for everyone).** Never run `next build` or `playwright install`; keep crawl screenshots to what you review; before you finish, stop your servers and delete `apps/web/.next` and `scripts/crawl-output` in your worktree, and `dropdb nyambika_<slug>`. If `df -h ~` shows under 500 MB free, stop and report instead of continuing.

## 2. Merge-safety rules

- **Prisma:** add new models at the end of `schema.prisma` under a header comment `// ==== <EPIC> ... ====`. Avoid editing existing models; reference them with plain `String` id fields (no back-relations) unless a relation is essential. Create exactly one migration: `npx prisma migrate dev --name <epic_slug>` against your own DB. Reference data your feature needs on every environment goes into that migration as `INSERT ... ON CONFLICT DO NOTHING`.
- **New code in new files/modules** (`apps/api/src/modules/<feature>/`, `apps/web/app/<route>/`, `apps/web/components/<feature>*.tsx`). Shared files (`app.module.ts`, `components/look-view.tsx`, `components/menu.tsx`, `app/admin/page.tsx`, `packages/i18n/src/index.ts`, `apps/ai/app/main.py`) get **minimal, additive** edits (an import + one registration line, one button, one tab entry, new keys appended at the end of each locale block).
- Keep the exported APIs of `components/ui.tsx` and `components/studio.tsx` stable (others build on them).
- Dependencies: add only when clearly worth it; pin exact versions that are at least 2 weeks old.
- Follow existing idioms: Zod contracts via `parse()`, `Access.requirePage`/`requireHost` on every page-scoped/host route, `AuthUser`/`@Public()`, `StorageService` for files (private personal data only via signed URLs), `MessagingService` outbox for WhatsApp/SMS, `MeteringService` for billable AI, audit log for admin/money/permission changes, `ConsentService` for anything using personal data.

## 3. Product principles (binding)

OP-1..6: the member owns their page; payments go **directly to the maker**; shoppers' twins, looks and measurements are **never shared with makers** except by explicit, time-limited shopper action; every AI image is labelled + C2PA; synthetic data only outside production (use the seeded makers/personas; never real people). Kinyarwanda first-class (RW/EN/FR).

## 4. Design language (2026+, no dated patterns)

- **Shopper (dark, immersive):** the v2 aurora system already in `globals.css` (glass, orb, `grad-cta`, `text-grad`, display font Nunito Black). Full-bleed media, gestures first with visible fallbacks, bottom sheets (`Sheet` is portalled), no tab bars, no dense lists, no form walls. Micro-interactions (spring-like transforms, haptic `navigator.vibrate` where meaningful), skeletons not spinners for content, `prefers-reduced-motion` respected.
- **Tailor / member studio (light, warm, modern):** large touch targets, image-first grids, bento cards, inline ✨ AI suggestions, clear status chips, floating bottom dock on phones; never a grey admin-table look. Readable outdoors (high contrast).
- Accessibility WCAG 2.2 AA (contrast, focus-visible, labels; a `<label>` must wrap only one control, use `<fieldset>/<legend>` for groups), phone-first at 360–430 px, no horizontal scroll.

## 5. Definition of done for your branch

1. Typecheck clean: `apps/api` (`npx tsc --noEmit -p tsconfig.json`) and `apps/web` (`npx tsc --noEmit`); API tests `npx vitest run` still green (needs your DB/Redis env); add focused tests for new domain logic (vitest in `src/**/*.spec.ts` or `test/`, pytest for AI).
2. **Browser crawl**: add `scripts/crawl-<slug>.mjs` (reuse `scripts/crawl-lib.mjs`; set `BASE_URL=http://localhost:310N`) that walks every new user flow on a Pixel 7 viewport, takes screenshots and fails on console errors/5xx. Run it, **look at the screenshots** and fix what's wrong or ugly. Use a fresh phone number per run (daily look cap is per user). Seeded logins: shopper 0788000001, tailor 0788100001, coop admin 0788100002, seller 0788100003, coop maker 0788100004, host 0788900001; OTP dev code is shown on the sign-in screen.
3. Append one row for your epic(s) to the main table in `docs/delivery-log.md` (after the last row of that table), and update any ADR/doc your change affects. Note honestly what is simulated or untested.
4. `git add -A && git commit` on your branch with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do **not** push, merge or touch `main`.
5. Stop your servers. In your final report give: branch name, what you built (by FR/epic id), migration name, every shared file you edited, tests + crawl results, known gaps.
