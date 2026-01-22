// src/ingestion/index.js
const { buildRawItemsFromWebhookBody } = require("./rawItems");
const { buildHeuristicAnalysis } = require("./heuristics");

module.exports = {
  buildRawItemsFromWebhookBody,
  buildHeuristicAnalysis
};
