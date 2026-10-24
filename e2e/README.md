# End-to-end tests

Browser journeys against a running stack with the demo catalogue: every niche browses,
a course plays over HLS, a viewer buys a pay-once lesson with (simulated) EcoCash, and a
creator builds and publishes a course. They run at phone and desktop sizes.

```bash
# 1. Stack: Postgres, Redis, S3 storage with both buckets (see the root README).
# 2. API with dev OTP logging + simulated payments, output captured for the OTP reader:
DEV_LOG_OTP=true DEV_SIMULATE_PAYMENTS=true OTP_RATE_LIMIT=off \
  pnpm --filter api dev > /tmp/streamzw-api.log 2>&1 &
# 3. Web with the simulate button:
NEXT_PUBLIC_DEV_SIMULATE_PAYMENTS=true pnpm --filter web dev &
# 4. Demo content (once):
pnpm --filter api seed:demo
# 5. Run:
E2E_API_LOG=/tmp/streamzw-api.log pnpm e2e
```

`E2E_BASE_URL` (default http://localhost:3030) and `E2E_API_URL` (default
http://localhost:3001) point the tests elsewhere, e.g. at staging.

Headless Chromium has no H.264 decoder, so the tests prove playback by fetching the HLS
master playlist, a rendition and a segment through the granted URL rather than by
watching frames render.
