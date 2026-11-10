# Delivery log

| Phase / sprint | Scope delivered | Verified |
|---|---|---|
| Phase 0: foundations | Monorepo, CI, Prisma data model (R1), phone OTP with rotating refresh tokens, design tokens (v2 aurora + light Page Manager theme), RW/EN/FR catalogues, AI Gateway service, ADRs 0001–0004. Walking skeleton: login → empty Page Manager. | Browser crawl `scripts/crawl-phase0.mjs`; AI tests 16/16 |
| Sprint 1: members manage a page | Page manager (create, profile, theme, vacation mode, staff), verification queue item on creation, cooperatives (makers, attribution consent, payout destination, approval workflow, per-maker sales), catalogue with variants, photo upload → AI quality check, background removal, readiness and Snap embedding (pgvector), audit log, SSR Maker Space v1 with OG/JSON-LD and coverflow, "Browse makers" directory, WhatsApp ordering fallback, synthetic seed (5 makers, 23 products) | `scripts/crawl-s1.mjs`: tailor creates + publishes product, coop maker submits, admin approves, new member page pending verification. Crawl found and fixed: label a11y bug on chip groups, coop members blocked from page manager. |
