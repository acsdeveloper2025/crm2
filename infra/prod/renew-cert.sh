#!/usr/bin/env bash
# =============================================================================
# CRM2 Let's Encrypt renewal (INFRASTRUCTURE-03, docs/audit/13-infrastructure.md).
#
# deploy.sh only ever CHECKS the cert exists — nothing in this repo renewed it. This
# script closes that gap: it runs `certbot renew` via the SAME webroot the edge nginx
# already serves `/.well-known/acme-challenge/` from (the `certbot_webroot` named
# volume declared in docker-compose.yml — a one-shot container attached to that volume,
# same pattern as the `migrate`/`minio-init` services), then reloads nginx so a renewed
# cert takes effect without a full redeploy.
#
# Install (run once on the box, NOT part of this repo's CI — cron ordering across
# machines shouldn't be code-review-gated the way the deploy path is):
#   sudo crontab -e
#   # renews only within Let's Encrypt's ~30-day-before-expiry window; safe to run daily
#   0 3 * * * /opt/crm2/app/infra/prod/renew-cert.sh >> /var/log/crm2-cert-renew.log 2>&1
#
# Idempotent: certbot no-ops (exit 0) outside the renewal window. Never mutates
# docker-compose.yml or nginx.conf — cert files land in the pre-existing
# /etc/letsencrypt bind mount both `edge` and this script share.
# =============================================================================
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-crm2}"
WEBROOT_VOLUME="${COMPOSE_PROJECT}_certbot_webroot"
DOMAIN="${DOMAIN:-crm.allcheckservices.com}"

log(){ printf '\033[34m▸\033[0m %s\n' "$*"; }

log "certbot renew ($DOMAIN) via webroot volume $WEBROOT_VOLUME"
docker run --rm \
  -v "${WEBROOT_VOLUME}:/var/www/certbot" \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot renew \
  --webroot -w /var/www/certbot \
  --quiet --no-random-sleep-on-renew

# Reload (not restart) — picks up a renewed cert with zero connection drops. No-op,
# harmless exit-0 if certbot didn't actually renew anything this run.
if docker exec crm2_edge nginx -s reload 2>/dev/null; then
  log "nginx reloaded"
else
  log "crm2_edge not running or reload failed — cert renewed on disk regardless; next deploy/restart picks it up"
fi
