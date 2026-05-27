# StreamZW

Creator-led video platform for Zimbabwe. Each video is one of four access modes — `free`, `ppv`, `premium`, `premium_buyable` — priced in the creator's canonical currency (USD by default), with viewer-side display conversion for ZWG, ZAR and (phase 2) EUR / GBP. Subscriptions are $0.99 day-pass or $1.49 month; PPV unlocks $0.10–$2.00.

Full spec: [CLAUDE.md](./CLAUDE.md). Work breakdown: [tickets/](./tickets/). Implementation review: [docs/REVIEW.md](./docs/REVIEW.md). End-to-end usage guide: [WALKTHROUGH.md](./WALKTHROUGH.md).

## Stack

| Layer         | Choice                                                                      |
| ------------- | --------------------------------------------------------------------------- |
| API           | NestJS 11 (modular monolith)                                                |
| Web           | Next.js 15 (App Router)                                                     |
| Mobile        | Flutter (phase 2 — deferred)                                                |
| DB            | Postgres 16 + Drizzle (SQL-first migrations via node-pg-migrate)            |
| Cache / queue | Redis 7 + BullMQ 5                                                          |
| Storage       | RustFS (S3-compatible) on `:9000` — shared dev instance                     |
| CDN           | BunnyCDN (HLS, signed URLs)                                                 |
| Transcode     | FFmpeg 7 worker containers (240 / 480 / 720p HLS)                           |
| Auth          | Phone + OTP (WhatsApp → SMS fallback); JWT access 15-min + rotating refresh |
| Payments      | EcoCash USD + ZWG, ZIPIT, Paystack                                          |
| FX            | RBZ + Open Exchange Rates daily; manual admin override                      |
| Monorepo      | pnpm 9 + Turbo                                                              |
| Runtime       | Node 22 LTS                                                                 |

## Layout

```
apps/
  api/      NestJS — modular monolith
  web/      Next.js — viewer + creator studio
packages/
  shared/   Zod schemas, Money value object, domain errors
infra/
  docker-compose.yml
  migrations/         SQL migrations (node-pg-migrate)
  scripts/            init-buckets.sh, etc.
tickets/              MVP work breakdown by milestone
docs/
  REVIEW.md           current implementation review (bugs + gaps)
```

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Env — copy and fill in secrets you actually have. Dev defaults work as-is.
cp .env.example .env

# 3. Start Postgres + Redis (RustFS must already be running on :9000)
docker compose -f infra/docker-compose.yml up -d postgres redis

# 4. Make sure the two object-storage buckets exist
bash infra/scripts/init-buckets.sh

# 5. Apply migrations + seed demo users
pnpm --filter api migrate
pnpm --filter api seed

# 6. Run API + Web in watch mode
pnpm dev
```

Then:

- API — <http://localhost:3001>
- Web — <http://localhost:3000>
- Health — `curl localhost:3001/health` → `{ ok: true, db: true, redis: true }`

See [WALKTHROUGH.md](./WALKTHROUGH.md) for sign-in, upload, paywall, and admin flows with the seeded demo users.

## Invariants (don't merge a violation)

From [CLAUDE.md §3](./CLAUDE.md):

- **Money** is always `(amount_minor_units: bigint, currency: char(3))`. No floats, no decimals-as-strings, no untagged numbers. Domain math goes through the `Money` value object.
- **Ledger** (`ledger_entries`) is append-only (DB trigger enforces) and balanced per currency per transaction.
- **Access** decisions only ever come from `VideosService.checkAccess`. Never inline a permission check.
- **Watched minutes** derive from 15-second heartbeats; never from start / stop events.
- **Payment webhooks** are idempotent (`payments.idempotency_key UNIQUE`) and reconcile against provider state on every transition.
- **Phone numbers** in E.164. **Access JWT** 15-min. **Refresh tokens** rotate on every use.

## License

Proprietary — all rights reserved.
