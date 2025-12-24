// src/heuristics.js
// LLM usage: buildHeuristicAnalysis(originalBody) -> { analysisText }
/**
 * Analyze the originalBody (excelFiles + files) and produce a human-readable
 * analysisText describing candidate ID columns and folder structure.
 *
 * Returns: { analysisText }
 */
function buildHeuristicAnalysis(originalBody = {}) {
    const excelFiles = originalBody.excelFiles || [];
    const files = originalBody.files || [];
  
    const analysisLines = [];
  
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
          const nullRatio = values.length
            ? 1.0 - nonNull.length / values.length
            : 0.0;
          return { name: col, uniqueness, nullRatio };
        });
  
        colStats.sort((a, b) => {
          if (b.uniqueness !== a.uniqueness) return b.uniqueness - a.uniqueness;
          return a.nullRatio - b.nullRatio;
        });
  
        if (colStats.length) {
          const best = colStats[0];
          analysisLines.push(
            `Best ID-like column candidate: '${best.name}' (uniqueness=${best.uniqueness.toFixed(
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
  