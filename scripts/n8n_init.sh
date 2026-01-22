#!/bin/sh
# scripts/n8n_init.sh
#
# Goal:
# - Ensure the n8n DB schema exists (workflow_entity table, etc.)
# - Import a workflow JSON if it does not already exist
# - Mark EXACTLY ONE matching workflow as active (the most recently updated)
# - Exit successfully so the main n8n service can start
#
# Why we boot n8n once here:
# - On a fresh database, Postgres tables do not exist until n8n runs its migrations.
# - If we try to query workflow_entity before migrations, we get:
#   "relation workflow_entity does not exist"
#
# Uses documented n8n CLI commands:
# - n8n import:workflow
# - n8n update:workflow
# n8n docs: https://docs.n8n.io/hosting/cli-commands/

set -eu

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

# -------------------------------
# Required inputs (from .env / compose)
# -------------------------------
: "${WF_NAME:?WF_NAME is required (must match the workflow name inside the JSON)}"
: "${WF_JSON_PATH:?WF_JSON_PATH is required (path to workflow JSON inside container)}"

# DB vars are required by n8n itself, but we also use them for psql checks
: "${DB_POSTGRESDB_HOST:?}"
: "${DB_POSTGRESDB_PORT:?}"
: "${DB_POSTGRESDB_DATABASE:?}"
: "${DB_POSTGRESDB_USER:?}"
: "${DB_POSTGRESDB_PASSWORD:?}"

export PGPASSWORD="$DB_POSTGRESDB_PASSWORD"

# -------------------------------
# 1) Wait for Postgres readiness
# -------------------------------
log "⏳ Waiting for Postgres..."
until pg_isready -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" >/dev/null 2>&1; do
  sleep 1
done
log "✅ Postgres is ready."

# -------------------------------
# 2) Ensure n8n schema exists by starting n8n once (migrations)
# -------------------------------
log "🚀 Booting n8n once to run DB migrations (schema creation)..."

# Start n8n in the background. We don't publish ports from this container.
# The purpose is ONLY: migrations -> create tables.
n8n start >/tmp/n8n-init-start.log 2>&1 &
N8N_PID="$!"

# Wait for n8n health endpoint. n8n exposes /healthz.
# We keep this conservative and retry for ~90 seconds.
log "⏳ Waiting for n8n /healthz..."
i=0
until curl -fsS "http://127.0.0.1:${N8N_PORT:-5678}/healthz" >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 90 ]; then
    log "❌ n8n did not become healthy in time. Last logs:"
    tail -n 200 /tmp/n8n-init-start.log || true
    kill "$N8N_PID" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 1
done
log "✅ n8n is healthy (migrations should be complete)."

# Stop the background n8n started for migrations.
log "🛑 Stopping the temporary n8n process..."
kill "$N8N_PID" >/dev/null 2>&1 || true
wait "$N8N_PID" >/dev/null 2>&1 || true
log "✅ Temporary n8n stopped."

# -------------------------------
# 3) Check if workflow exists; import if missing
# -------------------------------
log "🔎 Checking if workflow exists (name='$WF_NAME')..."

EXISTS_COUNT="$(psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
  -c "SELECT COUNT(*) FROM workflow_entity WHERE name = '$(printf "%s" "$WF_NAME" | sed "s/'/''/g")';")"

if [ "${EXISTS_COUNT:-0}" = "0" ]; then
  if [ ! -f "$WF_JSON_PATH" ]; then
    log "❌ Workflow JSON not found at: $WF_JSON_PATH"
    exit 1
  fi

  log "⬆️ Importing workflow from: $WF_JSON_PATH"
  n8n import:workflow --input="$WF_JSON_PATH"
  log "✅ Import complete."
else
  log "✅ Workflow already exists ($EXISTS_COUNT row(s)); skipping import."
fi

# -------------------------------
# 4) Choose ONE "winner" workflow row and activate it
# -------------------------------
# Note: In Postgres, n8n columns are camelCase, like "updatedAt".
# We pick the most recently updated row if duplicates exist.
WINNER_ID="$(psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -tA \
  -c "SELECT id FROM workflow_entity WHERE name = '$(printf "%s" "$WF_NAME" | sed "s/'/''/g")' ORDER BY \"updatedAt\" DESC NULLS LAST LIMIT 1;")"

if [ -z "$WINNER_ID" ]; then
  log "❌ Could not find the workflow after import/check. Aborting."
  exit 1
fi

log "🏁 Winner workflow id: $WINNER_ID"

# Deactivate all workflows with that name (DB-level cleanup),
# then activate the winner using the documented CLI command.
# The CLI docs state changes take effect after restart.
# Since the main n8n container starts AFTER this init job, it will load it as active.
log "🧹 Deactivating any duplicate workflows with the same name..."
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" -v ON_ERROR_STOP=1 \
  -c "UPDATE workflow_entity SET active=false WHERE name = '$(printf "%s" "$WF_NAME" | sed "s/'/''/g")';" >/dev/null

log "✅ Activating winner workflow via n8n CLI..."
n8n update:workflow --id="$WINNER_ID" --active=true

log "📌 Current rows for '$WF_NAME':"
psql -h "$DB_POSTGRESDB_HOST" -p "$DB_POSTGRESDB_PORT" -U "$DB_POSTGRESDB_USER" -d "$DB_POSTGRESDB_DATABASE" \
  -c "SELECT id, name, active FROM workflow_entity WHERE name = '$(printf "%s" "$WF_NAME" | sed "s/'/''/g")';" || true

log "✅ Init completed successfully."
exit 0
