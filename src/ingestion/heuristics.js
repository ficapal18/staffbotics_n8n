// src/heuristics.js
function buildHeuristicAnalysis(originalBody = {}) {
  const excelFiles = originalBody.excelFiles || [];
  const files = originalBody.files || [];

  const analysisLines = [];

  const blacklist = new Set([
    "tumor_id", "lesion_id", "sample_id", "biopsy_id",
    "study_id", "trial_id", "center_id", "visit_id", "episode_id"
  ]);

  function idLikelihood(colName) {
    const lk = String(colName).toLowerCase();
    if (blacklist.has(lk)) return -10;

    let score = 0;
    if (lk === "nhc" || lk.includes("nhc")) score += 6;
    if (lk.includes("historia") || lk.includes("hc")) score += 4;
    if (lk.includes("patient") && lk.includes("id")) score += 6;
    if (lk.includes("id_paciente") || lk.includes("idpaciente")) score += 6;
    if (lk === "patient_id") score += 8;

    if (lk === "id") score += 1;
    if (lk.endsWith("_id")) score += 0; // neutral now (was dangerous)

    if (lk.includes("tumor") || lk.includes("lesion") || lk.includes("sample")) score -= 6;
    if (lk.includes("study") || lk.includes("trial") || lk.includes("center")) score -= 6;

    return score;
  }

  // Excel analysis
  excelFiles.forEach((ef, efIndex) => {
    const fileName = ef.name || `excel_${efIndex}`;
    const rows = ef.rows || [];
    analysisLines.push(`Excel file '${fileName}' with ${rows.length} rows.`);

    if (rows.length) {
      const colNames = Object.keys(rows[0]);
      analysisLines.push(`Columns: ${JSON.stringify(colNames)}`);

      const colStats = colNames.map((col) => {
        const values = rows.map((r) => String(r[col]));
        const nonNull = values.filter(
          (v) =>
            v !== null &&
            v !== undefined &&
            v !== "" &&
            v !== "null" &&
            v !== "None"
        );
        const distinct = new Set(nonNull);
        const uniqueness = nonNull.length ? distinct.size / nonNull.length : 0.0;
        const nullRatio = values.length ? 1.0 - nonNull.length / values.length : 0.0;

        const like = idLikelihood(col);
        return { name: col, uniqueness, nullRatio, like };
      });

      colStats.sort((a, b) => {
        // prioritize id-likeness, then uniqueness, then null ratio
        if (b.like !== a.like) return b.like - a.like;
        if (b.uniqueness !== a.uniqueness) return b.uniqueness - a.uniqueness;
        return a.nullRatio - b.nullRatio;
      });

      if (colStats.length) {
        const best = colStats[0];
        analysisLines.push(
          `Best ID-like column candidate: '${best.name}' (id_likeness=${best.like}, uniqueness=${best.uniqueness.toFixed(
            2
          )}, null_ratio=${best.nullRatio.toFixed(2)}).`
        );
      }
    }
  });

  // Folder structure analysis
  const folderCounts = {};
  files.forEach((f) => {
    const path = f.path || f.fullPath || f.filename;
    if (!path) return;
    const parts = path.split("/");
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join("/");
      folderCounts[folder] = (folderCounts[folder] || 0) + 1;
    }
  });

  if (Object.keys(folderCounts).length) {
    analysisLines.push("Folder structure:");
    Object.entries(folderCounts)
      .slice(0, 20)
      .forEach(([folder, count]) => {
        analysisLines.push(` - Folder '${folder}' has ${count} files.`);
      });
  }

  const analysisText = analysisLines.length
    ? analysisLines.join("\n")
    : "No strong structure detected.";

  return { analysisText };
}

module.exports = {
  buildHeuristicAnalysis
};
