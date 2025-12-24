// src/summary.js
// LLM usage: summarizeProposal(patientCandidates, groupingConfig, analysisText) -> { summary }
/**
 * Build a human-readable summary of the proposed grouping.
 *
 * @param {Array} patientCandidates
 * @param {Object} groupingConfig
 * @param {string} analysisText
 *
 * Returns: { summary }
 */
function summarizeProposal(patientCandidates = [], groupingConfig = {}, analysisText = "") {
    const summaryLines = [];
  
    summaryLines.push("Proposed patient grouping structure:");
    summaryLines.push(`- Strategy: ${groupingConfig.unit_strategy}`);
    summaryLines.push(`- Excel config: ${JSON.stringify(groupingConfig.excel || {})}`);
    summaryLines.push(`- Folder config: ${JSON.stringify(groupingConfig.folder || {})}`);
    summaryLines.push(`- Number of patient candidates: ${patientCandidates.length}`);
  
    const lowConf = patientCandidates.filter((pc) => (pc.confidence || 0) < 0.5);
    summaryLines.push(`- Low confidence candidates (<0.5): ${lowConf.length}`);
  
    summaryLines.push("");
    summaryLines.push("Heuristic analysis recap:");
    summaryLines.push(analysisText || "(none)");
  
    const summary = summaryLines.join("\n");
  
    return { summary };
  }
  
  module.exports = {
    summarizeProposal
  };
  