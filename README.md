# Staffbotics n8n (Workflow-as-Code) — Patient Grouping Pipeline

This repo provides a **portable, deterministic n8n deployment** (Docker Compose) plus a **version-controlled workflow** (`./workflows/staffbotics.json`) and a small **helper library** (`./src/`) used by n8n Function nodes.

**One command brings the system up from scratch:**

```bash
docker compose up --build
```

On any machine (laptop, server, CI runner), the stack converges to the same working state:

- Postgres running (persistent volume)
- n8n running
- Workflow imported from `./workflows/staffbotics.json` (if missing)
- Exactly one workflow with `WF_NAME` marked **active**
- Production webhooks registered and listening:
  - `POST /webhook/staffbotics-batch`
  - `POST /webhook/staffbotics-reorg`

No UI steps required to import or activate the workflow.

---

## Purpose (and safety boundaries)

This pipeline turns messy bulk clinical inputs (Excel rows, PDFs, folders, mixed formats) into **clean per-patient bundles** for downstream processing.

**Scope is structural only**:
- ✅ Group/organize by identifiers, filename patterns, folders, or Excel columns
- ✅ Provide confidence and quarantine ambiguous groupings
- ❌ No clinical inference
- ❌ No entity extraction beyond simple identifiers (ID, name, DOB) used for grouping

The LLM is used **only** to choose a grouping strategy/config (a constrained JSON object), while the grouping execution is deterministic.

---

## Quick start

### 1) Requirements
- Docker + Docker Compose

### 2) Create a `.env`
Create `./.env` (Compose auto-loads it). Minimum:

```dotenv
# Required
N8N_ENCRYPTION_KEY=replace-with-a-long-random-string
WF_NAME=Staffbotics Patient Grouping (MVP)

# Optional (defaults shown)
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=n8n
N8N_PORT=5678
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_EDITOR_BASE_URL=http://localhost:5678

# Optional: enable basic auth for the editor + /rest endpoints
# (If you set these, poststart toggle will authenticate to /rest/*)
N8N_BASIC_AUTH_USER=
N8N_BASIC_AUTH_PASSWORD=

# Needed by the workflow nodes that call OpenAI
OPENAI_API_KEY=
```

**Important:** keep `N8N_ENCRYPTION_KEY` stable across machines/redeploys if you ever add credentials in the UI.

### 3) Run
```bash
docker compose up --build
```

n8n UI: `http://localhost:5678`

### 4) Test the production webhook (no “Execute Workflow” needed)
```bash
curl -X POST "http://localhost:5678/webhook/staffbotics-batch" \
  -H "Content-Type: application/json" \
  --data-binary @data/example_payload.json
```

If working, you’ll get a JSON response containing:
- `patientCandidates[]`
- `confidence` + `status` (`ready` or `quarantine`)
- a human-readable `summary`

---

## What “workflow-as-code” means here

n8n has two different “states”:

1) **Workflow exists in DB** (imported)
2) **Workflow routes are registered in the running server** (only happens when workflow is *active* and loaded)

A workflow can exist in Postgres but still return:

```json
{"message":"The requested webhook ... is not registered"}
```

To make this deterministic, the stack uses a **boot pipeline**:

1. Postgres becomes healthy
2. `n8n-init` runs migrations, imports workflow if missing, and ensures it’s active
3. Main `n8n` server starts and loads active workflows → registers `/webhook/*`
4. `n8n-poststart-toggle` optionally toggles active off/on via REST to force route re-registration (workaround for edge-case startup bugs)

---

## Repo layout

```
staffbotics_n8n/
├─ docker-compose.yml
├─ Dockerfile
├─ workflows/
│  └─ staffbotics.json
├─ scripts/
│  ├─ n8n_init.sh
│  ├─ n8n_poststart_toggle.sh
│  └─ reset_db.sh
├─ src/
│  ├─ index.js
│  ├─ ingestion/
│  ├─ identity/
│  ├─ grouping/
│  ├─ operations/
│  └─ summary/
└─ data/
   ├─ example_payload.json
   └─ sample_batch_1/
```

---

## Docker services (compose)

### `db` (Postgres)
- Runs Postgres 14
- Stores data in `db_data` volume
- Healthcheck gates the rest of the stack

### `n8n-init` (one-shot)
- Runs `scripts/n8n_init.sh`
- Responsibilities:
  - Wait for Postgres
  - Trigger/ensure n8n migrations (schema creation)
  - Enforce DB defaults needed for stable imports (guards against schema drift)
  - Import workflow if missing
  - Ensure **exactly one** workflow row named `WF_NAME` is active (winner = latest `updatedAt`)

### `n8n` (long-running server)
- Real n8n runtime
- Loads active workflows and registers production webhooks
- Persists n8n home directory in `n8n_data` volume

### `n8n-poststart-toggle` (one-shot)
- Runs `scripts/n8n_poststart_toggle.sh`
- Responsibilities:
  - Wait for n8n `/healthz`
  - Lookup workflow ID in Postgres by `WF_NAME`
  - Toggle workflow active off/on via REST (`PATCH /rest/workflows/:id`)
  - Optionally probe `/webhook/<path>` and fail if it still reports “not registered”

---

## Scripts (important)

All scripts live in `./scripts/` and are baked into the image at `/data/scripts/`.

### `scripts/n8n_init.sh`
**Deterministic bootstrap (pre-server).**

What it does:
1. Waits for Postgres readiness
2. Starts `n8n` briefly and waits for `/healthz` (forces migrations)
3. Verifies `workflow_entity` is queryable
4. **Enforces DB defaults** required by `n8n import:workflow` in some n8n versions  
   (e.g., `workflow_entity.active`, `workflow_entity.versionId`)
5. Stops the temporary n8n process
6. Imports `WF_JSON_PATH` if a workflow named `WF_NAME` does not exist
7. Picks the “winner” workflow row (`ORDER BY updatedAt DESC`) and ensures:
   - all rows with that name are deactivated
   - winner is activated via `n8n update:workflow --active=true`

Why it exists:
- avoids UI/manual import
- ensures clean convergence after DB wipes / volume deletes
- prevents “workflow exists but inactive” states

### `scripts/n8n_poststart_toggle.sh`
**Forces webhook route registration in the running server.**

What it does:
1. Waits for n8n `/healthz` on the internal docker network
2. Finds workflow ID in Postgres by `WF_NAME`
3. Calls:
   - `PATCH /rest/workflows/:id {"active": false}`
   - `PATCH /rest/workflows/:id {"active": true}`
4. Optionally probes the production webhook URL and fails if it still returns “not registered”

Why it exists:
- some n8n versions occasionally fail to register webhook routes on startup even when DB says active=true
- the “toggle” emulates the UI action that re-registers routes

### `scripts/reset_db.sh`
Currently empty in this repo. Suggested usage:
- add a helper script to stop the stack and remove volumes for a full clean slate, e.g.:

```bash
docker compose down -v
```

(Keep in mind: deleting volumes deletes your Postgres DB and n8n home state.)

---

## The workflow (what it does)

Workflow file: `workflows/staffbotics.json`  
Workflow name must match `WF_NAME` in `.env`.

### Webhooks
- `POST /webhook/staffbotics-batch`
  - Ingest payload → normalize to `RawItem[]`
  - Heuristic analysis (Excel columns, folder structure)
  - LLM chooses grouping config (constrained JSON)
  - Deterministic grouping
  - Summary response

- `POST /webhook/staffbotics-reorg`
  - Receives prior state + user instruction
  - LLM converts instruction to a constrained operations array
  - Deterministic operations applied (merge/reassign/strategy note)

---

## Helper library (`src/`)

The repo includes a small JS library used by Function nodes via:

```js
require("staffbotics-helpers")
```

Exports (see `src/index.js`):
- ingestion:
  - `buildRawItemsFromWebhookBody`
  - `buildHeuristicAnalysis`
- grouping:
  - `autoGroup`
  - `extractIdentifiersFromRow`
- operations:
  - `applyOperations`
- summary:
  - `summarizeProposal`
- identity helpers (optional):
  - `normText`, `normId`, `normDate`, `buildPatientKey`, filename matching helpers

---

## Example input

See: `data/example_payload.json`

```json
{
  "excelFiles": [
    {
      "name": "patients.xlsx",
      "rows": [
        { "Name": "John Doe", "NHC": "1234", "Age": 59 },
        { "Name": "Anna Smith", "NHC": "1235", "Age": 71 }
      ]
    }
  ],
  "files": [
    { "path": "sample_batch_1/1234_scan.pdf", "filename": "1234_scan.pdf" },
    { "path": "sample_batch_1/1234_report.pdf", "filename": "1234_report.pdf" },
    { "path": "sample_batch_1/1235_report.pdf", "filename": "1235_report.pdf" }
  ]
}
```

---

## Troubleshooting

### “Webhook is not registered”
- Wait for `n8n-poststart-toggle` to complete (it runs once per start)
- Check logs:
  ```bash
  docker compose logs -f n8n n8n-poststart-toggle
  ```

### Import errors about NOT NULL columns (e.g. `active`, `versionId`)
- This repo applies schema guards in `scripts/n8n_init.sh`
- For best determinism, **pin** the n8n image version instead of using `n8nio/n8n:latest`

### Full reset
Deletes Postgres + n8n home state:

```bash
docker compose down -v
docker compose up --build
```

---

## Notes on credentials / “seed”
This repo achieves **workflow-as-code bring-up** (workflow present + active + webhooks listening).

If you want to preserve UI state like:
- credentials / API keys created in UI
- users/projects/settings

…you need either:
- a DB snapshot/seed strategy, or
- scripted credential export/import

---

## Contact
Lead: **Joan Ficapal Vila**  
Company: **Athena Tech & Staffbotics**
