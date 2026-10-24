# Deploying StreamZW

One Linux VPS running everything under docker compose (CLAUDE.md §2: k8s is post-MVP).
Files: `infra/docker-compose.prod.yml`, `infra/nginx/templates/`, `infra/.env.production.example`,
`infra/scripts/init-letsencrypt.sh`.

```
                 ┌──────────── nginx :80/:443 (Let's Encrypt) ────────────┐
 https://DOMAIN  │  web  (Next.js)          server renders → http://api:3001│
 https://api.…   │  api  (NestJS + transcode, watch, pool, FX workers)      │
 https://media.… │  minio (presigned uploads, thumbnails, HLS segments)     │
                 └──── postgres · redis · backup (nightly pg_dump) ─────────┘
```

Only nginx is published. The MinIO console listens on the server's loopback only.

## 1. Server

- **Size**: 4 vCPU / 8 GB RAM / 160 GB+ SSD to start. Transcoding is the heavy part: one
  1080p upload uses all cores for a few minutes. Video storage grows by roughly 1.5× each
  source file (all renditions), so plan disk growth or move MinIO to block storage.
- **Region**: as close to Harare as you can get. A Johannesburg or Cape Town region is
  usually best for Zimbabwean mobile networks _(verify with a ping test from Econet and
  NetOne lines before choosing)_.
- **OS**: Ubuntu 24.04 LTS with Docker Engine and the compose plugin
  (`curl -fsSL https://get.docker.com | sh`).
- **Firewall**: allow 22, 80, 443 only.

## 2. DNS

Point three A records at the server: `DOMAIN`, `api.DOMAIN` and `media.DOMAIN`.

## 3. Configure

```bash
git clone <repo> streamzw && cd streamzw
cp infra/.env.production.example infra/.env.production
$EDITOR infra/.env.production          # every blank value; commands for secrets are inline
```

Keep a copy of `KYC_ENCRYPTION_KEY` somewhere safe outside the server: without it the
encrypted national IDs cannot be read.

Check the pinned MinIO, mc and certbot image tags in `docker-compose.prod.yml` still exist
(`docker pull` them) and update them if not.

## 4. First start

```bash
C="docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml"

$C build                                       # api + web images (5–10 min)
$C up -d postgres redis minio minio-init       # data stores, buckets
bash infra/scripts/init-letsencrypt.sh ops@yourdomain   # TLS for all three hosts
$C up -d                                       # api (runs migrations on start), web, nginx, certbot, backup
$C ps                                          # everything "healthy" / "running"
curl -s https://api.DOMAIN/health              # {"ok":true,"db":true,"redis":true}
```

The API applies database migrations every time it starts, so there is no separate step.

## 5. First admin

Sign in on the site once with your phone, then:

```bash
$C exec api node apps/api/dist/scripts/make-admin.js +2637XXXXXXXX
```

Admins approve creator applications (`/admin/applications`) and verify IDs.

## 6. Providers

| Provider          | Set up                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp Business | Approved OTP template; `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`. SMS (`SMS_API_KEY`) is the fallback.                                        |
| EcoCash USD + ZWG | Merchant codes and keys; webhook `https://api.DOMAIN/webhooks/ecocash` signed with `ECOCASH_WEBHOOK_SECRET`.                              |
| Paystack          | `PAYSTACK_SECRET_KEY`; webhook `https://api.DOMAIN/webhooks/paystack`; callback is set automatically to `https://DOMAIN/checkout/return`. |
| FX                | `OPENEXCHANGERATES_APP_ID`. The RBZ scraper needs no key. Rates refresh daily at 06:00 CAT; admins can override.                          |
| BunnyCDN (option) | Pull zone with origin `https://media.DOMAIN` and Token Authentication on; set `BUNNYCDN_PULLZONE` and `BUNNYCDN_SIGNING_KEY`.             |

## 7. Smoke test (every niche, end to end)

Do this on staging first, then on production with real money in small amounts.

1. **Creator**: apply at `/me/apply`, approve as admin, set a handle in `/me`, upload a
   video with a category, wait for "Ready", publish.
2. **Course**: in `/studio/collections` create a course with two sections, add a free and a
   pay-once lesson, publish. It appears on `/courses` and on the home shelf for its topic.
3. **Viewer, free**: on a phone, open the free lesson from the course page, play it, and
   check that heartbeats arrive (watch time shows in the studio the next day).
4. **Viewer, pay once**: open the paid lesson → paywall → EcoCash → approve on the handset →
   it plays. Ledger: creator 70% / platform 30% (`/studio/earnings`).
5. **Premium**: buy a day pass; a Premium video in another category plays.
6. **Payout**: creator sets the payout number (OTP), requests a payout above the threshold.
7. **Share**: the Share button opens WhatsApp with the link; the link preview shows the
   thumbnail and title.

For a staging server you can load the demo catalogue (one creator or two per niche, with
courses and playlists):

```bash
$C exec api node apps/api/dist/scripts/seed-demo.js
```

Never run it on production: it creates demo accounts and synthetic view counts.

## 8. Deploying an update

```bash
git pull
$C build api web
$C up -d api web          # migrations run as the API starts
```

The API is briefly unavailable while it restarts. Uploads in progress resume (resumable
multipart), and BullMQ jobs survive in Redis.

## 9. Backups and restore

The `backup` service writes `pg_dump` files nightly to the `backups` volume and keeps 14
days. **Copy them off the server**, for example to object storage with rclone from cron:

```bash
docker run --rm -v streamzw-prod_backups:/b -v ~/.config/rclone:/config/rclone rclone/rclone \
  copy /b remote:streamzw-backups
```

Videos live in the `minio-data` volume; mirror it too (`mc mirror`) or use a snapshot of the
disk. To restore the database:

```bash
$C stop api
$C exec -T postgres pg_restore -U streamzw -d streamzw --clean --if-exists < streamzw-YYYYMMDDTHHMMZ.dump
$C start api
```

Test a restore on a scratch server before launch.

## 10. Operating it

- Logs: `$C logs -f api` (structured JSON via pino), `$C logs -f nginx`.
- Health: `https://api.DOMAIN/health` checks the database and Redis. Point an uptime monitor at it.
- MinIO console: `ssh -L 9001:localhost:9001 server`, then http://localhost:9001.
- Disk: watch `minio-data` and `backups`; alert at 80%.

## 11. Before taking real money

These are the known gaps, from `docs/REVIEW.md`. Each needs a decision or a partner, not just code:

- **EcoCash merchant API**: endpoint paths are placeholders until the official spec
  arrives. Test against the EcoCash sandbox, then with real small payments.
- **ZIPIT** needs a bank or aggregator partner. It is refused at checkout until then.
- **Card subscriptions don't auto-renew** yet (needs Paystack stored authorizations).
- **Notifications** (payment receipts, payouts) are not built yet.
- **BunnyCDN and Paystack** follow their documented APIs but are untested against live accounts.
- **Load**: run a load test of `/videos`, playback grants and heartbeats on the production
  server size before a launch campaign.
