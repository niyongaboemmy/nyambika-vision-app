# Core API (NestJS). Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile --filter @nyambika/api... \
 && pnpm --filter @nyambika/contracts build \
 && pnpm --filter @nyambika/api exec prisma generate \
 && pnpm --filter @nyambika/api build

FROM node:22-bookworm-slim
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
USER node
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
