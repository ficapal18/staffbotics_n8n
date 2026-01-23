#!/bin/sh
# scripts/n8n_init.sh
#
# Goal (pre-server):
# - Wait for Postgres
# - Trigger n8n migrations (create tables)
# - Import the workflow JSON if missing
# - Ensure exactly one workflow row with WF_NAME is active=true (winner = latest updatedAt)
#
# Important:
# - This does NOT guarantee production webhooks are registered yet.
#   Webhook registration happens inside the running server process.
#   The post-start toggle script handles the #21614-style edge case. :contentReference[oaicite:2]{index=2}
#
# Uses n8n CLI commands:
# - n8n import:workflow
# - n8n update:workflow

set -eu

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

: "${WF_NAME:?WF_NAME is required (must match workflow JSON name)}"
: "${WF_JSON_PATH:?WF_JSON_PATH is required}"
: "${DB_POSTGRESDB_HOST:?}"
: "${DB_POSTGRESDB_PORT:?}"
: "${DB_POSTGRESDB_DATABASE:?}"
: "${DB_POSTGRESDB_USER:?}"
: "${DB_POSTGRESDB_PASSWORD:?}"

export PGPASSWORD="$DB_POSTGRESDB_PASSWORD"

log "⏳ Waiting for Postgres..."
until pg_isready -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" >/dev/null 2>&1; do
  sleep 1
done
log "✅ Postgres is ready."

# ---- Run migrations by briefly starting n8n ----
log "🧱 Running n8n migrations bootstrap (start/healthz/stop)..."
n8n start >/tmp/n8n-init-start.log 2>&1 &
N8N_PID="$!"

log "⏳ Waiting for n8n /healthz..."
i=0
until curl -fsS "http://127.0.0.1:${N8N_PORT:-5678}/healthz" >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 180 ]; then
    log "❌ n8n did not become healthy in time. Last logs:"
    tail -n 200 /tmp/n8n-init-start.log || true
    kill "$N8N_PID" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 1
done
log "✅ n8n is healthy. Verifying schema exists..."

# Make sure workflow_entity exists now
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
  -c "SELECT 1 FROM workflow_entity LIMIT 1;" >/dev/null 2>&1 || {
    log "❌ workflow_entity still not queryable after migrations bootstrap."
    kill "$N8N_PID" >/dev/null 2>&1 || true
    exit 1
  }

log "✅ Schema present (workflow_entity is queryable)."

# ---- Workaround for n8n import regressions / schema drift ----
# Some n8n versions (especially when using :latest) can end up with:
# - workflow_entity has new NOT NULL columns (e.g. active, versionId)
# - but import:workflow inserts DEFAULT for them
# If the DB column has NO DEFAULT, Postgres will insert NULL -> violates NOT NULL.
#
# We make the schema deterministic here:
# - ensure required columns have DEFAULTs
# - backfill any existing NULLs defensively
log "🩹 Ensuring workflow_entity defaults exist (prevents NULLs on import)..."
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
-- Needed for gen_random_uuid() on Postgres 14 in many images
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- active: import uses DEFAULT; enforce safe default + backfill
ALTER TABLE workflow_entity
  ALTER COLUMN active SET DEFAULT false;
UPDATE workflow_entity
  SET active = false
  WHERE active IS NULL;

-- versionId: import uses DEFAULT; enforce safe default + backfill
-- We store as text because n8n commonly uses string IDs; gen_random_uuid() is good enough here.
ALTER TABLE workflow_entity
  ALTER COLUMN "versionId" SET DEFAULT gen_random_uuid()::text;
UPDATE workflow_entity
  SET "versionId" = gen_random_uuid()::text
  WHERE "versionId" IS NULL;
SQL
log "✅ workflow_entity defaults enforced."

log "🛑 Stopping temporary n8n (migrations done)..."
kill "$N8N_PID" >/dev/null 2>&1 || true
wait "$N8N_PID" >/dev/null 2>&1 || true
log "✅ Temporary n8n stopped."

# ---- import if missing ----
WF_ESCAPED="$(printf "%s" "$WF_NAME" | sed "s/'/''/g")"

log "🔎 Checking if workflow exists (name='$WF_NAME')..."
EXISTS_COUNT="$(
  psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
    -c "SELECT COUNT(*) FROM workflow_entity WHERE name='${WF_ESCAPED}';"
)"

if [ "${EXISTS_COUNT:-0}" = "0" ]; then
  [ -f "$WF_JSON_PATH" ] || { log "❌ Missing workflow JSON at $WF_JSON_PATH"; exit 1; }
  log "⬆️ Importing workflow from: $WF_JSON_PATH"
  n8n import:workflow --input="$WF_JSON_PATH"
  log "✅ Import complete."
else
  log "✅ Workflow already exists ($EXISTS_COUNT row(s)); skipping import."
fi

# ---- choose winner and activate ----
WINNER_ID="$(
  psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
    -c "SELECT id FROM workflow_entity WHERE name='${WF_ESCAPED}' ORDER BY \"updatedAt\" DESC NULLS LAST LIMIT 1;"
)"

[ -n "$WINNER_ID" ] || { log "❌ Could not find workflow after import/check."; exit 1; }

log "🏁 Winner workflow id: $WINNER_ID"

log "🧹 Deactivating any duplicates with same name..."
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -v ON_ERROR_STOP=1 \
  -c "UPDATE workflow_entity SET active=false WHERE name='${WF_ESCAPED}';" >/dev/null

log "✅ Activating winner workflow via n8n CLI..."
n8n update:workflow --id="$WINNER_ID" --active=true

log "📌 Current rows for '$WF_NAME':"
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" \
  -c "SELECT id, name, active, \"versionId\", \"updatedAt\" FROM workflow_entity WHERE name='${WF_ESCAPED}';" || true

log "✅ Init completed successfully."
