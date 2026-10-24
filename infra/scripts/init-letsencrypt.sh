#!/usr/bin/env bash
# First-time TLS for a fresh server. nginx won't start without a certificate, and
# Let's Encrypt won't issue one until nginx answers the HTTP challenge — so start nginx
# on a throwaway self-signed cert, get the real one, then reload.
#
# Usage (from the repo root, DNS for $DOMAIN, api.$DOMAIN and media.$DOMAIN already
# pointing at this server):
#   bash infra/scripts/init-letsencrypt.sh you@example.com
# On the live server (one host, LIVE_DOMAIN):
#   ENV_FILE=infra/live/.env.live COMPOSE_FILE=infra/live/docker-compose.live.yml \
#   DOMAIN_VAR=LIVE_DOMAIN HOSTS=single bash infra/scripts/init-letsencrypt.sh you@example.com
set -euo pipefail

EMAIL="${1:?usage: init-letsencrypt.sh <email for expiry notices>}"
ENV_FILE="${ENV_FILE:-infra/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
DOMAIN_VAR="${DOMAIN_VAR:-DOMAIN}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
DOMAIN="$(grep -E "^${DOMAIN_VAR}=" "$ENV_FILE" | cut -d= -f2-)"
[ -n "$DOMAIN" ] || { echo "$DOMAIN_VAR is not set in $ENV_FILE" >&2; exit 1; }
if [ "${HOSTS:-}" = "single" ]; then
  CERT_ARGS=(-d "$DOMAIN")
else
  CERT_ARGS=(-d "$DOMAIN" -d "api.$DOMAIN" -d "media.$DOMAIN")
fi
LIVE="/etc/letsencrypt/live/$DOMAIN"

echo "→ Temporary self-signed certificate for $DOMAIN"
"${COMPOSE[@]}" run --rm --entrypoint /bin/sh certbot -c "
  mkdir -p '$LIVE' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout '$LIVE/privkey.pem' -out '$LIVE/fullchain.pem' -subj '/CN=localhost'"

echo "→ Starting nginx"
"${COMPOSE[@]}" up -d --no-deps nginx

echo "→ Removing the temporary certificate"
"${COMPOSE[@]}" run --rm --entrypoint /bin/sh certbot -c "
  rm -rf '/etc/letsencrypt/live/$DOMAIN' '/etc/letsencrypt/archive/$DOMAIN' \
         '/etc/letsencrypt/renewal/$DOMAIN.conf'"

echo "→ Requesting the real certificate"
"${COMPOSE[@]}" run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
  "${CERT_ARGS[@]}"

echo "→ Reloading nginx"
"${COMPOSE[@]}" exec nginx nginx -s reload
echo "Done. Certificates renew automatically (certbot service)."
