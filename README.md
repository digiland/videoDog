# StreamZW

Creator-led video platform for Zimbabwe. Three monetization modes per video (free with tips, pay-per-view, premium subscription, or hybrid), multi-currency from day one (USD canonical, ZWG and ZAR first-class), mobile-first delivery.

Full spec: [CLAUDE.md](./CLAUDE.md). MVP work breakdown: [tickets/](./tickets/).

## Bootstrap

```bash
# 1. Install deps
pnpm install

# 2. Configure env (copy and edit)
cp .env.example .env

# 3. Bring up full local stack (Postgres, Redis, MinIO, API, Web)
docker compose -f infra/docker-compose.yml up -d --build

# 4. Optional host-side bucket bootstrap (compose already runs minio-init)
bash infra/scripts/init-buckets.sh

# 5. Start local dev watch mode (optional; compose runs production-like containers)
pnpm dev
```

Then:

- API: <http://localhost:3001>
- Web: <http://localhost:3040> (override with `WEB_HOST_PORT`)
- Postgres: `127.0.0.1:5433` (host port; container still uses 5432 internally)
- MinIO S3 API: <http://localhost:9010> (override with `MINIO_API_HOST_PORT`)
- MinIO Console: <http://localhost:9011> (override with `MINIO_CONSOLE_HOST_PORT`)
- Healthcheck: `curl localhost:3001/health` → `{ ok: true, db: true, redis: true }`

## Stack

NestJS 11 · Next.js 15 (App Router) · PostgreSQL 16 · Redis 7 · MinIO · BunnyCDN · Drizzle ORM · pnpm + Turbo · Node 22 LTS.

Locked decisions: [CLAUDE.md §2](./CLAUDE.md). Invariants (money, ledger, access, payments, auth/PII): [§3](./CLAUDE.md).

## Workspace

```
apps/
├── api/      NestJS — modular monolith
└── web/      Next.js — viewer + creator studio
packages/
└── shared/   Zod schemas, Money value object, domain errors
infra/
├── docker-compose.yml
└── migrations/
tickets/      MVP work breakdown by milestone
```

## License

Proprietary — all rights reserved.
