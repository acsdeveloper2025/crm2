#!/usr/bin/env bash
# =============================================================================
# CRM2 production deploy — runs ON the box, invoked by the GH Actions workflow
# over SSH. Green/red model with auto-rollback:
#
#   green  → new image is healthy end-to-end (HTTPS edge + API health) → keep it
#   red    → health gate fails → roll the api+edge back to the previous image
#            tag and exit non-zero (the workflow surfaces the failure)
#
# db + minio are stable singletons (named volumes) and are never rolled back.
# Idempotent: re-runs cleanly. Secrets come ONLY from $ENV_FILE (never logged).
# =============================================================================
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/crm2/app}"
COMPOSE_FILE="$REPO_DIR/infra/prod/docker-compose.yml"
ENV_FILE="${ENV_FILE:-/opt/crm2/secrets/.env.prod}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/acsdeveloper2025}"
HEALTH_URL="https://crm.allcheckservices.com/api/v2/health"
EDGE_URL="https://crm.allcheckservices.com/_edge_health"

log(){ printf '\033[34m▸\033[0m %s\n' "$*"; }
ok(){  printf '  \033[32m✓\033[0m %s\n' "$*"; }
die(){ printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

export IMAGE_TAG IMAGE_REGISTRY ENV_FILE

log "deploy.sh — IMAGE_TAG=$IMAGE_TAG REGISTRY=$IMAGE_REGISTRY"

# ---- Preconditions ---------------------------------------------------------
[ -f "$COMPOSE_FILE" ] || die "compose file missing: $COMPOSE_FILE"
[ -f "$ENV_FILE" ]     || die "env file missing: $ENV_FILE"
[ -f "/etc/letsencrypt/live/crm.allcheckservices.com/fullchain.pem" ] || die "TLS cert missing"
ok "preconditions OK"

cd "$REPO_DIR"
log "sync repo"
git fetch --quiet origin
git reset --hard origin/main
ok "repo at $(git rev-parse --short HEAD)"

# Compose reads $ENV_FILE via --env-file for ${POSTGRES_*}/${S3_*}/${DATABASE_URL}
# interpolation — do NOT `source` it in the shell (values like MAIL_FROM contain
# '<' '>' which bash would parse as redirections). IMAGE_TAG/IMAGE_REGISTRY are
# exported above and take precedence in Compose's interpolation.
dc(){ docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ---- Capture the currently-running api tag (rollback target) ---------------
PREV_TAG="$(docker inspect --format '{{.Config.Image}}' crm2_api 2>/dev/null | sed 's/.*://' || true)"
[ -n "$PREV_TAG" ] && log "previous api tag: $PREV_TAG (rollback target)" || log "no running api (first deploy)"

# ---- Pull + bring up (migrate runs as a gated one-shot) --------------------
log "pull images @ $IMAGE_TAG"
dc pull
log "compose up -d"
dc up -d --remove-orphans
ok "stack up"

# ---- Health gate -----------------------------------------------------------
log "health gate (max 180s): $EDGE_URL + $HEALTH_URL"
deadline=$(( $(date +%s) + 180 )); healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS --max-time 8 -o /dev/null "$EDGE_URL" \
     && curl -fsS --max-time 8 "$HEALTH_URL" | grep -q '"status":"ok"'; then
    healthy=1; break
  fi
  sleep 5
done

if [ "$healthy" = "1" ]; then
  ok "GREEN — edge + api healthy at $IMAGE_TAG"
  # Prune ALL unused images older than 72h, not just dangling ones — every deploy pulls a fresh tagged
  # `crm2-api:<sha>` (~2 GB) that `prune -f` (dangling-only) never reclaimed, so they accumulated and once
  # filled the disk to 100% (postgres then crash-looped on a failed checkpoint). `-a` reclaims the old tags;
  # the `until=72h` window keeps the last few deploys (incl. the running + rollback images) intact.
  log "prune unused images older than 72h (keep recent for rollback)"
  docker image prune -af --filter "until=72h" >/dev/null || true
  ok "deploy complete"
  exit 0
fi

# ---- RED → rollback --------------------------------------------------------
printf '  \033[31m✗ RED — health gate failed at %s\033[0m\n' "$IMAGE_TAG" >&2
if [ -n "$PREV_TAG" ]; then
  log "rolling back api+edge → $PREV_TAG"
  IMAGE_TAG="$PREV_TAG" dc up -d --no-deps api edge || true
  die "rolled back to $PREV_TAG (deploy of $IMAGE_TAG aborted)"
else
  die "no previous tag to roll back to (first deploy failed) — stack left up for inspection"
fi
