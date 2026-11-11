# Web PWA (Next.js). Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @nyambika/web... \
 && pnpm --filter @nyambika/contracts build \
 && pnpm --filter @nyambika/web build

FROM node:22-bookworm-slim
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["pnpm", "start"]
