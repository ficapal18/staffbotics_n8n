// src/grouping.js
// LLM usage: autoGroup(rawItems, groupingConfig, analysisText) -> { patientCandidates, groupingConfig, analysisText, rawItems }

const { buildPatientKey, normId, normText } = require("../identity/normalize");
const { filenameContainsId, filenameMatchesName } = require("../identity/matching");

/**
 * Helper: create a base PatientCandidate object.
 */
function createCandidate(candidateId, inferredKey) {
  return {
    candidate_id: candidateId,
    inferred_key: inferredKey,
    inferred_identifiers: {},
    normalized_identifiers: {},
    patient_key: null,
    match_key_type: null,
    raw_items: [],
    confidence: 0.8,
    status: "ready", // 'ready' | 'quarantine'
    issues: [],
    notes: []
  };
}

/**
 * Scored identifier extraction to avoid picking tumor_id/study_id/etc.
 */
function extractIdentifiersFromRow(row = {}) {
  const keys = Object.keys(row || {});
  const scored = [];

  const blacklisted = [
    "study_id", "trial_id", "center_id", "hospital_id",
    "tumor_id", "lesion_id", "biopsy_id", "sample_id",
    "visit_id", "episode_id", "treatment_id"
  ];

  function scoreKey(lk) {
    let score = 0;

    if (blacklisted.includes(lk)) return -100;

    // strong patient id hints
    if (lk === "nhc" || lk.includes("nhc")) score += 10;
    if (lk.includes("historia") || lk.includes("hc")) score += 6;
    if (lk.includes("patient") && lk.includes("id")) score += 10;
    if (lk.includes("id_paciente") || lk.includes("idpaciente")) score += 10;
    if (lk === "patient_id") score += 12;

    // weak generic "id"
    if (lk === "id") score += 3;
    if (lk.endsWith("_id")) score += 1;

    // punish obvious non-patient id contexts
    if (lk.includes("tumor") || lk.includes("lesion") || lk.includes("sample")) score -= 8;
    if (lk.includes("study") || lk.includes("trial") || lk.includes("center")) score -= 8;

    return score;
  }

  // patient_id candidate
  keys.forEach((k) => {
    const lk = String(k).toLowerCase().trim();
    scored.push({ k, lk, score: scoreKey(lk), value: row[k] });
  });

  scored.sort((a, b) => b.score - a.score);

  const ident = {};
  const bestPid = scored.find(x => x.score >= 6 && x.value !== undefined && x.value !== null && String(x.value).trim() !== "");
  if (bestPid) ident.patient_id = bestPid.value;

  // name
  for (const k of keys) {
    const lk = String(k).toLowerCase();
    if (lk.includes("name") || lk.includes("nom") || lk.includes("cognom") || lk.includes("apellido")) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        ident.name = v;
        break;
      }
    }
  }

  // dob
  for (const k of keys) {
    const lk = String(k).toLowerCase();
    if (lk.includes("birth") || lk.includes("dob") || lk.includes("naixement") || lk.includes("fecha_nacimiento")) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        ident.dob = v;
        break;
      }
    }
  }

  return ident;
}

/**
 * Normalize identifiers for consistent matching/hashing.
 */
function normalizeIdentifiers(ident = {}) {
  return {
    patient_id: normId(ident.patient_id || ""),
    name: normText(ident.name || ""),
    dob: String(ident.dob ?? "").trim()
  };
}

/**
 * Extract ID from filename using patterns.
 * patterns can be:
 * - string regex  (backward compatible) -> uses match[0]
 * - { pattern: string, group?: number } -> uses match[group||0]
 */
function extractIdFromFilename(filename = "", patterns = []) {
  const reCache = new Map();

  function getRe(pat) {
    if (reCache.has(pat)) return reCache.get(pat);
    try {
      const re = new RegExp(pat, "i");
      reCache.set(pat, re);
      return re;
    } catch (e) {
      reCache.set(pat, null);
      return null;
    }
  }

  for (const p of patterns) {
    if (!p) continue;

    let pat = p;
    let group = 0;
    if (typeof p === "object") {
      pat = p.pattern;
      group = Number.isInteger(p.group) ? p.group : 0;
    }

    if (typeof pat !== "string" || !pat) continue;
    const re = getRe(pat);
    if (!re) continue;

    const m = String(filename).match(re);
    if (m) {
      const g = m[group] ?? m[0];
      const cleaned = normId(g);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

/**
 * Quarantine rules:
 * - confidence < threshold
 * - missing both patient_id and (name+dob)
 * - “id-like” collisions / suspicious ids
 */
function finalizeCandidate(pc, cfg = {}) {
  const qThresh = cfg.quarantine_threshold ?? 0.55;

  const ni = pc.normalized_identifiers || {};
  const hasPid = !!ni.patient_id;
  const hasNameDob = !!(ni.name && ni.dob);

  if (!hasPid && !hasNameDob) {
    pc.issues.push("No reliable identifiers (needs patient_id or name+dob).");
    pc.confidence = Math.min(pc.confidence, 0.35);
  }

  // suspicious short numeric IDs (common source of false matches)
  if (hasPid && /^\d+$/.test(ni.patient_id) && ni.patient_id.length < 4) {
    pc.issues.push("Patient ID looks too short; high collision risk.");
    pc.confidence = Math.min(pc.confidence, 0.45);
  }

  if ((pc.confidence ?? 0) < qThresh) {
    pc.status = "quarantine";
  }

  return pc;
}

/**
 * Main grouping function.
 */
function autoGroup(rawItems = [], groupingConfig = {}, analysisText = "") {
  const unitStrategy = groupingConfig.unit_strategy || "excel_row";
  const excelCfg = groupingConfig.excel || {};
  const folderCfg = groupingConfig.folder || {};
  const quarantineCfg = groupingConfig.quarantine || {};

  const patientCandidates = [];

  // Strategy: excel_row (now: group rows by patient key, not one row == one patient)
  if (unitStrategy === "excel_row") {
    const idColumn = excelCfg.id_column || null;

    // 1) Build candidates from excel rows but GROUP them
    const grouped = new Map(); // key -> candidate

    rawItems
      .filter((ri) => ri.source_type === "excel_row")
      .forEach((ri) => {
        const meta = ri.metadata || {};
        const file = meta.file || "unknown_excel";
        const rowIndex = meta.row_index ?? 0;
        const row = meta.columns || {};

        const identifiers = extractIdentifiersFromRow(row);
        if (idColumn && row[idColumn] !== undefined && row[idColumn] !== null && String(row[idColumn]).trim() !== "") {
          if (!identifiers.patient_id) identifiers.patient_id = row[idColumn];
        }

        const normIdent = normalizeIdentifiers(identifiers);
        const keyInfo = buildPatientKey(normIdent);
        const patientKey = keyInfo.patient_key;

        const groupKey = `${file}::${patientKey}`; // avoid collisions across different excel files

        if (!grouped.has(groupKey)) {
          const pc = createCandidate(`excel::${file}::${patientKey}`, `Excel patient group in ${file}`);
          pc.inferred_identifiers = identifiers;
          pc.normalized_identifiers = normIdent;
          pc.patient_key = patientKey;
          pc.match_key_type = keyInfo.match_key_type;
          pc.raw_items.push(ri);
          pc.confidence = 0.8;
          grouped.set(groupKey, pc);
        } else {
          const pc = grouped.get(groupKey);
          pc.raw_items.push(ri);

          // merge identifiers if missing
          pc.inferred_identifiers = pc.inferred_identifiers || {};
          if (!pc.inferred_identifiers.patient_id && identifiers.patient_id) pc.inferred_identifiers.patient_id = identifiers.patient_id;
          if (!pc.inferred_identifiers.name && identifiers.name) pc.inferred_identifiers.name = identifiers.name;
          if (!pc.inferred_identifiers.dob && identifiers.dob) pc.inferred_identifiers.dob = identifiers.dob;

          pc.normalized_identifiers = normalizeIdentifiers(pc.inferred_identifiers);
          const newKey = buildPatientKey(pc.normalized_identifiers);
          pc.patient_key = newKey.patient_key;
          pc.match_key_type = newKey.match_key_type;

          // slight confidence boost for multi-row evidence
          pc.confidence = Math.min(0.92, (pc.confidence || 0.8) + 0.03);
        }
      });

    // No excel rows? keep empty for now; files will become file_only
    patientCandidates.push(...Array.from(grouped.values()));

    // 2) Attach file items to candidates using safer matching
    const fileItems = rawItems.filter((ri) => ri.source_type === "file");

    fileItems.forEach((fi) => {
      const meta = fi.metadata || {};
      const filename = meta.filename || "";
      let best = null;
      let bestScore = 0;

      for (const pc of patientCandidates) {
        const ni = pc.normalized_identifiers || {};
        const pid = ni.patient_id || "";
        const name = pc.inferred_identifiers?.name || "";

        let score = 0;

        if (pid && filenameContainsId(filename, pid)) score += 10;
        if (name && filenameMatchesName(filename, name)) score += 4;

        if (score > bestScore) {
          bestScore = score;
          best = pc;
        }
      }

      if (best && bestScore >= 6) {
        best.raw_items.push(fi);
        best.confidence = Math.min(0.95, (best.confidence || 0.8) + 0.02);
      } else {
        const pc = createCandidate(`file_only_${fi.id}`, `Unassigned file ${meta.filename || fi.id}`);
        pc.raw_items.push(fi);
        pc.confidence = 0.3;
        pc.status = "quarantine";
        pc.issues.push("Unassigned file; no confident patient match.");
        patientCandidates.push(pc);
      }
    });

    // finalize
    patientCandidates.forEach(pc => finalizeCandidate(pc, quarantineCfg));
  }

  // Strategy: subfolder (now: confidence depends on folder “patient-likeness”)
  else if (unitStrategy === "subfolder") {
    const patterns = folderCfg.id_patterns || [];
    const folderMap = {};

    rawItems
      .filter((ri) => ri.source_type === "file")
      .forEach((ri) => {
        const meta = ri.metadata || {};
        const folder = meta.folder_path || "root";
        if (!folderMap[folder]) folderMap[folder] = [];
        folderMap[folder].push(ri);
      });

    Object.entries(folderMap).forEach(([folder, list]) => {
      const pc = createCandidate(`folder::${folder}`, `Folder '${folder}'`);
      pc.raw_items.push(...list);

      // Extract patient id from folder leaf if possible
      const leaf = String(folder).split("/").slice(-1)[0];
      const extracted = extractIdFromFilename(leaf, patterns);
      if (extracted) {
        pc.inferred_identifiers = { patient_id: extracted };
        pc.normalized_identifiers = normalizeIdentifiers(pc.inferred_identifiers);
        const keyInfo = buildPatientKey(pc.normalized_identifiers);
        pc.patient_key = keyInfo.patient_key;
        pc.match_key_type = keyInfo.match_key_type;
        pc.confidence = 0.85;
      } else {
        // Folder might be batch/date/hospital rather than patient
        pc.confidence = 0.55;
        pc.issues.push("Folder grouping used but folder name does not look patient-specific.");
      }

      finalizeCandidate(pc, quarantineCfg);
      patientCandidates.push(pc);
    });
  }

  // Strategy: id_in_filename (now: supports capture groups)
  else if (unitStrategy === "id_in_filename") {
    const patterns = folderCfg.id_patterns || [];
    const idMap = {};

    rawItems
      .filter((ri) => ri.source_type === "file")
      .forEach((ri) => {
        const meta = ri.metadata || {};
        const filename = meta.filename || "";
        const matchedId = extractIdFromFilename(filename, patterns);

        const key = matchedId ? `id::${matchedId}` : `unassigned::${ri.id}`;
        if (!idMap[key]) idMap[key] = [];
        idMap[key].push(ri);
      });

    Object.entries(idMap).forEach(([key, list]) => {
      const pc = createCandidate(key, `ID grouping '${key}'`);
      pc.raw_items.push(...list);

      if (key.startsWith("id::")) {
        const pid = key.replace(/^id::/, "");
        pc.inferred_identifiers = { patient_id: pid };
        pc.normalized_identifiers = normalizeIdentifiers(pc.inferred_identifiers);
        const keyInfo = buildPatientKey(pc.normalized_identifiers);
        pc.patient_key = keyInfo.patient_key;
        pc.match_key_type = keyInfo.match_key_type;
        pc.confidence = 0.82;
      } else {
        pc.confidence = 0.3;
        pc.status = "quarantine";
        pc.issues.push("Unassigned file; no ID pattern match.");
      }

      finalizeCandidate(pc, quarantineCfg);
      patientCandidates.push(pc);
    });
  }

  // Strategy: fallback
  else {
    rawItems.forEach((ri) => {
      const pc = createCandidate(`single::${ri.id}`, `Single source item ${ri.id}`);
      pc.raw_items.push(ri);
      pc.confidence = 0.2;
      pc.status = "quarantine";
      pc.issues.push("Fallback grouping: one item per candidate.");
      patientCandidates.push(pc);
    });
  }

  return {
    patientCandidates,
    groupingConfig,
    analysisText,
    rawItems
  };
}

module.exports = {
  autoGroup,
  extractIdentifiersFromRow
};
