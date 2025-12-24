// src/index.js
// LLM usage: require('/data/src') to get all helpers in one import.
const { buildRawItemsFromWebhookBody } = require("./rawItems");
const { buildHeuristicAnalysis } = require("./heuristics");
const { autoGroup, extractIdentifiersFromRow } = require("./grouping");
const { summarizeProposal } = require("./summary");
const { applyOperations } = require("./operations");

module.exports = {
  buildRawItemsFromWebhookBody,
  buildHeuristicAnalysis,
  autoGroup,
  extractIdentifiersFromRow,
  summarizeProposal,
  applyOperations
};
