// src/summary.js
function summarizeProposal(patientCandidates = [], groupingConfig = {}, analysisText = "") {
  const summaryLines = [];

  summaryLines.push("Proposed patient grouping structure:");
  summaryLines.push(`- Strategy: ${groupingConfig.unit_strategy}`);
  summaryLines.push(`- Excel config: ${JSON.stringify(groupingConfig.excel || {})}`);
  summaryLines.push(`- Folder config: ${JSON.stringify(groupingConfig.folder || {})}`);
  summaryLines.push(`- Number of patient candidates: ${patientCandidates.length}`);

  const lowConf = patientCandidates.filter((pc) => (pc.confidence || 0) < 0.5);
  const quarantine = patientCandidates.filter((pc) => pc.status === "quarantine");
  summaryLines.push(`- Low confidence candidates (<0.5): ${lowConf.length}`);
  summaryLines.push(`- Quarantined candidates: ${quarantine.length}`);

  // Top issues
  const issueCounts = {};
  quarantine.forEach(pc => (pc.issues || []).forEach(i => issueCounts[i] = (issueCounts[i] || 0) + 1));
  const topIssues = Object.entries(issueCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (topIssues.length) {
    summaryLines.push("- Top quarantine reasons:");
    topIssues.forEach(([k,v]) => summaryLines.push(`  - ${k} (${v})`));
  }

  summaryLines.push("");
  summaryLines.push("Heuristic analysis recap:");
  summaryLines.push(analysisText || "(none)");

  const summary = summaryLines.join("\n");
  return { summary };
}

module.exports = {
  summarizeProposal
};
