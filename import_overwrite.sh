#!/bin/sh
set -eu

WF_PATH="${1:-}"

if [ -z "$WF_PATH" ]; then
  echo "❌ Uso: $0 /data/workflows/<workflow>.json"
  exit 1
fi

if [ ! -f "$WF_PATH" ]; then
  echo "❌ No existe el archivo: $WF_PATH"
  exit 1
fi

# Nombre del workflow (para logs)
WF_NAME="$(node -e 'const fs=require("fs"); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(j.name||"");' "$WF_PATH")"
if [ -z "$WF_NAME" ]; then
  echo "❌ El JSON no tiene el campo .name"
  exit 1
fi

TMP_JSON="/tmp/workflow_import_normalized.json"

# Normaliza el JSON para TU DB:
# - NO borrar versionId (NOT NULL). Si falta, generar uno.
# - active NOT NULL => poner false
# - eliminar id/meta para evitar choques y limpieza de webhooks raros
node -e '
const fs=require("fs");
const crypto=require("crypto");

const inPath=process.argv[1];
const outPath=process.argv[2];

const o=JSON.parse(fs.readFileSync(inPath,"utf8"));

// Evitar conflictos por id/meta
delete o.id;
delete o.meta;

// versionId: tu DB lo exige NOT NULL
// Si no existe o está vacío, generar uno determinístico (hash del contenido)
if (!o.versionId || typeof o.versionId !== "string" || !o.versionId.trim()) {
  const h = crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 12);
  o.versionId = `import-${h}`;
}

// active: tu DB lo exige NOT NULL => false
o.active = false;

fs.writeFileSync(outPath, JSON.stringify(o, null, 2));
' "$WF_PATH" "$TMP_JSON"

echo "⬆️  Importando workflow: $WF_NAME"
echo "    Fuente: $WF_PATH"
echo "    Normalizado: $TMP_JSON"

# Importa
n8n import:workflow --input "$TMP_JSON"

echo "✅ Importado. En la UI busca y abre EXACTAMENTE: $WF_NAME"
