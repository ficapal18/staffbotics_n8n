# Staffbotics Pipeline Dev

## 🔍 Purpose
This repository supports the development of the Staffbotics patient grouping pipeline. The goal is to process raw input data (excel rows, medical documents, folders) to produce structured groupings of patients for Athena Tech survival analysis. This grouping process is purely structural; **no clinical inference or entity recognition** should be done here - that part is already operational in Athena Tech.

The aim: automate ingestion of batch data and files, auto-detect grouping logic, allow human review and adjustment via natural language or UI, and feed structured patient bundles into downstream pipelines.

This pipeline turns messy, bulk clinical inputs (Excel files, PDFs, folders, mixed formats) into clean, per-patient data packages that can be reliably processed by downstream AI models. It first normalizes all inputs into a common internal format, analyzes their structure (rows, folders, filenames), and uses a constrained LLM only to choose a grouping strategy, not to extract data. The actual grouping is deterministic: Excel rows are merged into single patients using stable identity keys, files are safely attached using boundary-aware ID and name matching, and each resulting patient candidate is assigned a confidence score and explicit identity metadata.

Crucially, the pipeline is designed for safety and scale. Ambiguous or low-confidence groupings are automatically quarantined instead of silently propagated, while high-confidence patients are marked “ready” for automated ingestion. A second endpoint allows humans to correct grouping mistakes using natural language, which is translated into deterministic operations (merge, reassign) without breaking reproducibility. The result is a production-ready bulk ingestion layer that removes manual data entry bottlenecks, preserves trust, and prepares each patient package for reliable downstream extraction, survival modeling, and future database reconciliation.

---

## 🚀 Instructions to Use

### 1️⃣ Install Cursor
Download and install Cursor from:  
👉 https://cursor.com/

### 2️⃣ Create the repository folder and files
```bash
mkdir staffbotics_n8n
cd staffbotics_n8n
git init .
```

### 3️⃣ Launch Docker stack
```bash
docker compose up -d
```

### 4️⃣ Open the repository in Cursor
```bash
cursor .
```

### 5️⃣ Edit workflow using Cursor → then re-import into n8n. **From inside n8n container**:

### Ensure the API is enabled
In n8n UI:
Go to Settings → API

Enable API (if needed)
Create a new API Key
Copy it.
B) Put it into your .env
Add:
N8N_API_KEY=PASTE_YOUR_KEY_HERE

```bash
sh /data/scripts/import_overwrite.sh /data/workflows/staffbotics.json
```

### 7️⃣ Test the setup
Use drag-and-drop via a local upload form or send a JSON test payload to the webhook.

### Testing the Patient Grouping Pipeline

To test the bulk patient grouping workflow locally, start the n8n workflow in **Test** mode and use the test webhook endpoint.

1. Open the workflow in n8n and click **Execute Workflow**.
2. Copy the test webhook URL for the `Receive Batch (Webhook)` node  
   (e.g. `http://localhost:5678/webhook-test/staffbotics-batch`).
3. Send a sample payload:

```bash
curl -X POST "http://localhost:5678/webhook/staffbotics-batch" \
  -H "Content-Type: application/json" \
  --data-binary @data/example_payload.json
```

Do not use this one, use the one above
```bash
curl -X POST "http://localhost:5678/webhook-test/staffbotics-batch" \
  -H "Content-Type: application/json" \
  --data-binary @data/example_payload.json
```



If the workflow is working correctly, it will return a grouping proposal with one patient candidate per individual, correctly attached files, confidence scores, and a human-readable summary. Only candidates marked as status: "ready" should be considered safe for downstream processing.

########################################## We can delete from here down




## 📦 Repo Structure

```
/staffbotics-pipeline-dev
  ├─ src/                      # Reusable JavaScript/Python logic for grouping pipeline
  ├─ workflows/               # Exported n8n workflows (.json format)
  ├─ data/                    # Sample datasets for testing batch uploads
  ├─ db/                      # Postgres volume
  ├─ docker-compose.yml       # Local dev stack with n8n + PostgreSQL
  ├─ .env                     # Environment variables locally
  └─ README.md                # You are here



Ingress (ingestion) → Inspect (ingestion) → Decide (grouping) → Group (grouping) → Repair (operations) → Summarize (summary) → Fan-out later (execution)


src/
├── ingestion/
│   ├── rawItems.js          # Webhook payload → RawItem[]
│   ├── heuristics.js        # Structure inspection (Excel + folders)
│   └── index.js
│
├── identity/
│   ├── normalize.js         # Canonical normalization
│   ├── matching.js          # Cross-source matching
│   ├── patientKey.js        # Identity key logic (optional split)
│   └── index.js
│
├── grouping/
│   ├── grouping.js          # autoGroup (strategy orchestration)
│   ├── quarantine.js        # Rules & thresholds (can start inline)
│   └── index.js
│
├── operations/
│   ├── operations.js        # merge / reassign / strategy ops
│   └── index.js
│
├── summary/
│   ├── summary.js           # Human-readable output
│   └── index.js
│
└── index.js                 # Public API for n8n





```




---

## ⚙️ Development Stack

- **n8n** (workflow automation with UI) — runs locally via Docker
- **PostgreSQL** — for workflow persistence & future patient lookup
- **Cursor AI** — for source code editing, JSON workflow enhancements, and AI dev assistance
- **Docker Compose** — full local development orchestration
- **Ngrok (optional)** — if external webhook testing is required
- **HTML/React uploader page (optional)** — for drag-and-drop dataset input

---

## 🧠 Guidance for AI (Cursor) — Critical

When writing or modifying code:

> **You are assisting in development of the Staffbotics pipeline.**

### You MUST follow these rules:

- **Do not perform clinical inference or variable extraction — only structural grouping.**
- Group data using identifiers, file structure, folder names, filenames, or deterministic logic.
- Follow core pipeline architecture:
  1. Ingest inputs (Excel, PDFs, folders, etc.)
  2. Detect structure & suggest `GroupingConfig`
  3. Auto grouping into `PatientCandidate[]`
  4. Prompt user for reorganization (natural language allowed)
  5. Apply changes
  6. Emit structured output
- Use and preserve the following JSON data models:

```json
// RawItem
{
  "id": "excel1_row3",
  "source_type": "excel_row" | "file",
  "source_ref": "patients.xlsx#row_3",
  "metadata": { ... }
}
```

```json
// PatientCandidate
{
  "candidate_id": "cand_001",
  "inferred_key": "Excel row 3",
  "raw_items": [...],
  "confidence": 0.96,
  "notes": []
}
```

```json
// GroupingConfig
{
  "unit_strategy": "excel_row" | "subfolder" | "id_in_filename" | "llm_assisted",
  "excel": { "file": "...", "row_is_patient": true, "id_column": "..."},
  "folder": { "use_subfolders_as_patients": true, "id_patterns": ["\d{4}"] }
}
```

🧪 Prefer deterministic logic first (folders, filename patterns, excel ID columns). Only use AI matching for structure suggestion or fallback grouping.

⚠️ Never infer medical content. Only structure and group.

---

## 🚀 Local Development Workflow

### 🟢 Start system

```bash
docker compose up -d
```

Access UI at:  
👉 http://localhost:5678  
(Default credentials if enabled: `admin` / `admin`)

---

## 🔁 Workflow Iteration (with Cursor)

```bash
# Export workflow (from n8n UI to local file)
docker exec n8n n8n export-workflow --id <workflowId> --output /data/workflows/patient-grouping.json

# Edit JSON in Cursor (AI assistance enabled)
cursor .

# After editing
docker exec n8n n8n import-workflow --input /data/workflows/patient-grouping.json
```

Then refresh the UI.

---

## 📂 Testing Data Upload via Drag & Drop

Create a local HTML file (eg. `uploader.html`):

```html
<!DOCTYPE html>
<html>
<body>
  <h3>Upload Dataset</h3>
  <form action="http://localhost:5678/webhook/staffbotics-batch" method="POST" enctype="multipart/form-data">
    <input type="file" name="batchFiles" webkitdirectory directory multiple />
    <button type="submit">Send</button>
  </form>
</body>
</html>
```

Open in browser, drag the folder with test files → submit.

---

## 🧪 Example Input Structure (JSON via REST test)

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
    { "path": "batch/1234_report.pdf", "filename": "1234_report.pdf" },
    { "path": "batch/1234_scan.pdf", "filename": "1234_scan.pdf" },
    { "path": "batch/1235_report.pdf", "filename": "1235_report.pdf" }
  ]
}
```

---

## 🔄 Conventions

| Rule | Reason |
|------|--------|
| Do **not** infer clinical data | That is handled by Athena Tech later |
| Always group structurally | Reduces medical errors |
| Prefer deterministic logic | Avoids AI hallucinations |
| Log low-confidence matches | Human validation required |
| Test with real data edge cases | Validate grouping reliability |

---

## 🔮 Future Extensions

- Integrate DB patient existence detection
- Add progress tracking via Staffbotics backend
- Generate automatic import audit reports
- Full UI wrapper (React-based) with conversational corrections

---

## 📝 Recommended Next Steps

1. Build basic workflow in n8n UI
2. Export & improve using Cursor
3. Add grouping logic code into `src/grouping.js`
4. Create test batch upload
5. Iterate based on user review accuracy

---

## 📬 Contact / Team

Lead: **Joan Ficapal Vila** — AI/ML & Survival Analysis  
Company: **Athena Tech & Staffbotics**  
Focus: AI infrastructure for personalized medicine

---

## 📌 Final Reminder to AI Assistants (Cursor)

> *You are here to accelerate development following strict structure logic. Do not generate medical reasoning. Always respect the grouping rules. Aim for robust, scalable execution, not just correct-looking code.*

---

Happy building! 🚀
