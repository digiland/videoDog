# M1 — Scaffold

**Goal (CLAUDE.md §14):** monorepo running end-to-end with a healthcheck.

## Milestone acceptance

- `pnpm dev` runs api at :3001 and web at :3000.
- `curl :3001/health` returns `{ ok: true, db: true, redis: true }` (real Postgres + Redis ping, not a static OK).
- `pnpm test` passes (Money tests included).
- CI is green on a push.
- CI workflow passes on a fresh clone given only `pnpm install` and `docker compose up -d`.

## Tickets

### SZW-M01-001 — Initialize pnpm monorepo

**Goal:** Empty monorepo skeleton with workspaces and Turbo, ready for app scaffolding.
**Scope:**

- `package.json` at root with workspaces config.
- `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- `turbo.json` with `dev`, `build`, `lint`, `typecheck`, `test` pipelines.
- Root `.nvmrc` / `.node-version` pinning Node 22 LTS.
- `.gitignore` covering `node_modules`, `dist`, `.next`, `.turbo`, `coverage`, env files.
- `README.md` with bootstrap instructions mirroring §12.
  **Acceptance:**
- `pnpm install` succeeds on an empty checkout.
- `pnpm turbo run build --filter='./apps/*'` runs (even if no-op).
  **Invariants:** none.
  **Depends on:** none.

### SZW-M01-002 — Root tooling: ESLint, Prettier, Biome, TypeScript

**Goal:** Shared lint/format/type configs that all apps and packages extend.
**Scope:**

- `tsconfig.base.json` strict mode (`noUncheckedIndexedAccess`, `noImplicitAny`, etc.).
- Root `.eslintrc.cjs` (or flat config) with TypeScript + import-order rules; **no `any` allowed**.
- Root `.prettierrc`.
- `biome.json` scoped to `apps/web`.
- Root scripts: `lint`, `typecheck`, `format` fanning out via Turbo.
  **Acceptance:**
- `pnpm lint` and `pnpm typecheck` run and pass on the empty scaffold.
- `const x: any = 1` anywhere produces a lint error.
  **Invariants:** §13 (no `any`).
  **Depends on:** SZW-M01-001.

### SZW-M01-003 — Husky + lint-staged + commitlint

**Goal:** Pre-commit hooks enforce format/lint on touched files and Conventional Commits format.
**Scope:**

- Husky installed; `pre-commit` runs lint-staged.
- `lint-staged`: prettier + eslint --fix on staged `.ts`/`.tsx`/`.json`.
- `commitlint` enforces `<type>(<scope>): <subject>` per §12.
  **Acceptance:**
- Committing a file with lint errors blocks the commit.
- Committing with a non-conventional message blocks the commit.
  **Invariants:** none.
  **Depends on:** SZW-M01-002.

### SZW-M01-004 — Scaffold `packages/shared`

**Goal:** Shared package exporting Zod schemas, currency types, and domain errors — consumed by api and web.
**Scope:**

- `packages/shared/package.json` with `name: @streamzw/shared`.
- `tsconfig.json` extending root base.
- `src/index.ts` re-exports.
- `src/errors.ts`: `DomainError` base + `CurrencyMismatchError`.
- `src/currency.ts`: `CurrencyCode` union (`USD | ZWG | ZAR | EUR | GBP`).
- Build via `tsup` → ESM + types.
  **Acceptance:**
- `pnpm --filter @streamzw/shared build` produces `dist/` with `.d.ts`.
- `apps/api` and `apps/web` can import from `@streamzw/shared`.
  **Invariants:** §3.1, §3.2 (foundations for Money).
  **Depends on:** SZW-M01-002.

### SZW-M01-005 — Money value object + tests

**Goal:** Implement the Money class per §6 with bigint-safe math.
**Scope:**

- `packages/shared/src/money.ts` exporting `Money` with: `of`, `zero`, `add`, `sub`, `mul`, `toUsdEquivalent`, `format`, `equals`, static `parse`.
- `mul(factor: number)`: convert factor to rational with 10⁹ scale, multiply via bigint, round half-up (document rounding mode in a code comment — one of the few WHY comments warranted).
- `format(locale)` per-currency table: `$1.49`, `ZWG 44.70`, `R 27.80`, `€…`, `£…`.
- `toUsdEquivalent(rate: FxRate)`: returns USD-denominated Money; `FxRate` type stub here, full impl in M7.
- Vitest covers: currency mismatch errors on `add`/`sub`; bigint precision (no float drift on chained `mul`); zero handling; negative amounts; values above `Number.MAX_SAFE_INTEGER`.
  **Acceptance:**
- `pnpm --filter @streamzw/shared test` passes.
- `new Money(1n, 'USD').add(new Money(1n, 'ZWG'))` throws `CurrencyMismatchError`.
- `Money.of(10000n, 'USD').mul(1/3)` returns deterministic documented result.
  **Invariants:** §3.1, §3.2.
  **Depends on:** SZW-M01-004.

### SZW-M01-006 — Scaffold `apps/api` (NestJS 11)

**Goal:** Bare-bones NestJS app importing `@streamzw/shared`.
**Scope:**

- `apps/api/package.json` with NestJS 11 deps.
- `src/main.ts` bootstrapping on `PORT=3001`.
- `src/app.module.ts` with a `HealthModule` placeholder (real impl in -010).
- pino-based logger via `nestjs-pino`.
- `src/common/filters/domain-error.filter.ts` mapping `DomainError` subclasses to HTTP responses.
- `dotenv-flow` loading `.env.local`.
  **Acceptance:**
- `pnpm --filter api start:dev` runs on :3001, prints "Nest application started".
- `/` returns 404 (no routes yet).
- A throwaway `CurrencyMismatchError` route returns 400 with structured JSON body.
  **Invariants:** §13.
  **Depends on:** SZW-M01-004, SZW-M01-005.

### SZW-M01-007 — Scaffold `apps/web` (Next.js 15 App Router)

**Goal:** Bare-bones Next.js app importing `@streamzw/shared`.
**Scope:**

- `apps/web/package.json` with Next 15.
- `app/page.tsx` placeholder home displaying "StreamZW" and a `Money.format` example using the shared package.
- `next.config.js` with `transpilePackages: ['@streamzw/shared']`.
- Tailwind CSS + shadcn/ui init (full `packages/ui` extraction is a later ticket — just configure Tailwind here).
- Biome configured for this app only.
  **Acceptance:**
- `pnpm --filter web dev` runs on :3000.
- Home renders and shows the formatted money string — verifies the shared package is wired.
  **Invariants:** §3.2 (Money used at the leaf per §13).
  **Depends on:** SZW-M01-005.

### SZW-M01-008 — `infra/docker-compose.yml` for Postgres, Redis, MinIO

**Goal:** Local dev stack stands up with one command.
**Scope:**

- `infra/docker-compose.yml`:
  - `postgres:16` with volume, creds `streamzw/streamzw`, port 5432.
  - `redis:7-alpine`, port 6379.
  - `minio/minio:latest` with console, ports 9000/9001, two buckets pre-created via init container or `mc` script (`streamzw-videos`, `streamzw-thumbs`).
- `.env.example` listing env vars from §11.
  **Acceptance:**
- `docker compose -f infra/docker-compose.yml up -d` brings all three up healthy.
- `psql postgres://streamzw:streamzw@localhost:5432/streamzw -c 'select 1'` works.
- `redis-cli ping` returns PONG.
- MinIO console reachable at :9001 with both buckets present.
  **Invariants:** none.
  **Depends on:** SZW-M01-001.

### SZW-M01-009 — Drizzle config + first migration (`0001_init.sql`)

**Goal:** Drizzle ORM wired, migration tooling in place, first three tables created.
**Scope:**

- Migration tool: default **node-pg-migrate** (open question #2).
- `apps/api/drizzle.config.ts` pointing at `infra/migrations`.
- `apps/api/src/db/schema/` Drizzle definitions for `users`, `otp_challenges`, `refresh_tokens` matching the SQL.
- `infra/migrations/0001_init.sql`:
  - `pgcrypto` extension (`gen_random_uuid()`).
  - `user_role` and `kyc_state` enums.
  - `users` table per §9.
  - `otp_challenges` per §9 (no `updated_at` per open question #3).
  - `refresh_tokens` per §9.
  - E.164 validation lives in the app layer (Zod), not a CHECK constraint — document this in a SQL comment.
- `pnpm --filter api migrate` and `migrate:create` scripts.
- `apps/api/src/db/db.module.ts` exporting a Drizzle client wired to `DATABASE_URL`.
  **Acceptance:**
- `pnpm --filter api migrate` creates all three tables; re-run is a no-op.
- `db.select().from(users)` compiles and returns `[]`.
  **Invariants:** §3.13, §3.14.
  **Depends on:** SZW-M01-006, SZW-M01-008.

### SZW-M01-010 — `/health` endpoint with real DB + Redis pings

**Goal:** Healthcheck that actually proves both services are reachable.
**Scope:**

- `HealthController` exposing `GET /health`.
- Pings Postgres via `db.execute(sql\`select 1\`)`.
- Pings Redis via `ioredis` `PING`.
- Returns `{ ok, db, redis }` with `ok = db && redis`.
- On any sub-check failure, returns 503 with the failed flag false.
  **Acceptance:**
- With compose up: `curl :3001/health` → 200 `{ ok: true, db: true, redis: true }`.
- Stop Postgres: same curl → 503 `{ ok: false, db: false, redis: true }`.
- Logs include `request_id` and structured fields per §13.
  **Invariants:** §13.
  **Depends on:** SZW-M01-009.

### SZW-M01-011 — GitHub Actions CI

**Goal:** CI runs lint + typecheck + test on every push and PR.
**Scope:**

- `.github/workflows/ci.yml`:
  - Triggers: push to any branch, PR to `main`.
  - Node 22, pnpm 9 setup.
  - `services:` for `postgres:16` and `redis:7` (faster than compose).
  - Steps: install, lint, typecheck, build, test.
  - Caches: pnpm store and Turbo.
- Branch protection on `main` (manual GitHub step; document in `docs/RUNBOOK.md` skeleton).
  **Acceptance:**
- Pushing the branch triggers a green CI run.
- A deliberate lint error makes CI red.
- A fresh clone + `pnpm install` + `docker compose up -d` matches what CI does (modulo `services:` vs compose).
  **Invariants:** none.
  **Depends on:** SZW-M01-002, SZW-M01-005, SZW-M01-010.
