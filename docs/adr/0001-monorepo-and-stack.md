# ADR-0001: Monorepo and implementation stack

- Status: Accepted (Phase 0)
- Context: Implementation plan §4.1–4.2.

## Decision
- **pnpm workspaces + Turborepo** monorepo: `apps/web`, `apps/api`, `apps/ai`, `packages/contracts`, `packages/i18n`.
- **Web:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, installable PWA. Gestures via `@use-gesture/react`; animation in CSS (Framer Motion was dropped to protect the 170 KB gz JS budget, plan §7.5).
- **API:** NestJS 11 modular monolith, Zod contracts shared with the web app (`@nyambika/contracts`).
- **AI Gateway:** Python 3.12 + FastAPI (port 8100).
- **Database:** PostgreSQL 16+ with pgvector; **Prisma 6.19** (OD-04 resolved: Prisma).

## Pinned versions and why
| Package | Pinned | Reason |
|---|---|---|
| TypeScript | 5.9 | TS 7 (native compiler) does not yet have proven `emitDecoratorMetadata` support, which NestJS DI needs. |
| Prisma | 6.19 | Prisma 8 is still RC on npm; 6.x is the stable line with `postgresqlExtensions`. |
| NestJS | 11.2 | Stable, well-known API; 12.x can follow once the ecosystem catches up. |

## Consequences
- API dev runs on `tsc-watch` (esbuild/tsx drops decorator metadata).
- Admin console lives in `apps/web` under `/admin` with a host-role guard instead of a separate `apps/admin` app for R1 (fewer deployables). Split when a separate auth realm is required.
