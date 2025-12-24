// src/rawItems.js
// LLM usage: buildRawItemsFromWebhookBody(body) -> { rawItems, originalBody }
/**
 * Build rawItems[] from a generic webhook body.
 *
 * Expected body structure (can be adapted):
 * {
 *   excelFiles: [
 *     { name: "patients.xlsx", rows: [ { col1: ..., col2: ... }, ... ] }
 *   ],
 *   files: [
 *     { path: "folderA/1234_report.pdf", filename: "1234_report.pdf" },
 *     ...
 *   ]
 * }
 *
 * Returns: { rawItems, originalBody }
 */
function buildRawItemsFromWebhookBody(body = {}) {
    const excelFiles = body.excelFiles || [];
    const files = body.files || [];
  
    const rawItems = [];
  
    // Excel rows → RawItems
    excelFiles.forEach((ef, efIndex) => {
      const fileName = ef.name || `excel_${efIndex}`;
      const rows = ef.rows || [];
      rows.forEach((row, rowIndex) => {
        rawItems.push({
          id: `${fileName}_row_${rowIndex}`,
          source_type: "excel_row",
          source_ref: `${fileName}#row_${rowIndex}`,
          metadata: {
            file: fileName,
            row_index: rowIndex,
            columns: row
          }
        });
      });
    });
  
    // Generic files → RawItems
    files.forEach((f, fIndex) => {
      const path = f.path || f.fullPath || f.filename;
      const filename = f.filename || (path ? path.split("/").slice(-1)[0] : `file_${fIndex}`);
      let folderPath = null;
      if (path && path.includes("/")) {
        folderPath = path.split("/").slice(0, -1).join("/");
      }
      rawItems.push({
        id: `file_${fIndex}`,
        source_type: "file",
        source_ref: path || filename,
        metadata: {
          filename,
          folder_path: folderPath,
          extension: filename.includes(".")
            ? filename.split(".").slice(-1)[0].toLowerCase()
            : null
        }
      });
    });
  
    return {
      rawItems,
      originalBody: body
    };
  }
  
  module.exports = {
    buildRawItemsFromWebhookBody
  };
  