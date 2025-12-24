// src/grouping.js
// LLM usage: autoGroup(rawItems, groupingConfig, analysisText) -> { patientCandidates, groupingConfig, analysisText, rawItems }
/**
 * Helper: create a base PatientCandidate object.
 */
function createCandidate(candidateId, inferredKey) {
    return {
      candidate_id: candidateId,
      inferred_key: inferredKey,
      inferred_identifiers: {},
      raw_items: [],
      confidence: 0.8,
      notes: []
    };
  }
  
  /**
   * Helper: extract identifiers from an Excel row.
   * We try to infer patient_id, name, dob using very simple name heuristics.
   */
  function extractIdentifiersFromRow(row = {}) {
    const ident = {};
    Object.keys(row || {}).forEach((k) => {
      const lk = k.toLowerCase();
      const value = row[k];
  
      if (
        lk.includes("nhc") ||
        lk.includes("historia") ||
        lk === "id" ||
        lk.endsWith("_id")
      ) {
        ident.patient_id = value;
      }
      if (lk.includes("name") || lk.includes("nom")) {
        ident.name = value;
      }
      if (lk.includes("birth") || lk.includes("dob") || lk.includes("naixement")) {
        ident.dob = value;
      }
    });
    return ident;
  }
  
  /**
   * Main grouping function.
   *
   * @param {Array} rawItems - list of RawItem
   * @param {Object} groupingConfig - config suggested by LLM or defaults
   * @param {string} analysisText - heuristic explanation (carried along)
   *
   * Returns:
   * {
   *   patientCandidates,
   *   groupingConfig,
   *   analysisText,
   *   rawItems
   * }
   */
  function autoGroup(rawItems = [], groupingConfig = {}, analysisText = "") {
    const unitStrategy = groupingConfig.unit_strategy || "excel_row";
    const excelCfg = groupingConfig.excel || {};
    const folderCfg = groupingConfig.folder || {};
  
    const patientCandidates = [];
  
    // Strategy: excel_row
    if (unitStrategy === "excel_row") {
      const idColumn = excelCfg.id_column || null;
  
      // Create candidates from excel rows
      rawItems
        .filter((ri) => ri.source_type === "excel_row")
        .forEach((ri) => {
          const meta = ri.metadata || {};
          const file = meta.file || "unknown_excel";
          const rowIndex = meta.row_index ?? 0;
          const row = meta.columns || {};
          const candidateId = `${file}_row_${rowIndex}`;
  
          const pc = createCandidate(
            candidateId,
            `Excel row ${rowIndex} in ${file}`
          );
          const identifiers = extractIdentifiersFromRow(row);
          if (idColumn && row[idColumn] !== undefined) {
            if (!identifiers.patient_id) identifiers.patient_id = row[idColumn];
          }
          pc.inferred_identifiers = identifiers;
          pc.raw_items.push(ri);
          patientCandidates.push(pc);
        });
  
      // Attach file-type rawItems by ID or name in filename
      const fileItems = rawItems.filter((ri) => ri.source_type === "file");
      fileItems.forEach((fi) => {
        const meta = fi.metadata || {};
        const filename = (meta.filename || "").toLowerCase();
        let attached = false;
  
        for (const pc of patientCandidates) {
          const ident = pc.inferred_identifiers || {};
          const pid = String(ident.patient_id || "").toLowerCase();
          const name = String(ident.name || "").toLowerCase();
  
          if (pid && filename.includes(pid)) {
            pc.raw_items.push(fi);
            attached = true;
            break;
          }
          if (name) {
            const token = name.split(/\s+/)[0];
            if (token && filename.includes(token.toLowerCase())) {
              pc.raw_items.push(fi);
              attached = true;
              break;
            }
          }
        }
  
        if (!attached) {
          const pc = createCandidate(
            `file_only_${fi.id}`,
            `Unassigned file ${meta.filename || fi.id}`
          );
          pc.raw_items.push(fi);
          pc.confidence = 0.3;
          pc.notes.push("Unassigned file; no matching patient found.");
          patientCandidates.push(pc);
        }
      });
    }
  
    // Strategy: subfolder
    else if (unitStrategy === "subfolder") {
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
        pc.confidence = 0.85;
        patientCandidates.push(pc);
      });
    }
  
    // Strategy: id_in_filename
    else if (unitStrategy === "id_in_filename") {
      const patterns = folderCfg.id_patterns || [];
      const idMap = {};
      const reCache = {};
  
      rawItems
        .filter((ri) => ri.source_type === "file")
        .forEach((ri) => {
          const meta = ri.metadata || {};
          const filename = meta.filename || "";
          let matchedId = null;
  
          for (const pat of patterns) {
            if (!reCache[pat]) {
              try {
                reCache[pat] = new RegExp(pat);
              } catch (e) {
                reCache[pat] = null;
              }
            }
            const re = reCache[pat];
            if (!re) continue;
            const m = filename.match(re);
            if (m) {
              matchedId = m[0];
              break;
            }
          }
  
          if (!matchedId) {
            matchedId = `unassigned::${ri.id}`;
          }
  
          if (!idMap[matchedId]) idMap[matchedId] = [];
          idMap[matchedId].push(ri);
        });
  
      Object.entries(idMap).forEach(([pid, list]) => {
        const pc = createCandidate(`id::${pid}`, `ID from filename '${pid}'`);
        pc.raw_items.push(...list);
        if (!pid.startsWith("unassigned::")) {
          pc.inferred_identifiers = { patient_id: pid };
          pc.confidence = 0.8;
        } else {
          pc.confidence = 0.3;
          pc.notes.push("Unassigned file; no ID pattern match.");
        }
        patientCandidates.push(pc);
      });
    }
  
    // Strategy: fallback
    else {
      rawItems.forEach((ri) => {
        const pc = createCandidate(`single::${ri.id}`, `Single source item ${ri.id}`);
        pc.raw_items.push(ri);
        pc.confidence = 0.2;
        pc.notes.push("Fallback grouping: one item per candidate.");
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
  