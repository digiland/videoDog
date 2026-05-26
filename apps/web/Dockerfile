FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

ARG NEXT_PUBLIC_API_BASE=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @streamzw/shared build
RUN pnpm --filter web build

FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --prod=false

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY --from=builder /app/apps/web/next.config.mjs apps/web/next.config.mjs
COPY --from=builder /app/apps/web/package.json apps/web/package.json

EXPOSE 3030

CMD ["pnpm", "--filter", "web", "start"]
