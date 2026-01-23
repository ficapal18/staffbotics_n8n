#!/bin/sh
# scripts/n8n_poststart_toggle.sh
#
# PURPOSE
# -------
# Work around an n8n failure mode where:
# - The workflow is active in the DB (active=true)
# - n8n logs may even say "Activated workflow ..."
# BUT:
# - Production webhook URL /webhook/<path> returns:
#     {"code":404,"message":"The requested webhook \"POST <path>\" is not registered.", ...}
#
# WHY THIS HAPPENS (PRACTICAL VIEW)
# -------------------------------
# Webhook routes are registered INSIDE the running n8n server process.
# If something goes wrong during startup registration, you can end up with:
# - DB says active=true
# - server didn't register the route
#
# WHAT THIS SCRIPT DOES
# ---------------------
# 1) Wait until the main n8n server is healthy (/healthz)
# 2) Lookup workflow ID by WF_NAME directly in Postgres (winner = latest updatedAt)
# 3) Toggle activation "off then on" using the same REST endpoint the editor uses:
#      PATCH /rest/workflows/:id  {"active":false}
#      PATCH /rest/workflows/:id  {"active":true}
#    This forces the running server to re-register the webhooks.
# 4) Optionally verify the webhook no longer returns the "not registered" 404
#
# REQUIREMENTS
# ------------
# Inside the container image:
# - curl
# - psql client
#
# Required environment variables:
# - WF_NAME
# - DB_POSTGRESDB_HOST, DB_POSTGRESDB_PORT, DB_POSTGRESDB_DATABASE, DB_POSTGRESDB_USER, DB_POSTGRESDB_PASSWORD
# - N8N_INTERNAL_URL (e.g. http://n8n:5678)
#
# Optional environment variables:
# - N8N_BASIC_AUTH_USER, N8N_BASIC_AUTH_PASSWORD  (if /rest/* is protected by basic auth)
# - WEBHOOK_METHOD (default POST)
# - WEBHOOK_PATH (default staffbotics-batch)
#
# Exit codes:
# - 0 success (toggle done, webhook probe not "not registered")
# - 1 failure (can't reach health, can't find workflow, rest patch fails, still not registered)

set -eu

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

# -----------------------------
# Validate required env
# -----------------------------
: "${WF_NAME:?WF_NAME is required}"
: "${DB_POSTGRESDB_HOST:?DB_POSTGRESDB_HOST is required}"
: "${DB_POSTGRESDB_PORT:?DB_POSTGRESDB_PORT is required}"
: "${DB_POSTGRESDB_DATABASE:?DB_POSTGRESDB_DATABASE is required}"
: "${DB_POSTGRESDB_USER:?DB_POSTGRESDB_USER is required}"
: "${DB_POSTGRESDB_PASSWORD:?DB_POSTGRESDB_PASSWORD is required}"
: "${N8N_INTERNAL_URL:?N8N_INTERNAL_URL is required (e.g. http://n8n:5678)}"

export PGPASSWORD="$DB_POSTGRESDB_PASSWORD"

HEALTH_URL="${N8N_INTERNAL_URL%/}/healthz"

WEBHOOK_METHOD="${WEBHOOK_METHOD:-POST}"
WEBHOOK_PATH="${WEBHOOK_PATH:-staffbotics-batch}"
WEBHOOK_URL="${N8N_INTERNAL_URL%/}/webhook/${WEBHOOK_PATH}"

# If basic auth is set in compose, use it for /rest/* calls.
# (If your instance does not use basic auth, this becomes a no-op.)
BASIC_AUTH_ARGS=""
if [ -n "${N8N_BASIC_AUTH_USER:-}" ] && [ -n "${N8N_BASIC_AUTH_PASSWORD:-}" ]; then
  BASIC_AUTH_ARGS="-u ${N8N_BASIC_AUTH_USER}:${N8N_BASIC_AUTH_PASSWORD}"
fi

# -----------------------------
# 1) Wait for n8n health
# -----------------------------
log "⏳ Waiting for n8n healthz at: $HEALTH_URL"
i=0
until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 180 ]; then
    log "❌ n8n did not become healthy in time."
    exit 1
  fi
  sleep 1
done
log "✅ n8n is healthy."

# -----------------------------
# 2) Lookup workflow id (winner)
# -----------------------------
WF_ESCAPED="$(printf "%s" "$WF_NAME" | sed "s/'/''/g")"

WF_ID="$(
  psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
    -c "SELECT id
        FROM workflow_entity
        WHERE name='${WF_ESCAPED}'
        ORDER BY \"updatedAt\" DESC NULLS LAST
        LIMIT 1;"
)"

if [ -z "${WF_ID:-}" ]; then
  log "❌ Could not find workflow in DB by name='$WF_NAME'"
  exit 1
fi

log "🏁 Target workflow id: $WF_ID (name='$WF_NAME')"

# -----------------------------
# 3) Toggle active off/on via REST
# -----------------------------
REST_URL="${N8N_INTERNAL_URL%/}/rest/workflows/${WF_ID}"

rest_patch() {
  # Args:
  # - $1 workflow id
  # - $2 json payload
  id="$1"
  json="$2"
  url="${N8N_INTERNAL_URL%/}/rest/workflows/${id}"

  # -f: fail on HTTP >= 400
  # -sS: silent but show errors
  # BASIC_AUTH_ARGS included if defined
  curl -fsS \
    $BASIC_AUTH_ARGS \
    -X PATCH \
    -H "Content-Type: application/json" \
    -d "$json" \
    "$url" \
    >/dev/null
}

log "🔁 Toggling active=false via $REST_URL ..."
rest_patch "$WF_ID" '{"active":false}'

# Small pause so n8n processes the deactivation
sleep 1

log "🔁 Toggling active=true via $REST_URL ..."
rest_patch "$WF_ID" '{"active":true}'

log "✅ Toggled workflow via REST endpoint."

# -----------------------------
# 4) Verify webhook is registered
# -----------------------------
# We only verify that we are NOT getting the specific "not registered" 404.
# Your workflow may still return other errors depending on responseMode,
# missing nodes, auth, etc. That is separate from webhook registration.
log "🔎 Verifying webhook route with ${WEBHOOK_METHOD} ${WEBHOOK_URL}"

probe_body="$(curl -sS --max-time 6 \
  -X "$WEBHOOK_METHOD" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\n%{http_code}" \
  "$WEBHOOK_URL" || true
)"

http_code="$(printf "%s" "$probe_body" | tail -n 1)"
resp="$(printf "%s" "$probe_body" | sed '$d')"

if [ "$http_code" = "404" ] && printf "%s" "$resp" | grep -qi "not registered"; then
  log "❌ Still seeing 'not registered' for ${WEBHOOK_METHOD} ${WEBHOOK_PATH}"
  log "Response was: $resp"
  exit 1
fi

log "✅ Webhook does not return the 'not registered' 404 anymore."
log "Done."
exit 0
