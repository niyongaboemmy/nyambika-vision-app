# Nyambika Vision

**Ask. See it on you. Hold to buy.** A page-based fashion platform for Rwandan tailors, sewing cooperatives and sellers, with the AI-native *Nyambika Vision 2.0* shopper experience: **Mirror → Ask/Snap → Looks on you → Hold to buy**, paid directly to the maker.

This repository implements the plan in [docs/implementation-plan.md](docs/implementation-plan.md) (NYA-IMP-001) against the [SRS](docs/srs.md) and the [v2 prototype](docs/prototype-v2/screens/).

## Monorepo

| Path | What |
|---|---|
| `apps/web` | Next.js 16 PWA: shopper experience (Muse, Mirror, Looks stream, Maker Spaces, hold-to-buy, Trust centre), member Page Manager (`/studio`) and host admin (`/admin`) |
| `apps/api` | NestJS 11 core API: identity/OTP, pages, cooperatives, catalogue, twin, intent, looks, orders, payments, billing, privacy, admin |
| `apps/ai` | FastAPI AI Gateway: garment readiness, twin checks, try-on + guard + C2PA, embeddings, Muse intent |
| `packages/contracts` | Shared Zod schemas and types |
| `packages/i18n` | Kinyarwanda / English / French catalogues |
| `docs/` | Proposal, research, feasibility, SRS, implementation plan, prototypes, [ADRs](docs/adr) |

## Run locally

Prerequisites: Node 22+, pnpm 11, PostgreSQL 16+ with **pgvector**, Python 3.12.

```bash
createdb nyambika_dev
cp apps/api/.env.example apps/api/.env   # adjust DATABASE_URL user if needed
pnpm setup                                # install, build contracts, AI venv, migrate, seed
pnpm dev                                  # web :3000 · api :4000 · ai :8100
```

Open http://localhost:3000 on a phone-sized window (or your phone on the same network). In development, OTP codes are shown on the sign-in screen and mock MoMo prompts appear on the simulated handset at `/dev/handset`.

**Seeded accounts** (any OTP shown in dev):

| Phone | Role |
|---|---|
| 0788000001 | Shopper (Aline) |
| 0788100001 | Tailor: Uwase Couture |
| 0788100002 | Cooperative admin: Abahizi Sewing Cooperative |
| 0788100003 | Seller: Kigali Kitenge House |
| 0788900001 | Host admin |

## External services

Payments, WhatsApp/SMS, VTON providers and C2PA signing run through adapters with local implementations, so the whole loop works offline. See [ADR-0002](docs/adr/0002-local-adapters-for-external-services.md) for what each one needs before the pilot.

## Delivery status

Tracked phase by phase in [docs/delivery-log.md](docs/delivery-log.md).

## Testing

```bash
pnpm --filter @nyambika/api test        # ranking unit tests + API integration tests (needs Postgres)
cd apps/ai && pnpm test                  # AI Gateway (pytest)
pnpm e2e                                 # Playwright E2E + axe, against a running, seeded stack
node scripts/crawl-s4.mjs                # sprint crawls: screenshots in scripts/crawl-output/
```
