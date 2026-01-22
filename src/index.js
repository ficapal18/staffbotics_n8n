// src/index.js
const { buildRawItemsFromWebhookBody, buildHeuristicAnalysis } = require("./ingestion");
const { autoGroup, extractIdentifiersFromRow } = require("./grouping");
const { applyOperations } = require("./operations");
const { summarizeProposal } = require("./summary");

// (Optional) expose identity helpers for debugging/testing
const {
  normText,
  normId,
  normDate,
  buildPatientKey,
  filenameContainsId,
  filenameMatchesName,
  tokens
} = require("./identity");

module.exports = {
  // pipeline
  buildRawItemsFromWebhookBody,
  buildHeuristicAnalysis,
  autoGroup,
  applyOperations,
  summarizeProposal,

  // optional helpers
  extractIdentifiersFromRow,
  normText,
  normId,
  normDate,
  buildPatientKey,
  filenameContainsId,
  filenameMatchesName,
  tokens
};
