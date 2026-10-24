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

## 12. Live server (infra/live)

Live runs on its **own box** so a 4K event never starves the API or VOD transcoding.
Creators publish RTMP or SRT to MediaMTX; the live worker turns the feed into an HLS ladder
(source copied when it is H.264, plus 2160/1440/1080/720/480/240p down to the source
height); nginx serves it with per-stream tokens; replays upload to the main MinIO.

```
OBS ──RTMP/SRT──▶ MediaMTX ──auth──▶ api /live/ingest/auth
                     │ runOnReady
                     ▼
              live worker (ffmpeg ladder) ──events──▶ api /live/ingest/streams/:id/*
                     │ HLS on disk                     ▲
                     ▼                                 │ grant (signed URL)
      nginx secure_link origin ◀── BunnyCDN pull zone ◀── viewers' players
                     │ on end: recording → MinIO (media.DOMAIN) → replay
```

**Sizing.** CPU encoding (libx264) needs roughly 4 cores per 1080p ladder; a 4K source with
the full ladder needs 16+ fast cores **or** an NVIDIA GPU (one modern card runs several 4K
ladders: set `LIVE_ENCODER=h264_nvenc` and uncomment the `deploy` block). Disk: a 4K event
writes about 13 GB/hour until its replay uploads. Upload bandwidth from the box only matters
for the CDN's first fetch of each segment.

**Viewers at scale go through BunnyCDN.** One origin can't serve thousands of 4K viewers
(25+ Mbps each). Create a pull zone with origin `https://LIVE_DOMAIN`, leave token
authentication **off** at Bunny (nginx checks tokens; the hourly shared expiry makes URLs
cacheable), and set `LIVE_PUBLIC_BASE` on the main stack to the pull zone URL. Playlists
are cached for 1 s, segments for a day.

**Setup.**

```bash
cp infra/live/.env.live.example infra/live/.env.live   # same LIVE_* secrets as the main stack
L="docker compose --env-file infra/live/.env.live -f infra/live/docker-compose.live.yml"
$L build
ENV_FILE=infra/live/.env.live COMPOSE_FILE=infra/live/docker-compose.live.yml \
  DOMAIN_VAR=LIVE_DOMAIN HOSTS=single bash infra/scripts/init-letsencrypt.sh ops@yourdomain
$L up -d
```

Firewall: 80, 443, 1935/tcp (RTMP), 8890/udp (SRT). On the main stack set `LIVE_DOMAIN`,
`LIVE_PUBLIC_BASE`, `LIVE_INGEST_SECRET` and `LIVE_SIGNING_SECRET` and redeploy the API.

**Check it end to end** before the first event: create a stream in `/studio/live`, publish a
test feed (OBS, or `ffmpeg -re -f lavfi -i testsrc2=size=3840x2160:rate=30 -f lavfi -i sine
-c:v libx264 -g 60 -c:a aac -f flv "rtmp://LIVE_DOMAIN/live/<id>?user=key&pass=<key>"`),
watch the control room show the feed, open the viewer page on a phone, then End stream and
confirm the replay appears within a few minutes.

**What creators should send:** H.264, keyframe every 2 s, CBR; 4K at 20–35 Mbps, 1080p at
6 Mbps. On mobile uplinks, SRT recovers from packet loss better than RTMP.
